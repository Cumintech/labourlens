from contextlib import asynccontextmanager
from datetime import date as date_, datetime, timezone

from fastapi import Depends, FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

import forms
import models
import ocr
import reports
import sync_worker
from auth import create_token, get_current_owner, hash_password, verify_password
from crypto import mask_aadhaar
from database import Base, engine, get_db
from email_service import send_report_email
from schemas import (
    AttendanceMarkIn,
    AttendanceOut,
    DashboardOut,
    FactoryProfileIn,
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
    WorkerComplianceIn,
    WorkerComplianceOut,
    WorkerCreateIn,
    WorkerOut,
)

ATTENDANCE_STATUSES = ("present", "absent", "leave")

MAX_WORKERS_PER_OWNER = 50

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
    ocr.warm_up()
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


@app.get("/health", response_model=HealthOut)
def health():
    return HealthOut(status="ok", time=datetime.now(timezone.utc))


@app.post("/owners/signup", response_model=TokenOut, status_code=201)
def signup(body: OwnerSignupIn, db: Session = Depends(get_db)):
    existing = db.query(models.Owner).filter(models.Owner.mobile == body.mobile).first()
    if existing:
        raise HTTPException(status_code=409, detail="An owner with this mobile number already exists")

    owner = models.Owner(
        name=body.name,
        mobile=body.mobile,
        password_hash=hash_password(body.password),
        factory_name=body.factory_name,
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
    db.commit()

    token = create_token(owner.id)
    return TokenOut(access_token=token, owner=OwnerOut(**owner.__dict__))


@app.post("/owners/login", response_model=TokenOut)
def login(body: OwnerLoginIn, db: Session = Depends(get_db)):
    owner = db.query(models.Owner).filter(models.Owner.mobile == body.mobile).first()
    if not owner or not verify_password(body.password, owner.password_hash):
        raise HTTPException(status_code=401, detail="Invalid mobile number or password")

    token = create_token(owner.id)
    return TokenOut(access_token=token, owner=OwnerOut(**owner.__dict__))


@app.get("/owners/me", response_model=OwnerOut)
def get_me(owner: models.Owner = Depends(get_current_owner)):
    return OwnerOut(**owner.__dict__)


@app.put("/owners/me/factory-profile", response_model=OwnerOut)
def update_factory_profile(
    body: FactoryProfileIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    owner.factory_address = body.factory_address
    owner.factory_licence_no = body.factory_licence_no
    db.commit()
    db.refresh(owner)
    return OwnerOut(**owner.__dict__)


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
    return (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id)
        .order_by(models.Worker.created_at.desc())
        .all()
    )


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
    return worker


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
        .order_by(models.WageProfile.effective_from.desc())
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
        .order_by(models.WageProfile.effective_from.desc())
        .all()
    )


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
    record = (
        db.query(models.Attendance)
        .filter(
            models.Attendance.worker_id == body.worker_id,
            models.Attendance.date == body.date,
            models.Attendance.slot == body.slot,
        )
        .first()
    )
    if record:
        record.status = body.status
        record.overtime_hours = body.overtime_hours
        record.marked_by = owner.id
        record.marked_at = datetime.now(timezone.utc)
    else:
        record = models.Attendance(
            worker_id=body.worker_id,
            date=body.date,
            slot=body.slot,
            status=body.status,
            overtime_hours=body.overtime_hours,
            marked_by=owner.id,
        )
        db.add(record)
    db.commit()
    db.refresh(record)
    return record


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
    db: Session, owner: models.Owner, form_code: str, worker_id: int | None, month: int | None, year: int | None, action: str
) -> None:
    period_label = f"{year}-{month:02d}" if month and year else None
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


