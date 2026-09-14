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
    # Which state's statutory forms apply to this factory -- e.g. "Tamil
    # Nadu", "Karnataka" -- drives the Forms & Reports state selector and
    # which form_templates rows show up there. Free text today (not an
    # enum/FK) since the set of supported states is small and changes
    # rarely; the mobile app hardcodes the option list for now.
    state: Mapped[str | None] = mapped_column(String, nullable=True)
    # Drives the Home screen's background pattern on the mobile app
    # (item 19) -- free text like state, same reasoning: a small,
    # rarely-changing option list the mobile app hardcodes rather than
    # a DB-enforced enum/FK. Not set defaults to a generic pattern on
    # the client rather than left blank.
    industry: Mapped[str | None] = mapped_column(String, nullable=True)
    # DPDP consent -- signup is blocked server-side (not just a UI
    # checkbox) unless this was explicitly given; the timestamp is the
    # actual evidence of consent, not just a boolean flag, in case it's
    # ever needed to demonstrate compliance.
    consent_given_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class WorkerType(Base):
    """Wage Rate feature -- a factory-defined category (Skilled/Unskilled/
    Helper, etc.) with a default rate. Assigning a type to a worker who has
    no WageProfile yet auto-creates one from these defaults (see
    _create_wage_profile_from_type in main.py); a worker who already has a
    rate keeps it when assigned a type, since that rate IS their override.
    Deliberately does NOT introduce a second wage-storage mechanism --
    WageProfile stays the one source of truth compute_wage() reads."""

    __tablename__ = "worker_types"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_worker_type_owner_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # "daily" | "monthly" -- same convention as WageProfile.rate_type
    default_rate_type: Mapped[str] = mapped_column(String, default="daily", nullable=False)
    default_rate: Mapped[float] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Worker(Base):
    __tablename__ = "workers"
    __table_args__ = (UniqueConstraint("owner_id", "numeric_employee_code", name="uq_worker_employee_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    mobile: Mapped[str | None] = mapped_column(String, nullable=True)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String, nullable=True)
    worker_type_id: Mapped[int | None] = mapped_column(ForeignKey("worker_types.id"), nullable=True)
    # A stable numeric badge/token number -- generated once, on demand,
    # never reused even after deactivation. Exists specifically so a
    # biometric device that only accepts numeric enrollment IDs can use
    # this as its device_user_id, making the id itself the shared key
    # (no separate DeviceUserMapping lookup needed for that common
    # case) -- see biometric.py.
    numeric_employee_code: Mapped[str | None] = mapped_column(String, nullable=True)

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
    # "manual" | "biometric" -- nullable so existing rows (all manual,
    # from before this column existed) aren't forced to backfill a
    # value; the API treats a missing value as "manual" for display.
    # source_detail is a short human-readable origin note -- device name
    # + punch time for biometric, the marking owner's name for manual --
    # never shown as a bare Present/Absent tick with no origin.
    source: Mapped[str | None] = mapped_column(String, nullable=True)
    source_detail: Mapped[str | None] = mapped_column(String, nullable=True)


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


class Factory(Base):
    """Admin-portal-only business/billing overlay on top of Owner --
    every Owner in this app already IS one factory, so rather than a
    second, independently-maintained factory directory, one Factory row
    is auto-created per Owner at signup (see signup() in main.py),
    holding the admin-only fields the mobile app has no use for
    (subscription status, plan tier, internal notes). owner_name/
    owner_contact are captured at creation time, not joined live, so
    the admin portal's record of who ran the account doesn't silently
    change if the owner edits their own profile later."""

    __tablename__ = "factories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    owner_name: Mapped[str] = mapped_column(String, nullable=False)
    owner_contact: Mapped[str] = mapped_column(String, nullable=False)
    # "trial" | "active" | "payment_overdue" | "suspended" | "churned"
    status: Mapped[str] = mapped_column(String, default="trial", nullable=False)
    plan_tier: Mapped[str | None] = mapped_column(String, nullable=True)
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    notes: Mapped[str | None] = mapped_column(String, nullable=True)


class FactoryPayment(Base):
    """Manually recorded by the admin for now -- there's no billing
    integration yet (Razorpay is separate, later work), so this is the
    source of truth for what's been invoiced/paid until that lands."""

    __tablename__ = "factory_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    factory_id: Mapped[int] = mapped_column(ForeignKey("factories.id"), nullable=False)
    amount: Mapped[float] = mapped_column(nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    paid_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # "paid" | "pending" | "overdue" -- the admin can set this directly,
    # but the API also computes "is this actually overdue" from
    # due_date at read time so a forgotten status field doesn't hide a
    # real overdue payment (see admin.py's _payment_out).
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FactoryEmployeeSnapshot(Base):
    """Populated by a monthly scheduled job (monthly_employee_snapshot.py),
    deliberately not a live join over Worker -- so a historical month's
    count stays exactly what it was that month even after workers are
    later deactivated, which is the whole point of a trend view."""

    __tablename__ = "factory_employee_snapshots"
    __table_args__ = (UniqueConstraint("factory_id", "month", name="uq_snapshot_factory_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    factory_id: Mapped[int] = mapped_column(ForeignKey("factories.id"), nullable=False)
    month: Mapped[str] = mapped_column(String, nullable=False)  # "2026-09"
    active_employee_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AdminUser(Base):
    """Single row, by design -- no roles/permissions table, no public
    signup route. Created only via seed_admin.py."""

    __tablename__ = "admin_user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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


class BiometricDevice(Base):
    """One row per fingerprint terminal (e.g. "Main Gate"). Real device
    mechanics live in biometric.py, kept behind a single connector
    interface so this table and everything downstream of it (mapping,
    punches, sync) never needs to know whether it's talking to a mock
    or a real ZKTeco unit over the network."""

    __tablename__ = "biometric_devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    ip_address: Mapped[str] = mapped_column(String, nullable=False)
    port: Mapped[int] = mapped_column(Integer, default=4370, nullable=False)
    # Some devices/configs need UDP instead of TCP -- pyzk's own
    # connect() takes this as a flag, not something to auto-detect.
    force_udp: Mapped[bool] = mapped_column(default=False, nullable=False)
    # Device "comm key" / comm password, if one is set on the unit --
    # recommended over leaving the device default. Not treated as
    # sensitive as Aadhaar/bank details (it protects a LAN-local
    # attendance terminal, not personal data), so plain text like every
    # other device-config field here.
    comm_password: Mapped[str | None] = mapped_column(String, nullable=True)
    # "active" | "inactive" -- owner-controlled (e.g. a device taken out
    # of service), distinct from last_sync_status below (which reflects
    # whether syncing is actually succeeding).
    status: Mapped[str] = mapped_column(String, default="active", nullable=False)
    # "ok" | "unreachable" | "error" | None (never synced yet) -- set by
    # the sync job after each attempt, win or lose, so a device page can
    # show real health instead of just "last synced 3 days ago" with no
    # indication of why.
    last_sync_status: Mapped[str | None] = mapped_column(String, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DeviceUserMapping(Base):
    """Fallback/safety-net mapping for when a worker's numeric_employee_code
    wasn't used as the device's own enrollment ID (device only accepts
    auto-increment IDs, or the direct-ID step was skipped/misconfigured).
    device_user_id is only unique WITHIN one device -- the same raw ID
    can and will recur across different gates/terminals enrolled
    independently, hence the composite unique constraint rather than a
    unique constraint on device_user_id alone."""

    __tablename__ = "device_user_mapping"
    __table_args__ = (UniqueConstraint("device_id", "device_user_id", name="uq_device_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("biometric_devices.id"), nullable=False)
    device_user_id: Mapped[str] = mapped_column(String, nullable=False)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BiometricPunch(Base):
    """One row per raw punch pulled from a device (or the mock source).
    worker_id is nullable -- a punch from a device_user_id with no
    resolvable mapping is still stored (never silently dropped), just
    with worker_id left null and raw_device_user_id kept so it surfaces
    as an "unmapped punch needing attention" rather than vanishing.
    The uniqueness constraint is what makes re-pulling the same device
    batch on a later sync a safe no-op instead of a duplicate insert."""

    __tablename__ = "biometric_punches"
    __table_args__ = (
        UniqueConstraint("device_id", "raw_device_user_id", "timestamp", name="uq_punch_dedup"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("biometric_devices.id"), nullable=False)
    worker_id: Mapped[int | None] = mapped_column(ForeignKey("workers.id"), nullable=True)
    raw_device_user_id: Mapped[str] = mapped_column(String, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # "in" | "out"
    punch_type: Mapped[str] = mapped_column(String, nullable=False)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # "device" | "mock" -- which connector produced this row; lets a
    # health/debug view tell real data apart from test data at a glance
    # even after a real device is in production alongside earlier mock
    # runs from development.
    source: Mapped[str] = mapped_column(String, nullable=False)


class BiometricConsent(Base):
    """DPDP Act requires this to exist as a real record (who consented,
    when, what they were told), not just a boolean flag on Worker --
    captured once during Worker Details onboarding, before any
    enrollment happens for that worker."""

    __tablename__ = "biometric_consents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False, unique=True)
    consented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    consented_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    # A snapshot of what the worker was actually told at consent time --
    # kept as a real record rather than assuming today's notice text
    # always matches whatever was shown when this row was created.
    notice_text: Mapped[str] = mapped_column(String, nullable=False)


class FormTemplate(Base):
    """Reference data, not owner-scoped -- one row per (state, form_code)
    pair, static and seeded via migration, not something an owner
    creates. Tamil Nadu's rows point at forms.py's existing build_*
    functions (already fully implemented); a state with is_available=False
    is a stub -- listed so the owner knows it's coming, but generation
    for it returns 501 (see main.py's _generate_form_content) until the
    real field mapping is built. Adding a new state later is a data
    change here, not a UI change -- the Forms & Reports screen already
    just renders whatever this table returns for the selected state."""

    __tablename__ = "form_templates"
    __table_args__ = (UniqueConstraint("state", "form_code", name="uq_form_template_state_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    state: Mapped[str] = mapped_column(String, nullable=False)
    form_code: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    is_available: Mapped[bool] = mapped_column(default=True, nullable=False)
