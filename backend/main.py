from contextlib import asynccontextmanager
from datetime import date as date_, datetime, timezone

from fastapi import Depends, FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

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
    HealthOut,
    OcrFieldsOut,
    OwnerLoginIn,
    OwnerOut,
    OwnerSignupIn,
    PortalCredentialIn,
    ReportEmailIn,
    SlotSummary,
    SyncStatusOut,
    TokenOut,
    WorkerCreateIn,
    WorkerOut,
)

ATTENDANCE_SLOTS = ("AM", "PM", "Evening")
ATTENDANCE_STATUSES = ("present", "absent")

MAX_WORKERS_PER_OWNER = 50


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
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


@app.post("/attendance", response_model=AttendanceOut)
def mark_attendance(
    body: AttendanceMarkIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if body.slot not in ATTENDANCE_SLOTS:
        raise HTTPException(status_code=422, detail=f"slot must be one of {ATTENDANCE_SLOTS}")
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
        record.marked_by = owner.id
        record.marked_at = datetime.now(timezone.utc)
    else:
        record = models.Attendance(
            worker_id=body.worker_id,
            date=body.date,
            slot=body.slot,
            status=body.status,
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
    for slot in ATTENDANCE_SLOTS:
        slot_present = sum(
            1 for r in records if r.slot == slot and r.status == "present" and r.worker_id in active_ids
        )
        slots.append(SlotSummary(slot=slot, present=slot_present, total=total))

    return DashboardOut(
        date=date,
        total_workers=total,
        present_today=len(present_worker_ids),
        slots=slots,
    )


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
