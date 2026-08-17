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
    # "AM" | "PM" | "Evening"
    slot: Mapped[str] = mapped_column(String, nullable=False)
    # "present" | "absent"
    status: Mapped[str] = mapped_column(String, nullable=False)
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
