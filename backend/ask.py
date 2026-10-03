"""Ask Labour Lens -- one-tap question chips that answer from the
factory's own data. No AI/LLM, no API keys, no DB writes: every
function here is (db, owner_id) -> dict, pure and read-only, so each
can become an AI tool's implementation later without changing its
shape (see CHIPS at the bottom).

Answer shape (returned as-is by main.py's GET /ask/{chip}, no Pydantic
response_model -- kept a plain dict on purpose, see that endpoint):
{chip, title, headline, tone: "good"|"warn"|"info",
 rows: [{worker_id, name, code, status, deactivated_at, value}],
 actions: [{label, screen, params}], based_on}
"""

from datetime import date as date_

from sqlalchemy.orm import Session

import models
from forms import compute_wage

# Mirrors main.py's MINIMUM_WORKING_AGE -- duplicated, not imported,
# to avoid a circular import (main.py imports CHIPS from this module).
MINIMUM_WORKING_AGE = 14

FORM12_FIELDS = ("father_or_spouse_name", "designation_or_nature_of_work", "epf_uan_no", "esic_no", "date_of_joining")


def _age_years(dob: date_, as_of: date_) -> int:
    years = as_of.year - dob.year
    if (as_of.month, as_of.day) < (dob.month, dob.day):
        years -= 1
    return years


def _active_workers(db: Session, owner_id: int) -> list[models.Worker]:
    return (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner_id, models.Worker.status == "active")
        .order_by(models.Worker.name)
        .all()
    )


def _row(w: models.Worker, value: str) -> dict:
    return {
        "worker_id": w.id,
        "name": w.name,
        "code": w.numeric_employee_code,
        "status": w.status,
        "deactivated_at": w.deactivated_at.isoformat() if w.deactivated_at else None,
        "value": value,
    }


def _month_label(month: int, year: int) -> str:
    return f"{date_(year, month, 1).strftime('%B')} {year}"


def _verb(n: int, singular: str, plural: str) -> str:
    return singular if n == 1 else plural


def ask_absent_month(db: Session, owner_id: int) -> dict:
    """Active workers absent more than 3 days this month so far."""
    workers = _active_workers(db, owner_id)
    today = date_.today()
    start = today.replace(day=1)
    rows = (
        db.query(models.Attendance.worker_id, models.Attendance.date, models.Attendance.status)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(models.Worker.owner_id == owner_id, models.Attendance.date >= start, models.Attendance.date <= today)
        .all()
    )
    by_worker_day: dict[tuple[int, date_], set[str]] = {}
    for worker_id, d, status in rows:
        by_worker_day.setdefault((worker_id, d), set()).add(status)

    absent_days_by_worker: dict[int, int] = {}
    for (worker_id, _d), statuses in by_worker_day.items():
        if "absent" in statuses and "present" not in statuses:
            absent_days_by_worker[worker_id] = absent_days_by_worker.get(worker_id, 0) + 1

    flagged = [(w, absent_days_by_worker.get(w.id, 0)) for w in workers if absent_days_by_worker.get(w.id, 0) > 3]
    flagged.sort(key=lambda t: t[1], reverse=True)

    good = len(flagged) == 0
    return {
        "chip": "absent_month",
        "title": "Absent this month",
        "headline": "No one has more than 3 absent days this month." if good else f"{len(flagged)} worker{'s' if len(flagged) != 1 else ''} {_verb(len(flagged), 'has', 'have')} more than 3 absent days this month.",
        "tone": "good" if good else "warn",
        "rows": [_row(w, f"{n} days absent") for w, n in flagged],
        "actions": [] if good else [{"label": "View Attendance", "screen": "AttendanceTab", "params": {}}],
        "based_on": f"Attendance records for {_month_label(today.month, today.year)}",
    }


