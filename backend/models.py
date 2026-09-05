from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from crypto import EncryptedString
from database import Base


class Owner(Base):
    __tablename__ = "owners"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    mobile: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    factory_name: Mapped[str] = mapped_column(String, nullable=False)
    # Printed on every Phase 3 statutory form header -- not PII, plain columns.
    factory_address: Mapped[str | None] = mapped_column(String, nullable=True)
    factory_licence_no: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    mobile: Mapped[str | None] = mapped_column(String, nullable=True)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String, nullable=True)

    # Plain last-4 for display ("•••• •••• 7412"); full number encrypted.
    aadhaar_last4: Mapped[str] = mapped_column(String(4), nullable=False)
    aadhaar_encrypted: Mapped[str] = mapped_column(EncryptedString, nullable=False)

    current_address: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    current_district: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    native_address: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    native_district: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    bank_account_number: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    bank_ifsc: Mapped[str | None] = mapped_column(String, nullable=True)

    # "active" | "deactivated"
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deactivated_reason: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("worker_id", "date", "slot", name="uq_attendance_slot"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    # References the owning owner's ShiftConfig.slot_key -- no longer a
    # fixed AM/PM/Evening literal (Phase 3 Day 1: shifts are configurable
    # per factory).
    slot: Mapped[str] = mapped_column(String, nullable=False)
    # "present" | "absent"
    status: Mapped[str] = mapped_column(String, nullable=False)
    # Owner-entered, optional. Phase 3 Day 1's confirmed v1 approach: real
    # arrival/departure-time capture isn't built this phase -- Form
    # 25/25-B's daily hours are the shift's standard duration whenever
    # marked present, plus this figure if the owner logs any overtime.
    overtime_hours: Mapped[float] = mapped_column(default=0, nullable=False)
    marked_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    marked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SyncStatus(Base):
    """Portal sync state, tracked independently of Worker.status -- the
    app's own state is never blocked on Portal success (see SPEC.md)."""

    __tablename__ = "sync_status"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    # "create" | "deactivate" -- which sync action this row represents
    action: Mapped[str] = mapped_column(String, nullable=False)
    # "pending" | "synced" | "failed"
    state: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String, nullable=True)