def _generate_form_content(
    db: Session,
    owner: models.Owner,
    form_code: str,
    worker_id: int | None,
    month: int | None,
    year: int | None,
    format: str,
) -> tuple[bytes, str, str]:
    if format not in ("pdf", "excel"):
        raise HTTPException(status_code=422, detail="format must be 'pdf' or 'excel'")

    if form_code == "form25":
        return forms.build_form25(db, owner, month, year, format)
    if form_code == "form15":
        return forms.build_form15(db, owner, month, year, format)
    if form_code == "form12":
        worker = _get_owned_worker(worker_id, owner, db) if worker_id is not None else None
        return forms.build_form12(db, owner, format, worker=worker)
    if form_code == "form25b":
        worker = _get_owned_worker(worker_id, owner, db)
        return forms.build_form25b(db, owner, worker, month, year, format)
    if form_code == "wageslip":
        worker = _get_owned_worker(worker_id, owner, db)
        return forms.build_wageslip(db, owner, worker, month, year, format)
    raise HTTPException(status_code=404, detail=f"Unknown form_code {form_code!r}")


@app.get("/forms/form25")
def get_form25(
    month: int,
    year: int,
    format: str = "pdf",
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    content, media_type, filename = _generate_form_content(db, owner, "form25", None, month, year, format)
    _log_form_generation(db, owner, "form25", None, month, year, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/form25b")
def get_form25b(
    worker_id: int,
    month: int,
    year: int,
    format: str = "pdf",
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    content, media_type, filename = _generate_form_content(db, owner, "form25b", worker_id, month, year, format)
    _log_form_generation(db, owner, "form25b", worker_id, month, year, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/form12")
def get_form12_register(
    format: str = "pdf",
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """The full register -- every worker who has ever been employed, one
    row each, in registration order. This is what a real Form 12 is: a
    running register, not a per-worker sheet."""
    content, media_type, filename = _generate_form_content(db, owner, "form12", None, None, None, format)
    _log_form_generation(db, owner, "form12", None, None, None, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/form12/{worker_id}")
def get_form12(
    worker_id: int,
    format: str = "pdf",
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """A single register row for one worker -- same exact 24-column
    layout as the full register, just narrowed to one worker."""
    content, media_type, filename = _generate_form_content(db, owner, "form12", worker_id, None, None, format)
    _log_form_generation(db, owner, "form12", worker_id, None, None, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/form15")
def get_form15(
    month: int,
    year: int,
    format: str = "pdf",
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    content, media_type, filename = _generate_form_content(db, owner, "form15", None, month, year, format)
    _log_form_generation(db, owner, "form15", None, month, year, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/forms/wageslip")
def get_wageslip(
    worker_id: int,
    month: int,
    year: int,
    format: str = "pdf",
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    content, media_type, filename = _generate_form_content(db, owner, "wageslip", worker_id, month, year, format)
    _log_form_generation(db, owner, "wageslip", worker_id, month, year, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/forms/{form_code}/email", status_code=202)
def email_form(
    form_code: str,
    body: FormEmailIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    content, _media_type, filename = _generate_form_content(
        db, owner, form_code, body.worker_id, body.month, body.year, body.format
    )
    send_report_email(
        to_email=body.recipient_email,
        subject=f"{owner.factory_name} -- {form_code}",
        body_text=f"Attached: {form_code} from {owner.factory_name}.",
        attachment_bytes=content,
        attachment_filename=filename,
        format=body.format,
    )
    _log_form_generation(db, owner, form_code, body.worker_id, body.month, body.year, "emailed")
    return {"status": "email sent"}


@app.get("/reports/attendance")
def download_report(
    start_date: date_,
    end_date: date_,
    format: str = "excel",
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if format not in ("excel", "pdf"):
        raise HTTPException(status_code=422, detail="format must be 'excel' or 'pdf'")
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")

    content, media_type, filename = reports.build_report(db, owner, start_date, end_date, format)
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
    if body.format not in ("excel", "pdf"):
        raise HTTPException(status_code=422, detail="format must be 'excel' or 'pdf'")
    if body.end_date < body.start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")

    content, _media_type, filename = reports.build_report(
        db, owner, body.start_date, body.end_date, body.format
    )
    send_report_email(
        to_email=body.recipient_email,
        subject=f"{owner.factory_name} attendance report ({body.start_date} to {body.end_date})",
        body_text=(
            f"Attached: attendance report for {owner.factory_name}, "
            f"{body.start_date} to {body.end_date}."
        ),
        attachment_bytes=content,
        attachment_filename=filename,
        format=body.format,
    )
    return {"status": "email sent"}
