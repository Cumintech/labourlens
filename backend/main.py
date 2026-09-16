import os
import secrets
from contextlib import asynccontextmanager
from datetime import date as date_, datetime, timezone

from fastapi import Depends, FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

import admin
import biometric_api
import forms
import models
import ocr
import photo_storage
import reports
import sync_worker
from attendance_service import upsert_attendance
from auth import create_token, get_current_owner, hash_password, verify_password
from crypto import mask_aadhaar
from database import Base, SessionLocal, engine, get_db
from email_service import send_report_email
from schemas import (
    AttendanceMarkIn,
    AttendanceOut,
    DailyWageSummaryOut,
    DailyWorkerWageOut,
    DashboardOut,
    FactoryProfileIn,
    FormTemplateOut,
    FormEmailIn,
    HealthOut,
    LeaveEntryIn,
    LeaveEntryOut,
    OcrFieldsOut,
    OwnerLoginIn,
    OwnerOut,
    OwnerSignupIn,
    PortalCredentialIn,
    ReportEmailIn,
    ShiftConfigIn,
    ShiftConfigOut,
    SlotSummary,
    SyncStatusOut,
    TokenOut,
    WageProfileIn,
    WageProfileOut,
    WagePaymentIn,
    WagePaymentOut,
    WageSummaryOut,
    WorkerComplianceIn,
    WorkerComplianceOut,
    WorkerCreateIn,
    WorkerOut,
    WorkerTypeAssignIn,
    WorkerTypeIn,
    WorkerTypeOut,
    WorkerWageOut,
)

ATTENDANCE_STATUSES = ("present", "absent", "leave")

MAX_WORKERS_PER_OWNER = 50

# EPF's statutory employee contribution rate under Indian law -- the
# sensible default for a wage profile auto-created from a worker type
# assignment (which otherwise leaves pf_rate at WageProfile's own
# column default of 0). A convenience default only: still an ordinary
# editable/overridable field on WageProfile once set, same as basic or
# rate_type. The mobile app's WageProfileScreen mirrors this exact
# value for its own auto-fill UI -- keep both in sync if this changes.
DEFAULT_PF_RATE_PERCENT = 12.0

# Factories Act minimum working age -- stricter than the 18-year
# adult/young_person split below. Warn-only per PHASE3_STATUTORY_FORMS_PLAN.md:
# this app never blocks registration on it, just surfaces a banner.
MINIMUM_WORKING_AGE = 14
YOUNG_PERSON_AGE_CEILING = 18


def _age_years(dob: date_, as_of: date_) -> int:
    years = as_of.year - dob.year
    if (as_of.month, as_of.day) < (dob.month, dob.day):
        years -= 1
    return years


