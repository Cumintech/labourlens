"""Turns raw connector punches into stored, deduplicated
BiometricPunch rows, resolved worker attendance, and device health
state. Never talks to pyzk or mock data directly -- only ever calls
connector.fetch_punches(device) through biometric.BaseConnector, so
swapping mock for real hardware (biometric.get_connector) never
requires a change here.
"""

import time
from datetime import date as date_type, datetime, time as time_type, timezone

from sqlalchemy.orm import Session

import models
from attendance_service import upsert_attendance
from biometric import (
    BaseConnector,
    ConnectorError,
    DeviceBusyError,
    DeviceUnreachableError,
    PartialReadError,
    PunchRecord,
)

MAX_BUSY_RETRIES = 1
BUSY_RETRY_DELAY_SECONDS = 2


def _naive_utc(dt: datetime) -> datetime:
    """Normalizes a datetime for comparison across the SQLite/Postgres
    timezone-round-trip difference (see the comment in sync_device) --
    converts an aware value to naive UTC, leaves an already-naive value
    (assumed UTC, the only timezone anything here is written in) as-is."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def resolve_worker_for_punch(db: Session, device: models.BiometricDevice, raw_device_user_id: str) -> models.Worker | None:
    """Preferred path (Section 4): device_user_id IS the worker's own
    numeric_employee_code, entered directly at enrollment time -- no
    mapping row needed at all. Falls back to an explicit
    DeviceUserMapping row for whenever the direct-ID approach wasn't
    used, or needs correcting."""
    mapping = (
        db.query(models.DeviceUserMapping)
        .filter(
            models.DeviceUserMapping.device_id == device.id,
            models.DeviceUserMapping.device_user_id == raw_device_user_id,
        )
        .first()
    )
    if mapping:
        return db.get(models.Worker, mapping.worker_id)

    return (
        db.query(models.Worker)
        .filter(
            models.Worker.owner_id == device.owner_id,
            models.Worker.numeric_employee_code == raw_device_user_id,
        )
        .first()
    )


def _fetch_with_retry(connector: BaseConnector, device: models.BiometricDevice) -> list[PunchRecord]:
    attempts = 0
    while True:
        try:
            return connector.fetch_punches(device)
        except DeviceBusyError:
            attempts += 1
            if attempts > MAX_BUSY_RETRIES:
                raise
            time.sleep(BUSY_RETRY_DELAY_SECONDS)


def _slot_for_time(shifts: list[models.ShiftConfig], t: time_type) -> str | None:
    """Which configured shift's window a punch's time-of-day falls
    into -- same overnight-wrap handling forms.py's shift-hours logic
    already uses, not reinvented differently here. None if the punch
    doesn't fall inside any configured shift (skipped rather than
    guessed -- see sync_device)."""
    t_minutes = t.hour * 60 + t.minute
    for shift in shifts:
        if not shift.start_time or not shift.end_time:
            continue
        try:
            sh, sm = (int(p) for p in shift.start_time.split(":"))
            eh, em = (int(p) for p in shift.end_time.split(":"))
        except (ValueError, TypeError):
            continue
        start_minutes = sh * 60 + sm
        end_minutes = eh * 60 + em
        if end_minutes <= start_minutes:  # overnight shift
            if t_minutes >= start_minutes or t_minutes <= end_minutes:
                return shift.slot_key
        elif start_minutes <= t_minutes <= end_minutes:
            return shift.slot_key
    return None


def derive_attendance_for_punches(db: Session, punches: list[models.BiometricPunch], device: models.BiometricDevice) -> None:
    """Derives and writes attendance for each already-mapped punch,
    through the same shared attendance-writing service manual marking
    uses. Called both from a live sync's newly-inserted punches AND from
    the mapping endpoints -- mapping a device_user_id after punches for
    it already exist (the common case: the mock/device generates
    punches for a raw ID before anyone's mapped it) must derive
    attendance for those already-stored punches too, not just future
    ones, or "map this worker" silently does nothing visible."""
    shifts_by_owner: dict[int, list[models.ShiftConfig]] = {}
    for row in punches:
        if row.worker_id is None:
            continue
        worker = db.get(models.Worker, row.worker_id)
        if worker is None:
            continue
        if worker.owner_id not in shifts_by_owner:
            shifts_by_owner[worker.owner_id] = (
                db.query(models.ShiftConfig).filter(models.ShiftConfig.owner_id == worker.owner_id).all()
            )
        shifts = shifts_by_owner[worker.owner_id]
        slot = _slot_for_time(shifts, row.timestamp.time())
        if not slot:
            continue  # punch time doesn't fall inside any configured shift window -- can't attribute it, skip rather than guess

        punch_date: date_type = row.timestamp.date()
        existing_attendance = (
            db.query(models.Attendance)
            .filter(
                models.Attendance.worker_id == row.worker_id,
                models.Attendance.date == punch_date,
                models.Attendance.slot == slot,
            )
            .first()
        )
        if existing_attendance and existing_attendance.source == "manual":
            # Never let an automated sync silently overwrite a human's
            # explicit correction for that worker/day/slot.
            continue

        upsert_attendance(
            db,
            worker_id=row.worker_id,
            date=punch_date,
            slot=slot,
            status="present",
            overtime_hours=existing_attendance.overtime_hours if existing_attendance else 0,
            marked_by=worker.owner_id,
            source="biometric",
            source_detail=f"{device.name} -- {row.timestamp.isoformat()}",
        )


def sync_device(db: Session, device: models.BiometricDevice, connector: BaseConnector) -> dict:
    """Runs one full sync cycle for a single device. Returns a summary
    dict rather than raising on an expected failure mode -- one
    device's trouble must never block another device's sync (the
    caller, biometric_api.py, loops over devices and calls this once
    per device, each in its own try/except as a second line of
    defense)."""
    summary: dict = {
        "device_id": device.id,
        "status": "ok",
        "new_punches": 0,
        "duplicate_punches": 0,
        "unmapped_punches": 0,
    }

    try:
        punches = _fetch_with_retry(connector, device)
    except DeviceUnreachableError as e:
        device.last_sync_status = "unreachable"
        db.commit()
        summary["status"] = "unreachable"
        summary["error"] = str(e)
        return summary
    except PartialReadError as e:
        # Never write an incomplete batch -- discard everything from
        # this cycle and retry the full read next interval.
        device.last_sync_status = "error"
        db.commit()
        summary["status"] = "error"
        summary["error"] = f"partial read, discarded: {e}"
        return summary
    except ConnectorError as e:
        device.last_sync_status = "error"
        db.commit()
        summary["status"] = "error"
        summary["error"] = str(e)
        return summary

    # Dedup against what's already stored for this device -- the DB's
    # own unique constraint is the real backstop; this in-memory check
    # just avoids a noisy constraint-violation exception on the common
    # case of re-pulling the same batch. Timestamps are normalized to
    # naive UTC before comparing: SQLite doesn't actually preserve
    # timezone-awareness on round-trip even for a DateTime(timezone=True)
    # column (unlike Postgres), so comparing an aware PunchRecord
    # timestamp against a naive one read back from the DB would never
    # match on SQLite even for the exact same instant.
    existing_keys = {(p.raw_device_user_id, _naive_utc(p.timestamp)) for p in db.query(models.BiometricPunch).filter(models.BiometricPunch.device_id == device.id).all()}

    newly_inserted: list[models.BiometricPunch] = []
    for punch in punches:
        key = (punch.device_user_id, _naive_utc(punch.timestamp))
        if key in existing_keys:
            summary["duplicate_punches"] += 1
            continue

        worker = resolve_worker_for_punch(db, device, punch.device_user_id)
        row = models.BiometricPunch(
            device_id=device.id,
            worker_id=worker.id if worker else None,
            raw_device_user_id=punch.device_user_id,
            timestamp=punch.timestamp,
            punch_type=punch.punch_type,
            source=connector.SOURCE_LABEL,
        )
        db.add(row)
        newly_inserted.append(row)
        existing_keys.add(key)
        summary["new_punches"] += 1
        if worker is None:
            summary["unmapped_punches"] += 1
    db.commit()

    # Derive attendance per worker/day from mapped punches only --
    # unmapped ones stay visible in biometric_punches (worker_id NULL)
    # for the "unmapped punches need attention" surface, never silently
    # dropped, but there's nothing to attribute attendance to yet.
    derive_attendance_for_punches(db, newly_inserted, device)

    device.last_synced_at = datetime.now(timezone.utc)
    device.last_sync_status = "ok"
    db.commit()

    if newly_inserted:
        try:
            connector.confirm_and_clear(device)
        except ConnectorError:
            pass  # non-fatal -- the data's already safely stored; dedup handles these records carrying over into the next cycle too

    return summary