def ask_not_marked_today(db: Session, owner_id: int) -> dict:
    """Active workers with no attendance record today and not on leave."""
    workers = _active_workers(db, owner_id)
    today = date_.today()
    marked_ids = {
        worker_id
        for (worker_id,) in db.query(models.Attendance.worker_id)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(models.Worker.owner_id == owner_id, models.Attendance.date == today)
        .distinct()
        .all()
    }
    on_leave_ids = {
        worker_id
        for (worker_id,) in db.query(models.LeaveEntry.worker_id)
        .join(models.Worker, models.Worker.id == models.LeaveEntry.worker_id)
        .filter(models.Worker.owner_id == owner_id, models.LeaveEntry.date_from <= today, models.LeaveEntry.date_to >= today)
        .distinct()
        .all()
    }
    unmarked = [w for w in workers if w.id not in marked_ids and w.id not in on_leave_ids]
    good = len(unmarked) == 0
    return {
        "chip": "not_marked_today",
        "title": "Not marked today",
        "headline": "Everyone is marked for today." if good else f"{len(unmarked)} worker{'s' if len(unmarked) != 1 else ''} not marked for today yet.",
        "tone": "good" if good else "warn",
        "rows": [_row(w, "Not marked") for w in unmarked],
        "actions": [] if good else [{"label": "Mark attendance", "screen": "AttendanceTab", "params": {}}],
        "based_on": f"Attendance for {today.isoformat()}",
    }


def ask_wages_month(db: Session, owner_id: int) -> dict:
    """Net wage earned so far this month, per active worker."""
    workers = _active_workers(db, owner_id)
    today = date_.today()
    results = []
    total = 0.0
    for w in workers:
        wage = compute_wage(db, owner_id, w.id, today.month, today.year)
        if wage is None:
            continue
        total += wage["net"]
        results.append((w, wage["net"]))
    results.sort(key=lambda t: t[1], reverse=True)
    return {
        "chip": "wages_month",
        "title": "Wages this month",
        "headline": f"₹{total:,.2f} in net wages so far this month, across {len(results)} worker{'s' if len(results) != 1 else ''}.",
        "tone": "info",
        "rows": [_row(w, f"₹{net:,.2f}") for w, net in results],
        "actions": [{"label": "View Wages", "screen": "WagesTab", "params": {}}],
        "based_on": f"Wage calculation for {_month_label(today.month, today.year)}",
    }


def ask_unpaid_wages(db: Session, owner_id: int) -> dict:
    """Active workers whose last month's net wage (> 0) has no recorded payment."""
    workers = _active_workers(db, owner_id)
    today = date_.today()
    last_month = today.month - 1 or 12
    last_year = today.year - 1 if today.month == 1 else today.year
    unpaid = []
    for w in workers:
        wage = compute_wage(db, owner_id, w.id, last_month, last_year)
        if wage and wage["net"] > 0 and wage["payment"] is None:
            unpaid.append((w, wage["net"]))
    unpaid.sort(key=lambda t: t[1], reverse=True)
    good = len(unpaid) == 0
    return {
        "chip": "unpaid_wages",
        "title": "Unpaid wages",
        "headline": "Last month's wages are recorded as paid for everyone." if good else f"{len(unpaid)} worker{'s' if len(unpaid) != 1 else ''} {_verb(len(unpaid), 'has', 'have')} unpaid wages for {_month_label(last_month, last_year)}.",
        "tone": "good" if good else "warn",
        "rows": [_row(w, f"₹{net:,.2f}") for w, net in unpaid],
        "actions": [] if good else [{"label": "Record payment", "screen": "WagesTab", "params": {}}],
        "based_on": f"Wage payments for {_month_label(last_month, last_year)}",
    }


def ask_missing_form12(db: Session, owner_id: int) -> dict:
    """Active workers with an incomplete Form 12 (any of 5 key fields blank)."""
    workers = _active_workers(db, owner_id)
    compliance_by_worker = {
        c.worker_id: c
        for c in db.query(models.WorkerCompliance)
        .join(models.Worker, models.Worker.id == models.WorkerCompliance.worker_id)
        .filter(models.Worker.owner_id == owner_id)
        .all()
    }
    flagged = []
    for w in workers:
        c = compliance_by_worker.get(w.id)
        filled = sum(1 for f in FORM12_FIELDS if c and getattr(c, f)) if c else 0
        if filled < len(FORM12_FIELDS):
            flagged.append((w, filled))
    flagged.sort(key=lambda t: t[1])
    good = len(flagged) == 0
    return {
        "chip": "missing_form12",
        "title": "Missing Form 12",
        "headline": "Form 12 is complete for every active worker." if good else f"{len(flagged)} worker{'s' if len(flagged) != 1 else ''} {_verb(len(flagged), 'has', 'have')} incomplete Form 12 details.",
        "tone": "good" if good else "warn",
        "rows": [_row(w, f"{filled} of {len(FORM12_FIELDS)} fields") for w, filled in flagged],
        "actions": [] if good else [{"label": "View Workers", "screen": "WorkersTab", "params": {}}],
        "based_on": "Form 12 (Register of Adult Workers & Young Persons)",
    }