def _shift_configs_for_owner(db: Session, owner_id: int) -> list[models.ShiftConfig]:
    return (
        db.query(models.ShiftConfig)
        .filter(models.ShiftConfig.owner_id == owner_id)
        .order_by(models.ShiftConfig.sort_order)
        .all()
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Skippable via OCR_WARM_UP=false -- loading EasyOCR's PyTorch models
    # at startup needs real memory headroom a free-tier host (e.g.
    # Render's 512MB web service) doesn't have, and an OOM here takes
    # the whole app down before it can even start serving requests, not
    # just the OCR feature. Defaults to on (unchanged local-dev
    # behavior: the first real Aadhaar scan stays fast).
    if os.environ.get("OCR_WARM_UP", "true").lower() != "false":
        ocr.warm_up()

    # One-time admin account bootstrap via env vars -- the other half of
    # seed_admin.py's "seeded via a one-time script or environment
    # variable" requirement. Only fires when no admin_user row exists
    # yet, so setting these in Render's env vars once (with real shell
    # access unavailable on the free tier) creates the account on first
    # boot and is a no-op on every boot after that -- never overwrites
    # an existing admin on a later redeploy even if the env vars are
    # still set.
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if admin_email and admin_password:
        db = SessionLocal()
        try:
            if not db.query(models.AdminUser).first():
                db.add(models.AdminUser(email=admin_email, password_hash=hash_password(admin_password)))
                db.commit()
        finally:
            db.close()

    yield


app = FastAPI(title="Labour Lens API", lifespan=lifespan)

# Wide open for Day 1 (Expo dev client + Expo Go connect from arbitrary
# local IPs during development). Tighten to specific origins once the app
# has a real distribution channel (Day 5+).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router)
app.include_router(biometric_api.router)

# Informational only -- deliberately no gate anywhere in this app that
# blocks a factory owner from using it once this hits zero. Days are
# counted from the matching Factory row's enrolled_at (== signup time),
# so no separate "trial start" field is needed.
TRIAL_DAYS = 3


def _owner_out(db: Session, owner: models.Owner) -> OwnerOut:
    factory = db.query(models.Factory).filter(models.Factory.owner_id == owner.id).first()
    plan_status = factory.status if factory else "trial"
    trial_days_remaining = None
    if plan_status == "trial" and factory:
        # SQLite doesn't actually preserve timezone-awareness even for a
        # DateTime(timezone=True) column (unlike Postgres) -- it hands
        # back a naive datetime, which can't be subtracted from an
        # aware one. Treat a naive value as UTC (the only timezone
        # anything here is ever written in) rather than assuming the
        # database always round-trips it aware.
        enrolled_at = factory.enrolled_at
        if enrolled_at.tzinfo is None:
            enrolled_at = enrolled_at.replace(tzinfo=timezone.utc)
        elapsed_days = (datetime.now(timezone.utc) - enrolled_at).days
        trial_days_remaining = max(TRIAL_DAYS - elapsed_days, 0)
    return OwnerOut(**owner.__dict__, plan_status=plan_status, trial_days_remaining=trial_days_remaining)


@app.get("/health", response_model=HealthOut)
def health():
    return HealthOut(status="ok", time=datetime.now(timezone.utc))


@app.post("/owners/signup", response_model=TokenOut, status_code=201)
def signup(body: OwnerSignupIn, db: Session = Depends(get_db)):
    if not body.consent_given:
        raise HTTPException(status_code=422, detail="You must accept the Privacy Policy to create an account")

    existing = db.query(models.Owner).filter(models.Owner.mobile == body.mobile).first()
    if existing:
        raise HTTPException(status_code=409, detail="An owner with this mobile number already exists")

    owner = models.Owner(
        name=body.name,
        mobile=body.mobile,
        password_hash=hash_password(body.password),
        factory_name=body.factory_name,
        consent_given_at=datetime.now(timezone.utc),
    )
    db.add(owner)
    db.commit()
    db.refresh(owner)

    # Every owner needs at least one shift to ever mark attendance --
    # seed the same default 3-shift scheme the migration script backfills
    # onto pre-existing owners, so a brand-new signup isn't left with zero
    # valid slots. Owner can rename/retime/replace these afterward.
    for slot_key, label, sort_order in (("AM", "AM", 0), ("PM", "PM", 1), ("Evening", "Evening", 2)):
        db.add(models.ShiftConfig(owner_id=owner.id, slot_key=slot_key, label=label, sort_order=sort_order))

    # Sensible starting defaults for the Wage Rate feature -- fully
    # editable/removable like any owner-created type, seeded once at
    # signup (not lazily whenever the list is empty) so a deliberate
    # delete-all by the owner later is respected, not silently reappearing.
    for name, default_rate in (("Plumber", 1000), ("Electrician", 1000), ("Helper", 500)):
        db.add(models.WorkerType(owner_id=owner.id, name=name, default_rate_type="daily", default_rate=default_rate))

    # Every Owner is one factory for admin-portal purposes -- auto-create
    # the matching Factory row here rather than requiring the admin to
    # manually re-enter every factory that's already signed up. Starts
    # in "trial" status; the admin updates it as the business
    # relationship changes (see admin.py).
    db.add(
        models.Factory(
            owner_id=owner.id,
            name=owner.factory_name,
            owner_name=owner.name,
            owner_contact=owner.mobile,
        )
    )
    db.commit()

    token = create_token(owner.id)
    return TokenOut(access_token=token, owner=_owner_out(db, owner))


@app.post("/owners/login", response_model=TokenOut)
def login(body: OwnerLoginIn, db: Session = Depends(get_db)):
    owner = db.query(models.Owner).filter(models.Owner.mobile == body.mobile).first()
    if not owner or not verify_password(body.password, owner.password_hash):
        raise HTTPException(status_code=401, detail="Invalid mobile number or password")
    if owner.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Invalid mobile number or password")

    token = create_token(owner.id)
    return TokenOut(access_token=token, owner=_owner_out(db, owner))


@app.get("/owners/me", response_model=OwnerOut)
def get_me(owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    return _owner_out(db, owner)


@app.put("/owners/me/factory-profile", response_model=OwnerOut)
def update_factory_profile(
    body: FactoryProfileIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # factory_name is NOT NULL on Owner (it's set at signup) -- only
    # overwrite it when a real value is sent, unlike address/licence
    # which are nullable and fine to clear.
    if body.factory_name and body.factory_name.strip():
        owner.factory_name = body.factory_name.strip()
    owner.factory_address = body.factory_address
    owner.factory_licence_no = body.factory_licence_no
    owner.state = body.state
    owner.industry = body.industry
    db.commit()
    db.refresh(owner)
    return _owner_out(db, owner)


@app.delete("/owners/me", status_code=204)
def delete_account(owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    """Apple Guideline 5.1.1(v): an app that supports account creation
    must also support account deletion, in-app. This does NOT cascade-
    delete Worker/Attendance/WageProfile/etc. rows -- the Tamil Nadu
    Factories Act requires those statutory registers to be retained
    regardless of whether the owner's own login still exists (see
    PrivacyPolicyScreen.tsx's "How long we keep it" section). Deleting
    is therefore: invalidate the password so it can never verify again,
    and stamp deleted_at so both this endpoint's own re-entrancy and
    every future request through get_current_owner reject the account
    outright, even with an unexpired token issued before deletion."""
    if owner.deleted_at is not None:
        return Response(status_code=204)
    owner.password_hash = hash_password(secrets.token_urlsafe(32))
    owner.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=204)


@app.post("/workers/ocr", response_model=OcrFieldsOut)
async def scan_aadhaar(
    front_image: UploadFile = File(...),
    back_image: UploadFile | None = File(None),
    owner: models.Owner = Depends(get_current_owner),
):
    front_bytes = await front_image.read()
    back_bytes = await back_image.read() if back_image else None
    fields = ocr.extract_fields(front_bytes, back_bytes)
    return OcrFieldsOut(**fields)


@app.post("/workers", response_model=WorkerOut, status_code=201)
def create_worker(
    body: WorkerCreateIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    current_count = (
        db.query(func.count(models.Worker.id))
        .filter(models.Worker.owner_id == owner.id)
        .scalar()
    )
    if current_count >= MAX_WORKERS_PER_OWNER:
        raise HTTPException(
            status_code=422,
            detail=f"This owner already has {MAX_WORKERS_PER_OWNER} workers, the maximum allowed",
        )

    worker = models.Worker(
        owner_id=owner.id,
        name=body.name,
        mobile=body.mobile,
        dob=body.dob,
        gender=body.gender,
        aadhaar_last4=mask_aadhaar(body.aadhaar_number),
        aadhaar_encrypted=body.aadhaar_number,
        current_address=body.current_address,
        current_district=body.current_district,
        native_address=body.native_address,
        native_district=body.native_district,
        bank_account_number=body.bank_account_number,
        bank_ifsc=body.bank_ifsc,
    )
    db.add(worker)
    db.commit()
    db.refresh(worker)

    # Assigned immediately at creation rather than only when an owner
    # happens to visit the biometric mapping screen and asks for one --
    # confirmed via investigation that workers going indefinitely
    # without a code (showing "no code yet" everywhere) was this gap,
    # not a bug in the generation logic itself.
    biometric_api.assign_employee_code_if_missing(worker, owner.id, db)
    db.commit()
    db.refresh(worker)

    # Written immediately, but nothing acts on it until the Sync Worker
    # runs -- registration is never blocked on Portal success.
    db.add(models.SyncStatus(worker_id=worker.id, action="create", state="pending"))
    db.commit()

    return worker


@app.get("/workers", response_model=list[WorkerOut])
def list_workers(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # Multi-tenant boundary: scoped to the authenticated owner at the
    # query level, never trusting an owner_id from client input.
    workers = (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id)
        .order_by(models.Worker.created_at.desc())
        .all()
    )
    # One extra query for every worker's confirmed device mapping (if
    # any), scoped to this owner's own devices -- not a per-worker N+1,
    # and not the direct-employee-code path (see WorkerOut.device_user_id).
    mapping_by_worker_id = dict(
        db.query(models.DeviceUserMapping.worker_id, models.DeviceUserMapping.device_user_id)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
        .filter(models.BiometricDevice.owner_id == owner.id)
        .all()
    )
    return [
        WorkerOut(**w.__dict__, device_user_id=mapping_by_worker_id.get(w.id))
        for w in workers
    ]


@app.get("/workers/missing-compliance", response_model=list[WorkerOut])
def list_workers_missing_compliance(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # Registered ABOVE /workers/{worker_id} deliberately -- route matching
    # is order-sensitive, and a literal path below a {worker_id} path
    # parameter route gets swallowed by it ("missing-compliance" parsed
    # as an int and 422'd). Real bug caught by verify_form12.py, not a
    # style preference.
    compliant_worker_ids = (
        db.query(models.WorkerCompliance.worker_id)
        .join(models.Worker, models.Worker.id == models.WorkerCompliance.worker_id)
        .filter(models.Worker.owner_id == owner.id)
    )
    return (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id, models.Worker.id.not_in(compliant_worker_ids))
        .order_by(models.Worker.created_at.desc())
        .all()
    )


@app.get("/workers/{worker_id}", response_model=WorkerOut)
def get_worker(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    # Real bug, not a hypothetical: returning the bare ORM object here
    # (unlike list_workers just above, which already does this same join)
    # left device_user_id silently defaulting to WorkerOut's None every
    # time, since Worker itself has no such column -- a worker showed as
    # "not mapped yet" on this endpoint even with a confirmed mapping.
    mapping = (
        db.query(models.DeviceUserMapping.device_user_id)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
        .filter(models.BiometricDevice.owner_id == owner.id, models.DeviceUserMapping.worker_id == worker.id)
        .first()
    )
    return WorkerOut(**worker.__dict__, device_user_id=mapping[0] if mapping else None)


# The mobile app compresses to ~400x500px JPEG at ~60-70% quality before
# ever sending this (see AddWorkerScreen/expo-image-manipulator) -- this
# is a server-side safety net, not the primary size control, since a
# client is never fully trustworthy about following its own rules.
MAX_PHOTO_UPLOAD_BYTES = 100 * 1024


@app.post("/workers/{worker_id}/photo", response_model=WorkerOut)
async def upload_worker_photo(
    worker_id: int,
    photo: UploadFile = File(...),
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = _get_owned_worker(worker_id, owner, db)
    photo_bytes = await photo.read()
    if len(photo_bytes) > MAX_PHOTO_UPLOAD_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"Photo is too large ({len(photo_bytes) // 1024}KB) -- must be under {MAX_PHOTO_UPLOAD_BYTES // 1024}KB.",
        )
    try:
        key = photo_storage.upload_worker_photo(worker.id, photo_bytes)
    except photo_storage.PhotoStorageNotConfigured as e:
        raise HTTPException(status_code=500, detail=str(e))
    worker.photo_key = key
    db.commit()
    db.refresh(worker)
    mapping = (
        db.query(models.DeviceUserMapping.device_user_id)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
        .filter(models.BiometricDevice.owner_id == owner.id, models.DeviceUserMapping.worker_id == worker.id)
        .first()
    )
    return WorkerOut(**worker.__dict__, device_user_id=mapping[0] if mapping else None)


@app.post("/workers/{worker_id}/id-card")
def generate_id_card(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = _get_owned_worker(worker_id, owner, db)
    if not worker.photo_key:
        raise HTTPException(status_code=400, detail="Upload a photo for this worker before generating an ID card.")
    try:
        photo_bytes = photo_storage.get_worker_photo(worker.photo_key)
    except photo_storage.PhotoStorageNotConfigured as e:
        raise HTTPException(status_code=500, detail=str(e))
    # Generated fresh from the stored photo + current worker/factory data
    # every time, not cached as its own separate file -- per explicit
    # request, storing both a photo AND a redundant PDF copy of the same
    # information isn't worth the extra storage for how cheap this is to
    # regenerate (a handful of Canvas draw calls, no per-worker register
    # scan like Form 25).
    content, media_type, filename = forms.build_id_card(owner, worker, photo_bytes)
    _log_form_generation(db, owner, "id_card", worker_id, None, None, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.patch("/workers/{worker_id}/deactivate", response_model=WorkerOut)
def deactivate_worker(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # Minimal backend-only deactivate today -- no mobile UI for this yet
    # (that's Day 4's Worker List work), but Day 3's Sync Worker needs a
    # real deactivate path to actually test the full create+deactivate
    # sync lifecycle, not just the create half.
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    worker.status = "deactivated"
    worker.deactivated_at = datetime.now(timezone.utc)
    db.add(models.AuditLog(owner_id=owner.id, worker_id=worker.id, action="deactivate"))
    db.add(models.SyncStatus(worker_id=worker.id, action="deactivate", state="pending"))
    db.commit()
    db.refresh(worker)
    return worker


def _generate_worker_code(db: Session, owner_id: int) -> str:
    """Auto-generated, sequential per owner (T-001, T-002, ...) -- the
    owner no longer has to invent and type a token number by hand. Based
    on how many compliance records this owner already has, not the raw
    worker count, so it can never collide with an existing code even if
    workers were registered out of order."""
    existing_count = (
        db.query(models.WorkerCompliance)
        .join(models.Worker, models.Worker.id == models.WorkerCompliance.worker_id)
        .filter(models.Worker.owner_id == owner_id)
        .count()
    )
    return f"T-{existing_count + 1:03d}"


def _compliance_out(compliance: models.WorkerCompliance, worker: models.Worker) -> WorkerComplianceOut:
    age_now = _age_years(worker.dob, date_.today()) if worker.dob else None
    return WorkerComplianceOut(
        **compliance.__dict__,
        under_minimum_age_warning=age_now is not None and age_now < MINIMUM_WORKING_AGE,
    )


@app.post("/workers/{worker_id}/compliance", response_model=WorkerComplianceOut, status_code=201)
def create_worker_compliance(
    worker_id: int,
    body: WorkerComplianceIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    if not worker.dob:
        raise HTTPException(
            status_code=422, detail="Worker has no date of birth on file -- category can't be computed"
        )
    existing = (
        db.query(models.WorkerCompliance)
        .filter(models.WorkerCompliance.worker_id == worker_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Compliance record already exists -- use PUT to update")

    category = "young_person" if _age_years(worker.dob, date_.today()) < YOUNG_PERSON_AGE_CEILING else "adult"
    body_data = body.model_dump()
    if not body_data.get("worker_code"):
        body_data["worker_code"] = _generate_worker_code(db, owner.id)
    compliance = models.WorkerCompliance(
        worker_id=worker_id,
        category=category,
        registered_by=owner.id,
        **body_data,
    )
    db.add(compliance)
    db.add(models.AuditLog(owner_id=owner.id, worker_id=worker_id, action="compliance_create"))
    db.commit()
    db.refresh(compliance)
    return _compliance_out(compliance, worker)


@app.get("/workers/{worker_id}/compliance", response_model=WorkerComplianceOut)
def get_worker_compliance(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    compliance = (
        db.query(models.WorkerCompliance)
        .filter(models.WorkerCompliance.worker_id == worker_id)
        .first()
    )
    if not compliance:
        raise HTTPException(status_code=404, detail="No compliance record for this worker yet")
    return _compliance_out(compliance, worker)


@app.put("/workers/{worker_id}/compliance", response_model=WorkerComplianceOut)
def update_worker_compliance(
    worker_id: int,
    body: WorkerComplianceIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    compliance = (
        db.query(models.WorkerCompliance)
        .filter(models.WorkerCompliance.worker_id == worker_id)
        .first()
    )
    if not compliance:
        raise HTTPException(status_code=404, detail="No compliance record for this worker yet -- use POST first")

    # category is recomputed, never taken from the request body -- it's
    # always derived from Worker.dob, same rule as creation.
    compliance.category = (
        "young_person" if _age_years(worker.dob, date_.today()) < YOUNG_PERSON_AGE_CEILING else "adult"
    )
    # exclude_unset -- a field the client never included in the request
    # body (e.g. worker_code, which the mobile app no longer lets anyone
    # type since it's auto-generated) must be left alone, not silently
    # wiped to null just because this request didn't mention it.
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(compliance, field, value)
    db.add(models.AuditLog(owner_id=owner.id, worker_id=worker_id, action="compliance_update"))
    db.commit()
    db.refresh(compliance)
    return _compliance_out(compliance, worker)


def _get_owned_worker(worker_id: int, owner: models.Owner, db: Session) -> models.Worker:
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return worker


@app.post("/workers/{worker_id}/wage-profile", response_model=WageProfileOut, status_code=201)
def create_wage_profile(
    worker_id: int,
    body: WageProfileIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # Append-only, deliberately no PUT/edit on an existing row -- a wage
    # slip generated for a past month must keep reflecting that month's
    # rate even after a later correction. See
    # PHASE3_STATUTORY_FORMS_PLAN.md's Day 2 section.
    _get_owned_worker(worker_id, owner, db)
    profile = models.WageProfile(worker_id=worker_id, created_by=owner.id, **body.model_dump())
    db.add(profile)
    db.add(
        models.AuditLog(
            owner_id=owner.id,
            worker_id=worker_id,
            action="wage_rate_set",
            reason=f"{body.rate_type} rate set to {body.basic}, effective {body.effective_from}",
        )
    )
    db.commit()
    db.refresh(profile)
    return profile


@app.get("/workers/{worker_id}/wage-profile", response_model=WageProfileOut)
def get_wage_profile(
    worker_id: int,
    as_of: date_ = Query(default_factory=date_.today),
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    profile = (
        db.query(models.WageProfile)
        .filter(models.WageProfile.worker_id == worker_id, models.WageProfile.effective_from <= as_of)
        # Tie-break on id when two rows share the same effective_from
        # (e.g. a WorkerType-seeded default and a same-day manual
        # override) so the more-recently-added row always wins, not
        # whatever order SQL happens to return ties in.
        .order_by(models.WageProfile.effective_from.desc(), models.WageProfile.id.desc())
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail=f"No wage profile effective on or before {as_of}")
    return profile


@app.get("/workers/{worker_id}/wage-profile/history", response_model=list[WageProfileOut])
def get_wage_profile_history(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    return (
        db.query(models.WageProfile)
        .filter(models.WageProfile.worker_id == worker_id)
        .order_by(models.WageProfile.effective_from.desc(), models.WageProfile.id.desc())
        .all()
    )


@app.get("/worker-types", response_model=list[WorkerTypeOut])
def list_worker_types(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    return db.query(models.WorkerType).filter(models.WorkerType.owner_id == owner.id).order_by(models.WorkerType.name).all()


@app.post("/worker-types", response_model=WorkerTypeOut, status_code=201)
def create_worker_type(
    body: WorkerTypeIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(models.WorkerType)
        .filter(models.WorkerType.owner_id == owner.id, models.WorkerType.name == body.name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"A worker type named {body.name!r} already exists")
    worker_type = models.WorkerType(owner_id=owner.id, **body.model_dump())
    db.add(worker_type)
    db.commit()
    db.refresh(worker_type)
    return worker_type


@app.put("/worker-types/{worker_type_id}", response_model=WorkerTypeOut)
def update_worker_type(
    worker_type_id: int,
    body: WorkerTypeIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker_type = (
        db.query(models.WorkerType)
        .filter(models.WorkerType.id == worker_type_id, models.WorkerType.owner_id == owner.id)
        .first()
    )
    if not worker_type:
        raise HTTPException(status_code=404, detail="Worker type not found")
    worker_type.name = body.name
    worker_type.default_rate_type = body.default_rate_type
    worker_type.default_rate = body.default_rate
    db.commit()
    db.refresh(worker_type)
    return worker_type


@app.delete("/worker-types/{worker_type_id}", status_code=204)
def delete_worker_type(
    worker_type_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker_type = (
        db.query(models.WorkerType)
        .filter(models.WorkerType.id == worker_type_id, models.WorkerType.owner_id == owner.id)
        .first()
    )
    if not worker_type:
        raise HTTPException(status_code=404, detail="Worker type not found")
    # Assigned workers keep their worker_type_id pointing at a row that no
    # longer exists otherwise -- clear the assignment first so WorkerOut
    # never has to handle a dangling reference.
    db.query(models.Worker).filter(models.Worker.worker_type_id == worker_type_id).update({"worker_type_id": None})
    db.delete(worker_type)
    db.commit()


@app.put("/workers/{worker_id}/worker-type", response_model=WorkerOut)
def assign_worker_type(
    worker_id: int,
    body: WorkerTypeAssignIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Assigning a type to a worker who has no WageProfile yet auto-creates
    one from the type's defaults, effective today -- "defaults to that
    type's rate unless individually overridden". A worker who already has
    a rate keeps it: that rate already IS their override, so it's never
    touched here. This deliberately reuses WageProfile as the one source
    of truth for wages instead of adding a second, competing rate field."""
    worker = _get_owned_worker(worker_id, owner, db)
    if body.worker_type_id is not None:
        worker_type = (
            db.query(models.WorkerType)
            .filter(models.WorkerType.id == body.worker_type_id, models.WorkerType.owner_id == owner.id)
            .first()
        )
        if not worker_type:
            raise HTTPException(status_code=404, detail="Worker type not found")
        has_rate = db.query(models.WageProfile).filter(models.WageProfile.worker_id == worker_id).first()
        if not has_rate:
            db.add(
                models.WageProfile(
                    worker_id=worker_id,
                    created_by=owner.id,
                    rate_type=worker_type.default_rate_type,
                    basic=worker_type.default_rate,
                    # EPF's statutory employee contribution rate -- WageProfile.pf_rate
                    # defaults to 0 otherwise, silently leaving PF unset on every
                    # auto-created profile. Still just a default: the owner can
                    # override it same as basic/rate_type, per DEFAULT_PF_RATE_PERCENT's
                    # own docstring below.
                    pf_rate=DEFAULT_PF_RATE_PERCENT,
                    effective_from=date_.today(),
                )
            )
            db.add(
                models.AuditLog(
                    owner_id=owner.id,
                    worker_id=worker_id,
                    action="wage_rate_set",
                    reason=f"auto-created from worker type '{worker_type.name}' default ({worker_type.default_rate_type} {worker_type.default_rate})",
                )
            )
    worker.worker_type_id = body.worker_type_id
    db.commit()
    db.refresh(worker)
    return worker


@app.post("/workers/{worker_id}/leave", response_model=LeaveEntryOut, status_code=201)
def create_leave_entry(
    worker_id: int,
    body: LeaveEntryIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    if body.date_to < body.date_from:
        raise HTTPException(status_code=422, detail="date_to must not be before date_from")
    entry = models.LeaveEntry(worker_id=worker_id, marked_by=owner.id, **body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@app.get("/workers/{worker_id}/leave", response_model=list[LeaveEntryOut])
def list_leave_entries(
    worker_id: int,
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    # Overlap, not containment -- an entry that only partially falls
    # inside the requested range should still show up (e.g. a leave
    # spanning month-end).
    return (
        db.query(models.LeaveEntry)
        .filter(
            models.LeaveEntry.worker_id == worker_id,
            models.LeaveEntry.date_from <= end_date,
            models.LeaveEntry.date_to >= start_date,
        )
        .order_by(models.LeaveEntry.date_from)
        .all()
    )


@app.get("/leave", response_model=list[LeaveEntryOut])
def list_leave_entries_for_owner(
    date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Every worker's leave entries overlapping one date, in a single
    call -- backs Dashboard's inline Leave chip. Without this, showing
    leave state for N workers on the Dashboard would mean N separate
    per-worker requests."""
    return (
        db.query(models.LeaveEntry)
        .join(models.Worker, models.Worker.id == models.LeaveEntry.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.LeaveEntry.date_from <= date, models.LeaveEntry.date_to >= date)
        .all()
    )


@app.delete("/leave/{leave_id}", status_code=204)
def delete_leave_entry(
    leave_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    entry = (
        db.query(models.LeaveEntry)
        .join(models.Worker, models.Worker.id == models.LeaveEntry.worker_id)
        .filter(models.LeaveEntry.id == leave_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Leave entry not found")
    db.delete(entry)
    db.commit()


@app.post("/workers/{worker_id}/wage-payment", response_model=WagePaymentOut, status_code=201)
def upsert_wage_payment(
    worker_id: int,
    body: WagePaymentIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    existing = (
        db.query(models.WagePayment)
        .filter(
            models.WagePayment.worker_id == worker_id,
            models.WagePayment.month == body.month,
            models.WagePayment.year == body.year,
        )
        .first()
    )
    if existing:
        existing.date_of_payment = body.date_of_payment
        existing.payment_reference = body.payment_reference
        existing.recorded_by = owner.id
        db.commit()
        db.refresh(existing)
        return existing
    payment = models.WagePayment(worker_id=worker_id, recorded_by=owner.id, **body.model_dump())
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _worker_wage_out(worker: models.Worker, wage: dict | None) -> WorkerWageOut:
    """The same figures Form 15/Wage Slip print, as JSON -- shared by the
    per-worker wage-computation endpoint and the factory-wide summary so
    both always agree on the same breakdown."""
    if wage is None:
        return WorkerWageOut(
            worker_id=worker.id,
            worker_name=worker.name,
            numeric_employee_code=worker.numeric_employee_code,
            has_rate=False,
            days_worked=0,
            gross_wage=0,
            net_wage=0,
            paid=False,
        )
    return WorkerWageOut(
        worker_id=worker.id,
        worker_name=worker.name,
        numeric_employee_code=worker.numeric_employee_code,
        has_rate=True,
        days_worked=wage["summary"]["days_worked"],
        days_absent=wage["summary"]["days_absent"],
        gross_wage=wage["gross"],
        net_wage=wage["net"],
        paid=wage["payment"] is not None and wage["payment"].date_of_payment is not None,
        rate_amount=wage["rate"].basic,
        rate_type=wage["rate"].rate_type,
        basic_wage=wage["basic_wage"],
        da=wage["rate"].da,
        hra=wage["rate"].hra,
        other_allowances=wage["rate"].other_allowances,
        ot_wages=wage["ot_wages"],
        leave_wages=wage["leave_wages"],
        pf=wage["pf"],
        pf_rate=wage["rate"].pf_rate,
        pf_base=wage["basic_wage"] + wage["rate"].da,
        esi=wage["esi"],
        esi_rate=wage["rate"].esi_rate,
        esi_base=wage["gross"],
        lwf=wage["lwf"],
        total_deductions=wage["total_deductions"],
    )


@app.get("/workers/{worker_id}/wage-computation", response_model=WorkerWageOut)
def get_worker_wage_computation(
    worker_id: int,
    month: int,
    year: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """The same figures Form 15/Wage Slip print, as JSON -- backs the
    "Total Wages" summary on the worker's monthly attendance screen and
    the wage detail breakdown on the Wage Calculation tab."""
    worker = _get_owned_worker(worker_id, owner, db)
    wage = forms.compute_wage(db, owner.id, worker_id, month, year)
    return _worker_wage_out(worker, wage)


@app.get("/wage-summary", response_model=WageSummaryOut)
def get_wage_summary(
    month: int,
    year: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Factory-wide monthly wage bill -- every active worker's
    contribution to the total, for the Wage Calculation tab."""
    workers = [w for w in forms._all_workers(db, owner.id) if w.status == "active"]
    results = []
    total_gross = 0.0
    total_net = 0.0
    for worker in workers:
        wage = forms.compute_wage(db, owner.id, worker.id, month, year)
        if wage is not None:
            total_gross += wage["gross"]
            total_net += wage["net"]
        results.append(_worker_wage_out(worker, wage))
    return WageSummaryOut(
        period_label=f"{year}-{month:02d}", total_workers=len(workers), total_gross=total_gross, total_net=total_net, workers=results
    )


@app.get("/wage-summary/daily", response_model=DailyWageSummaryOut)
def get_daily_wage_summary(
    date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Factory-wide labour cost for one specific day -- a quick
    cash-flow figure, not the statutory monthly wage register."""
    workers = [w for w in forms._all_workers(db, owner.id) if w.status == "active"]
    results = []
    total_cost = 0.0
    present_count = 0
    for worker in workers:
        daily = forms.compute_daily_wage(db, worker.id, date)
        if daily["present"]:
            present_count += 1
            total_cost += daily["daily_cost"]
        results.append(
            DailyWorkerWageOut(
                worker_id=worker.id,
                worker_name=worker.name,
                numeric_employee_code=worker.numeric_employee_code,
                has_rate=daily["has_rate"],
                present=daily["present"],
                daily_cost=daily["daily_cost"],
            )
        )
    return DailyWageSummaryOut(date=date, total_workers_present=present_count, total_daily_cost=total_cost, workers=results)


@app.post("/portal-credentials", status_code=204)
def set_portal_credentials(
    body: PortalCredentialIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(models.PortalCredential)
        .filter(models.PortalCredential.owner_id == owner.id)
        .first()
    )
    if existing:
        existing.portal_username = body.portal_username
        existing.portal_password = body.portal_password
    else:
        db.add(
            models.PortalCredential(
                owner_id=owner.id,
                portal_username=body.portal_username,
                portal_password=body.portal_password,
            )
        )
    db.commit()


@app.post("/sync/run", status_code=202)
def run_sync(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Manual trigger -- Day 3 testing shouldn't have to wait for a real
    daily schedule. Scoped to the authenticated owner only, matching the
    multi-tenant boundary everywhere else -- no owner can trigger sync
    for any other owner's workers."""
    sync_worker.reconcile_today(db, owner.id)
    return {"status": "sync run complete"}


@app.get("/sync-status", response_model=list[SyncStatusOut])
def list_sync_status(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    return (
        db.query(models.SyncStatus)
        .join(models.Worker, models.Worker.id == models.SyncStatus.worker_id)
        .filter(models.Worker.owner_id == owner.id)
        .order_by(models.SyncStatus.id.desc())
        .all()
    )


@app.get("/shift-configs", response_model=list[ShiftConfigOut])
def list_shift_configs(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    return _shift_configs_for_owner(db, owner.id)


@app.post("/shift-configs", response_model=ShiftConfigOut, status_code=201)
def create_shift_config(
    body: ShiftConfigIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(models.ShiftConfig)
        .filter(models.ShiftConfig.owner_id == owner.id, models.ShiftConfig.slot_key == body.slot_key)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"A shift with slot_key {body.slot_key!r} already exists")
    max_sort_order = (
        db.query(func.max(models.ShiftConfig.sort_order))
        .filter(models.ShiftConfig.owner_id == owner.id)
        .scalar()
    )
    shift = models.ShiftConfig(
        owner_id=owner.id,
        sort_order=(max_sort_order + 1) if max_sort_order is not None else 0,
        **body.model_dump(),
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift


@app.put("/shift-configs/{shift_id}", response_model=ShiftConfigOut)
def update_shift_config(
    shift_id: int,
    body: ShiftConfigIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    shift = (
        db.query(models.ShiftConfig)
        .filter(models.ShiftConfig.id == shift_id, models.ShiftConfig.owner_id == owner.id)
        .first()
    )
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    shift.label = body.label
    shift.start_time = body.start_time
    shift.end_time = body.end_time
    shift.rest_interval = body.rest_interval
    db.commit()
    db.refresh(shift)
    return shift


@app.delete("/shift-configs/{shift_id}", status_code=204)
def delete_shift_config(
    shift_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    shift = (
        db.query(models.ShiftConfig)
        .filter(models.ShiftConfig.id == shift_id, models.ShiftConfig.owner_id == owner.id)
        .first()
    )
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    in_use = (
        db.query(models.Attendance)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.Attendance.slot == shift.slot_key)
        .first()
    )
    if in_use:
        raise HTTPException(
            status_code=409, detail="This shift has attendance history and can't be deleted"
        )
    db.delete(shift)
    db.commit()


@app.post("/attendance", response_model=AttendanceOut)
def mark_attendance(
    body: AttendanceMarkIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    owner_slot_keys = {s.slot_key for s in _shift_configs_for_owner(db, owner.id)}
    if body.slot not in owner_slot_keys:
        raise HTTPException(status_code=422, detail=f"slot must be one of {sorted(owner_slot_keys)}")
    if body.status not in ATTENDANCE_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {ATTENDANCE_STATUSES}")

    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == body.worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    # Upsert on (worker_id, date, slot) -- re-marking the same slot updates
    # it rather than creating a duplicate row (matches the DB's own unique
    # constraint, so this also avoids ever hitting that constraint error).
    # Shared with the biometric sync job (attendance_service.py) so a
    # supervisor's manual tap and a resolved punch write the same way.
    return upsert_attendance(
        db,
        worker_id=body.worker_id,
        date=body.date,
        slot=body.slot,
        status=body.status,
        overtime_hours=body.overtime_hours,
        marked_by=owner.id,
        source="manual",
        source_detail=owner.name,
    )


@app.get("/attendance", response_model=list[AttendanceOut])
def list_attendance(
    date: date_ = Query(default_factory=date_.today),
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    return (
        db.query(models.Attendance)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.Attendance.date == date)
        .all()
    )


@app.get("/workers/{worker_id}/attendance-month", response_model=list[AttendanceOut])
def list_worker_attendance_month(
    worker_id: int,
    month: int,
    year: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Backs the per-worker whole-month attendance view -- one call for
    every day of the month, instead of the owner-wide /attendance
    endpoint called once per day (30 requests, each returning every
    other worker's rows too, just to filter down to one)."""
    _get_owned_worker(worker_id, owner, db)
    start_date, end_date = forms._month_date_range(month, year)
    return (
        db.query(models.Attendance)
        .filter(
            models.Attendance.worker_id == worker_id,
            models.Attendance.date >= start_date,
            models.Attendance.date <= end_date,
        )
        .all()
    )


@app.get("/dashboard", response_model=DashboardOut)
def get_dashboard(
    date: date_ = Query(default_factory=date_.today),
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    active_workers = (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id, models.Worker.status == "active")
        .all()
    )
    total = len(active_workers)
    active_ids = {w.id for w in active_workers}

    records = (
        db.query(models.Attendance)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.Attendance.date == date)
        .all()
    )

    # "Present today" = marked present in at least one slot -- a worker
    # present only in the AM slot still counts, not just all-slots-present.
    present_worker_ids = {
        r.worker_id for r in records if r.status == "present" and r.worker_id in active_ids
    }

    slots = []
    for shift in _shift_configs_for_owner(db, owner.id):
        slot_present = sum(
            1
            for r in records
            if r.slot == shift.slot_key and r.status == "present" and r.worker_id in active_ids
        )
        slots.append(SlotSummary(slot=shift.slot_key, present=slot_present, total=total))

    return DashboardOut(
        date=date,
        total_workers=total,
        present_today=len(present_worker_ids),
        slots=slots,
    )


def _log_form_generation(
    db: Session, owner: models.Owner, form_code: str, worker_id: int | None, start_date: date_ | None, end_date: date_ | None, action: str
) -> None:
    period_label = f"{start_date.isoformat()} to {end_date.isoformat()}" if start_date and end_date else None
    db.add(
        models.FormGenerationLog(
            owner_id=owner.id,
            worker_id=worker_id,
            form_code=form_code,
            period_label=period_label,
            action=action,
            generated_by=owner.id,
        )
    )
    db.commit()


@app.get("/form-templates", response_model=list[FormTemplateOut])
def list_form_templates(
    state: str,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Which Form Types show up in Forms & Reports for the selected
    state -- reference data (not owner-scoped), seeded via migration.
    A state with no rows yet (anything beyond Tamil Nadu/Karnataka today)
    returns an empty list rather than an error -- the frontend already
    handles "no form types available" the same way it handles "no
    workers yet"."""
    templates = (
        db.query(models.FormTemplate)
        .filter(models.FormTemplate.state == state)
        .order_by(models.FormTemplate.id)
        .all()
    )
    # ID Card isn't a state-specific statutory register (unlike
    # everything else in form_templates) -- it's the same document
    # regardless of which state's forms an owner is on, so it's appended
    # here rather than seeded as a per-state DB row that would need
    # inserting again for every future state.
    return [*templates, FormTemplateOut(form_code="id_card", label="ID Card (Duplicate)", is_available=True)]


def _generate_form_content(
    db: Session,
    owner: models.Owner,
    form_code: str,
    worker_id: int | None,
    start_date: date_ | None,
    end_date: date_ | None,
) -> tuple[bytes, str, str]:
    """Every form is PDF only -- Excel export was removed entirely per
    explicit request, so there's no format parameter to validate here
    anymore (there used to be). form25/form25b/form15/wageslip accept a
    real date range, not a single month -- each calendar month the range
    touches gets its own complete statutory section inside one combined
    PDF (see forms.py's _months_in_range)."""
    if form_code == "form25":
        return forms.build_form25(db, owner, start_date, end_date)
    if form_code == "form15":
        return forms.build_form15(db, owner, start_date, end_date)
    if form_code == "form12":
        worker = _get_owned_worker(worker_id, owner, db) if worker_id is not None else None
        return forms.build_form12(db, owner, worker=worker)
    if form_code == "form25b":
        worker = _get_owned_worker(worker_id, owner, db)
        return forms.build_form25b(db, owner, worker, start_date, end_date)
    if form_code == "wageslip":
        worker = _get_owned_worker(worker_id, owner, db)
        return forms.build_wageslip(db, owner, worker, start_date, end_date)
    # A stubbed form_templates row (Karnataka today) is listed so the
    # owner knows it's coming, but has no build_* implementation yet --
    # a real "not built yet" response, not the same as a typo'd form_code.
    template = db.query(models.FormTemplate).filter(models.FormTemplate.form_code == form_code).first()
    if template is not None and not template.is_available:
        raise HTTPException(status_code=501, detail=f"{template.label} isn't available yet.")
    raise HTTPException(status_code=404, detail=f"Unknown form_code {form_code!r}")


@app.get("/forms/form25")
def get_form25(
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, media_type, filename = _generate_form_content(db, owner, "form25", None, start_date, end_date)
    _log_form_generation(db, owner, "form25", None, start_date, end_date, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/form25b")
def get_form25b(
    worker_id: int,
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, media_type, filename = _generate_form_content(db, owner, "form25b", worker_id, start_date, end_date)
    _log_form_generation(db, owner, "form25b", worker_id, start_date, end_date, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/form12")
def get_form12_register(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """The full register -- every worker who has ever been employed, one
    row each, in registration order. This is what a real Form 12 is: a
    running register, not a per-worker sheet."""
    content, media_type, filename = _generate_form_content(db, owner, "form12", None, None, None)
    _log_form_generation(db, owner, "form12", None, None, None, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/form12/{worker_id}")
def get_form12(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """A single register row for one worker -- same exact 24-column
    layout as the full register, just narrowed to one worker."""
    content, media_type, filename = _generate_form_content(db, owner, "form12", worker_id, None, None)
    _log_form_generation(db, owner, "form12", worker_id, None, None, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/form15")
def get_form15(
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, media_type, filename = _generate_form_content(db, owner, "form15", None, start_date, end_date)
    _log_form_generation(db, owner, "form15", None, start_date, end_date, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/wageslip")
def get_wageslip(
    worker_id: int,
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, media_type, filename = _generate_form_content(db, owner, "wageslip", worker_id, start_date, end_date)
    _log_form_generation(db, owner, "wageslip", worker_id, start_date, end_date, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/forms/{form_code}/email", status_code=202)
def email_form(
    form_code: str,
    body: FormEmailIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if body.start_date and body.end_date and body.end_date < body.start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, _media_type, filename = _generate_form_content(db, owner, form_code, body.worker_id, body.start_date, body.end_date)
    send_report_email(
        to_email=body.recipient_email,
        subject=f"{owner.factory_name} -- {form_code}",
        body_text=f"Attached: {form_code} from {owner.factory_name}.",
        attachment_bytes=content,
        attachment_filename=filename,
        format="pdf",
    )
    _log_form_generation(db, owner, form_code, body.worker_id, body.start_date, body.end_date, "emailed")
    return {"status": "email sent"}


@app.get("/reports/attendance")
def download_report(
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")

    content, media_type, filename = reports.build_report(db, owner, start_date, end_date)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/reports/attendance/email", status_code=202)
def email_report(
    body: ReportEmailIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if body.end_date < body.start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")

    content, _media_type, filename = reports.build_report(db, owner, body.start_date, body.end_date)
    send_report_email(
        to_email=body.recipient_email,
        subject=f"{owner.factory_name} attendance report ({body.start_date} to {body.end_date})",
        body_text=(
            f"Attached: attendance report for {owner.factory_name}, "
            f"{body.start_date} to {body.end_date}."
        ),
        attachment_bytes=content,
        attachment_filename=filename,
        format="pdf",
    )
    return {"status": "email sent"}
