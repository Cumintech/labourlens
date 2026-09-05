import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, field_validator


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
    factory_address: str | None = None
    factory_licence_no: str | None = None


class FactoryProfileIn(BaseModel):
    factory_address: str | None = None
    factory_licence_no: str | None = None


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
    current_address: str | None = None


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
    deactivated_at: datetime | None
    deactivated_reason: str | None
    created_at: datetime


class PortalCredentialIn(BaseModel):
    portal_username: str
    portal_password: str


class SyncStatusOut(BaseModel):
    id: int
    worker_id: int
    action: str
    state: str
    attempts: int
    last_attempted_at: datetime | None
    last_error: str | None


class AttendanceMarkIn(BaseModel):
    worker_id: int
    date: date
    slot: str  # matches one of the owner's ShiftConfig.slot_key values
    status: str  # "present" | "absent"
    overtime_hours: float = 0


class AttendanceOut(BaseModel):
    id: int
    worker_id: int
    date: date
    slot: str
    status: str
    overtime_hours: float
    marked_at: datetime


class SlotSummary(BaseModel):
    slot: str
    present: int
    total: int


class DashboardOut(BaseModel):
    date: date
    total_workers: int
    present_today: int  # active workers marked present in at least one slot
    slots: list[SlotSummary]


class ReportEmailIn(BaseModel):
    start_date: date
    end_date: date
    recipient_email: str
    format: str  # "pdf" | "excel"


_HHMM_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _validate_hhmm(value: str | None) -> str | None:
    if value is not None and not _HHMM_PATTERN.match(value):
        raise ValueError(f"must be 24-hour HH:MM, got {value!r}")
    return value


class ShiftConfigIn(BaseModel):
    slot_key: str
    label: str
    start_time: str | None = None  # "HH:MM", 24-hour
    end_time: str | None = None
    rest_interval: str | None = None  # free text, e.g. "1:00 PM - 1:30 PM"

    _validate_start_time = field_validator("start_time")(_validate_hhmm)
    _validate_end_time = field_validator("end_time")(_validate_hhmm)


class ShiftConfigOut(BaseModel):
    id: int
    slot_key: str
    label: str
    start_time: str | None
    end_time: str | None
    rest_interval: str | None
    sort_order: int


class WorkerComplianceIn(BaseModel):
    worker_code: str | None = None
    father_or_spouse_name: str | None = None
    designation_or_nature_of_work: str | None = None
    epf_uan_no: str | None = None
    esic_no: str | None = None
    fitness_cert_no: str | None = None
    fitness_cert_valid_till: date | None = None
    date_of_joining: date | None = None
    date_made_permanent: date | None = None
    suspension_period: str | None = None


class WorkerComplianceOut(BaseModel):
    id: int
    worker_id: int
    worker_code: str | None
    father_or_spouse_name: str | None
    designation_or_nature_of_work: str | None
    epf_uan_no: str | None
    esic_no: str | None
    category: str
    fitness_cert_no: str | None
    fitness_cert_valid_till: date | None
    date_of_joining: date | None
    date_made_permanent: date | None
    suspension_period: str | None
    registered_at: datetime
    # Not a stored field -- computed fresh every response from Worker.dob
    # as of "now". True only when the worker is below the Factories Act's
    # actual minimum working age (14), a stricter floor than the
    # adult/young_person (18) split above. Warn-only, per plan: never
    # blocks registration or save.
    under_minimum_age_warning: bool = False


class WageProfileIn(BaseModel):
    rate_type: Literal["daily", "monthly"] = "daily"
    basic: float
    hra: float = 0
    da: float = 0
    other_allowances: float = 0
    pf_rate: float = 0
    esi_rate: float = 0
    lwf_amount: float = 0
    effective_from: date


class WageProfileOut(BaseModel):
    id: int
    worker_id: int
    rate_type: str
    basic: float
    hra: float
    da: float
    other_allowances: float
    pf_rate: float
    esi_rate: float
    lwf_amount: float
    effective_from: date
    created_at: datetime


class LeaveEntryIn(BaseModel):
    leave_type: Literal["earned", "national_festival_special", "other"]
    date_from: date
    date_to: date
    days: float
    wages_paid: float | None = None


class LeaveEntryOut(BaseModel):
    id: int
    worker_id: int
    leave_type: str
    date_from: date
    date_to: date
    days: float
    wages_paid: float | None
    created_at: datetime


class WagePaymentIn(BaseModel):
    month: int
    year: int
    date_of_payment: date | None = None
    payment_reference: str | None = None


class FormEmailIn(BaseModel):
    worker_id: int | None = None  # omit for factory-wide forms (form25, form15)
    month: int | None = None  # omit for form12 (one-time, no period)
    year: int | None = None
    format: Literal["pdf", "excel"] = "pdf"
    recipient_email: str


class WagePaymentOut(BaseModel):
    id: int
    worker_id: int
    month: int
    year: int
    date_of_payment: date | None
    payment_reference: str | None
    created_at: datetime