def ask_no_wage_rate(db: Session, owner_id: int) -> dict:
    """Active workers with no wage rate ever set."""
    workers = _active_workers(db, owner_id)
    today = date_.today()
    flagged = [w for w in workers if compute_wage(db, owner_id, w.id, today.month, today.year) is None]
    good = len(flagged) == 0
    return {
        "chip": "no_wage_rate",
        "title": "No wage rate",
        "headline": "Every active worker has a wage rate set." if good else f"{len(flagged)} worker{'s' if len(flagged) != 1 else ''} {_verb(len(flagged), 'has', 'have')} no wage rate set.",
        "tone": "good" if good else "warn",
        "rows": [_row(w, "No rate set") for w in flagged],
        "actions": [] if good else [{"label": "Set wage rates", "screen": "WagesTab", "params": {"segment": "rates"}}],
        "based_on": "Wage rate records",
    }


def ask_under_age(db: Session, owner_id: int) -> dict:
    """Active workers under the legal minimum working age."""
    workers = _active_workers(db, owner_id)
    today = date_.today()
    flagged = [(w, _age_years(w.dob, today)) for w in workers if w.dob and _age_years(w.dob, today) < MINIMUM_WORKING_AGE]
    flagged.sort(key=lambda t: t[1])
    good = len(flagged) == 0
    return {
        "chip": "under_age",
        "title": "Under minimum age",
        "headline": "No active worker is under the legal minimum working age." if good else f"{len(flagged)} worker{'s' if len(flagged) != 1 else ''} {_verb(len(flagged), 'appears', 'appear')} to be under the legal minimum working age ({MINIMUM_WORKING_AGE}).",
        "tone": "good" if good else "warn",
        "rows": [_row(w, f"Age {age}") for w, age in flagged],
        "actions": [] if good else [{"label": "View Workers", "screen": "WorkersTab", "params": {}}],
        "based_on": "Worker date of birth",
    }


def ask_not_on_device(db: Session, owner_id: int) -> dict:
    """Active workers not mapped to a biometric device (if any device exists)."""
    device_count = db.query(models.BiometricDevice).filter(models.BiometricDevice.owner_id == owner_id).count()
    if device_count == 0:
        return {
            "chip": "not_on_device",
            "title": "Not on device",
            "headline": "No biometric device added yet.",
            "tone": "info",
            "rows": [],
            "actions": [{"label": "Add a device", "screen": "BiometricDevices", "params": {}}],
            "based_on": "Biometric devices",
        }

    workers = _active_workers(db, owner_id)
    mapped_ids = {
        worker_id
        for (worker_id,) in db.query(models.DeviceUserMapping.worker_id)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
        .filter(models.BiometricDevice.owner_id == owner_id)
        .all()
    }
    flagged = [w for w in workers if w.id not in mapped_ids]
    good = len(flagged) == 0
    return {
        "chip": "not_on_device",
        "title": "Not on device",
        "headline": "Every active worker is mapped to a biometric device." if good else f"{len(flagged)} worker{'s' if len(flagged) != 1 else ''} {_verb(len(flagged), 'is', 'are')} not mapped to a biometric device.",
        "tone": "good" if good else "warn",
        "rows": [_row(w, "Not mapped") for w in flagged],
        "actions": [] if good else [{"label": "Map devices", "screen": "BiometricDevices", "params": {}}],
        "based_on": "Device user mapping",
    }


# Chip key -> answer function. Adding a chip later (or wiring these up
# as AI tool implementations) means adding one entry here -- nothing
# else in this file changes shape.
CHIPS = {
    "absent_month": ask_absent_month,
    "not_marked_today": ask_not_marked_today,
    "wages_month": ask_wages_month,
    "unpaid_wages": ask_unpaid_wages,
    "missing_form12": ask_missing_form12,
    "no_wage_rate": ask_no_wage_rate,
    "under_age": ask_under_age,
    "not_on_device": ask_not_on_device,
}
