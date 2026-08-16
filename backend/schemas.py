from datetime import date, datetime

from pydantic import BaseModel


class OwnerSignupIn(BaseModel):
    name: str
    mobile: str
    password: str
    factory_name: str


class OwnerLoginIn(BaseModel):
    mobile: str
    password: str


class OwnerOut(BaseModel):
    id: int
    name: str
    mobile: str
    factory_name: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    owner: OwnerOut


class HealthOut(BaseModel):
    status: str
    time: datetime


class OcrFieldsOut(BaseModel):
    # Every field optional -- OCR may not find all (or any) of them; the
    # owner fills in whatever's missing via the manual-correction UI.
    name: str | None = None
    dob: date | None = None
    gender: str | None = None
    aadhaar_number: str | None = None


class WorkerCreateIn(BaseModel):
    name: str
    mobile: str | None = None
    dob: date | None = None
    gender: str | None = None
    aadhaar_number: str  # raw, plaintext in transit over HTTPS -- masked/
    # encrypted immediately on the server before it touches the database.
    current_address: str | None = None
    current_district: str | None = None
    native_address: str | None = None
    native_district: str | None = None
    bank_account_number: str | None = None
    bank_ifsc: str | None = None


class WorkerOut(BaseModel):
    id: int
    owner_id: int
    name: str
    mobile: str | None
    dob: date | None
    gender: str | None
    aadhaar_last4: str  # never the full number -- see models.py
    status: str
    created_at: datetime
