from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import ocr
from auth import create_token, get_current_owner, hash_password, verify_password
from crypto import mask_aadhaar
from database import Base, engine, get_db
from schemas import (
    HealthOut,
    OcrFieldsOut,
    OwnerLoginIn,
    OwnerOut,
    OwnerSignupIn,
    TokenOut,
    WorkerCreateIn,
    WorkerOut,
)

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


# Day 3: /workers/{id}/sync (manual retry), Sync Worker background job
# Day 4: /attendance, /dashboard, /reports, /workers/{id}/deactivate
# Routes intentionally not stubbed here -- an empty/fake endpoint would
# claim functionality that doesn't exist yet.