class PortalCredential(Base):
    """One row per owner -- confirmed each factory owner has their own
    separate login on the real Portal, not one shared account. Password
    encrypted the same way as Worker PII (EncryptedString); username
    encrypted too for consistency even though it's less sensitive on its
    own, since it's meaningless without the password anyway."""

    __tablename__ = "portal_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False, unique=True)
    portal_username: Mapped[str] = mapped_column(EncryptedString, nullable=False)
    portal_password: Mapped[str] = mapped_column(EncryptedString, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AuditLog(Base):
    """Append-only. Every activate/deactivate action."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    # "activate" | "deactivate"
    action: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ShiftConfig(Base):
    """Phase 3 Day 1 -- replaces the old hardcoded AM/PM/Evening slots
    with owner-configurable shifts (shift scheme varies by factory, per
    PHASE3_STATUTORY_FORMS_PLAN.md). Attendance.slot stores slot_key."""

    __tablename__ = "shift_configs"
    __table_args__ = (
        UniqueConstraint("owner_id", "slot_key", name="uq_shift_owner_slot"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    slot_key: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    start_time: Mapped[str | None] = mapped_column(String, nullable=True)  # "HH:MM"
    end_time: Mapped[str | None] = mapped_column(String, nullable=True)  # "HH:MM"
    # Free text (e.g. "1:00 PM - 1:30 PM") -- Form 25's "Rest Interval"
    # column needs this per shift; no fixed format is enforced statutorily.
    rest_interval: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class WorkerCompliance(Base):
    """Form 12 (Register of Adult Workers & Young Persons) fields --
    Phase 3 Day 1. One row per worker. category/warning are computed
    server-side from Worker.dob, never trusted from client input."""

    __tablename__ = "worker_compliance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False, unique=True)
    worker_code: Mapped[str | None] = mapped_column(String, nullable=True)
    father_or_spouse_name: Mapped[str | None] = mapped_column(String, nullable=True)
    designation_or_nature_of_work: Mapped[str | None] = mapped_column(String, nullable=True)
    epf_uan_no: Mapped[str | None] = mapped_column(String, nullable=True)
    esic_no: Mapped[str | None] = mapped_column(String, nullable=True)
    # "adult" | "young_person" -- computed from Worker.dob at registration
    category: Mapped[str] = mapped_column(String, nullable=False)
    fitness_cert_no: Mapped[str | None] = mapped_column(String, nullable=True)
    fitness_cert_valid_till: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_of_joining: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_made_permanent: Mapped[date | None] = mapped_column(Date, nullable=True)
    suspension_period: Mapped[str | None] = mapped_column(String, nullable=True)
    registered_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class WageProfile(Base):
    """Phase 3 Day 2 -- a worker's pay rate, versioned by effective_from.
    Multiple rows per worker are expected and never overwritten: a wage
    slip generated for a past month must reflect that month's rate, not
    today's. The API layer enforces append-only (no PUT/edit on an
    existing row) -- see PHASE3_STATUTORY_FORMS_PLAN.md's Day 2 section
    for why that's the one thing that makes computing Form 15 live from
    this table (rather than a cached rollup) safe."""

    __tablename__ = "wage_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    # "daily" | "monthly" -- which way `basic` should be read
    rate_type: Mapped[str] = mapped_column(String, default="daily", nullable=False)
    basic: Mapped[float] = mapped_column(nullable=False)
    hra: Mapped[float] = mapped_column(default=0, nullable=False)
    da: Mapped[float] = mapped_column(default=0, nullable=False)
    other_allowances: Mapped[float] = mapped_column(default=0, nullable=False)
    pf_rate: Mapped[float] = mapped_column(default=0, nullable=False)   # percent
    esi_rate: Mapped[float] = mapped_column(default=0, nullable=False)  # percent
    lwf_amount: Mapped[float] = mapped_column(default=0, nullable=False)  # flat, not percent
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class LeaveEntry(Base):
    """Phase 3 Day 2 -- leave_type is aligned to Form 15's actual
    leave-wage columns (Earned Leave / National, Festival & Special
    Holidays / Others), not a generic HR taxonomy -- sick/casual leave
    aren't statutory Form 15 categories."""

    __tablename__ = "leave_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    # "earned" | "national_festival_special" | "other"
    leave_type: Mapped[str] = mapped_column(String, nullable=False)
    date_from: Mapped[date] = mapped_column(Date, nullable=False)
    date_to: Mapped[date] = mapped_column(Date, nullable=False)
    days: Mapped[float] = mapped_column(nullable=False)
    wages_paid: Mapped[float | None] = mapped_column(nullable=True)
    marked_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class WagePayment(Base):
    """Phase 3 Day 2 -- "date of payment" and a bank reference are facts
    that happened, not derivable from WageProfile/Attendance/LeaveEntry.
    One row per worker per month; source data, not a cached rollup (see
    ground rules in PHASE3_STATUTORY_FORMS_PLAN.md)."""

    __tablename__ = "wage_payments"
    __table_args__ = (
        UniqueConstraint("worker_id", "month", "year", name="uq_wage_payment_period"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    date_of_payment: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String, nullable=True)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class FormGenerationLog(Base):
    """Phase 3 Day 3 -- one row per successful form generation/email.
    worker_id is null for the two factory-wide forms (Form 25, Form 15),
    set for the three per-worker ones (Form 25-B, Form 12, Wage Slip)."""

    __tablename__ = "form_generation_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    worker_id: Mapped[int | None] = mapped_column(ForeignKey("workers.id"), nullable=True)
    # "form25" | "form25b" | "form12" | "form15" | "wageslip"
    form_code: Mapped[str] = mapped_column(String, nullable=False)
    period_label: Mapped[str | None] = mapped_column(String, nullable=True)  # e.g. "2026-08"
    # "generated" | "emailed"
    action: Mapped[str] = mapped_column(String, nullable=False)
    generated_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
