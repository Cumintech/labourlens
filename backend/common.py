"""Shared imports, constants and helpers for main.py and routers/*.

Moved verbatim from main.py; routers do `from common import *`.
"""
import io

import os

import secrets

from contextlib import asynccontextmanager

from datetime import date as date_, datetime, timedelta, timezone

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile

from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import HTMLResponse, JSONResponse

from fastapi.concurrency import run_in_threadpool

from PIL import Image as PILImage

from PIL import UnidentifiedImageError

from slowapi import _rate_limit_exceeded_handler

from slowapi.errors import RateLimitExceeded

from sqlalchemy import func, text

from sqlalchemy.orm import Session

import admin

from ask import CHIPS

import biometric_api

import forms

import models

import ocr

from dates import age_years as _age_years

import photo_storage

import privacy_policy

import reports

from rate_limit import limiter

from attendance_service import upsert_attendance

from auth import create_token, get_current_owner, hash_password, verify_password

from crypto import mask_aadhaar

from database import Base, SessionLocal, engine, get_db

from email_service import send_plain_email, send_report_email

from schemas import (
    AccountUpdateIn,
    AttendanceMarkIn,
    AttendanceOut,
    ComplianceActionOut,
    ComplianceCategoryOut,
    ComplianceCheckOut,
    ComplianceItemOut,
    DailyWageSummaryOut,
    DailyWorkerWageOut,
    DashboardOut,
    FactoryProfileIn,
    ForgotPasswordIn,
    FormTemplateOut,
    FormEmailIn,
    HealthOut,
    HomeAlertOut,
    HomeAlertsOut,
    LeaveEntryIn,
    LeaveEntryOut,
    MonthEndOut,
    MonthEndStepOut,
    OcrFieldsOut,
    OwnerLoginIn,
    OwnerOut,
    OwnerSignupIn,
    ReportEmailIn,
    ResetPasswordIn,
    ShiftConfigIn,
    ShiftConfigOut,
    SlotSummary,
    TokenOut,
    UpgradeRequestIn,
    UpgradeRequestOut,
    WageProfileIn,
    WageProfileOut,
    WagePaymentIn,
    WagePaymentOut,
    WageSummaryOut,
    WorkerComplianceIn,
    WorkerComplianceOut,
    WorkerCreateIn,
    WorkerOut,
    WorkerEmploymentIn,
    WorkerTypeAssignIn,
    WorkerTypeIn,
    WorkerTypeOut,
    WorkerWageOut,
)

ATTENDANCE_STATUSES = ("present", "absent", "leave")

MAX_WORKERS_PER_OWNER = 200

# EPF's statutory employee contribution rate under Indian law -- the
# sensible default for a wage profile auto-created from a worker type
# assignment (which otherwise leaves pf_rate at WageProfile's own
# column default of 0). A convenience default only: still an ordinary
# editable/overridable field on WageProfile once set, same as basic or
# rate_type. The mobile app's WageProfileScreen mirrors this exact
# value for its own auto-fill UI -- keep both in sync if this changes.
DEFAULT_PF_RATE_PERCENT = 12.0

# Factories Act minimum working age -- stricter than the 18-year
# adult/young_person split below. Warn-only per PHASE3_STATUTORY_FORMS_PLAN.md:
# this app never blocks registration on it, just surfaces a banner.
MINIMUM_WORKING_AGE = 14

YOUNG_PERSON_AGE_CEILING = 18

def _add_years(d: date_, years: int) -> date_:
    """Leap-day safe: a Feb 29 DOB landing on a non-leap target year
    falls back to Feb 28 rather than raising (date.replace would)."""
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, day=28)

def _get_joining_date(db: Session, worker_id: int) -> date_ | None:
    row = (
        db.query(models.WorkerCompliance.date_of_joining)
        .filter(models.WorkerCompliance.worker_id == worker_id)
        .first()
    )
    return row[0] if row else None

def _validate_date_of_joining(date_of_joining: date_ | None, worker_dob: date_ | None) -> None:
    if date_of_joining is None:
        return
    if date_of_joining > date_.today():
        raise HTTPException(status_code=422, detail="Date of entry into service can't be in the future")
    if worker_dob is not None:
        earliest = _add_years(worker_dob, MINIMUM_WORKING_AGE)
        if date_of_joining < earliest:
            raise HTTPException(
                status_code=422,
                detail=f"Date of entry into service can't be before the worker turned {MINIMUM_WORKING_AGE} ({earliest.isoformat()})",
            )

def _shift_configs_for_owner(db: Session, owner_id: int) -> list[models.ShiftConfig]:
    return (
        db.query(models.ShiftConfig)
        .filter(models.ShiftConfig.owner_id == owner_id)
        .order_by(models.ShiftConfig.sort_order)
        .all()
    )

# No existing ENV/settings variable in this repo (checked) -- introduced
# here, defaulting to "production" (docs closed) so Render needs no new
# config to get this fix; local dev sets ENVIRONMENT=development in .env.
ENVIRONMENT = os.environ.get("ENVIRONMENT", "production")

# Informational only -- deliberately no gate anywhere in this app that
# blocks a factory owner from using it once this hits zero. Days are
# counted from the matching Factory row's enrolled_at (== signup time),
# so no separate "trial start" field is needed.
TRIAL_DAYS = 3

def _owner_out(db: Session, owner: models.Owner) -> OwnerOut:
    factory = db.query(models.Factory).filter(models.Factory.owner_id == owner.id).first()
    plan_status = factory.status if factory else "trial"
    trial_days_remaining = None
    trial_ends_at = None
    if plan_status == "trial" and factory:
        # SQLite doesn't actually preserve timezone-awareness even for a
        # DateTime(timezone=True) column (unlike Postgres) -- it hands
        # back a naive datetime, which can't be subtracted from an
        # aware one. Treat a naive value as UTC (the only timezone
        # anything here is ever written in) rather than assuming the
        # database always round-trips it aware.
        enrolled_at = factory.enrolled_at
        if enrolled_at.tzinfo is None:
            enrolled_at = enrolled_at.replace(tzinfo=timezone.utc)
        elapsed_days = (datetime.now(timezone.utc) - enrolled_at).days
        trial_days_remaining = max(TRIAL_DAYS - elapsed_days, 0)
        trial_ends_at = (enrolled_at + timedelta(days=TRIAL_DAYS)).date()
    return OwnerOut(
        **owner.__dict__,
        plan_status=plan_status,
        trial_days_remaining=trial_days_remaining,
        trial_ends_at=trial_ends_at,
    )

def _find_owner_by_identifier(db: Session, identifier: str) -> models.Owner | None:
    ident = identifier.strip().lower()
    return (
        db.query(models.Owner)
        .filter((models.Owner.username == ident) | (models.Owner.email == ident))
        .first()
    )

RESET_CODE_TTL_MINUTES = 15

MAX_OCR_UPLOAD_BYTES = 8 * 1024 * 1024

# The mobile app compresses to ~400x500px JPEG at ~60-70% quality before
# ever sending this (see AddWorkerScreen/expo-image-manipulator) -- this
# is a server-side safety net, not the primary size control, since a
# client is never fully trustworthy about following its own rules.
MAX_PHOTO_UPLOAD_BYTES = 100 * 1024

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

def _get_owned_worker(worker_id: int, owner: models.Owner, db: Session) -> models.Worker:
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return worker

# Placeholder until per-state/industry minimum wages are supplied.
MINIMUM_DAILY_WAGE = 500.0

def _daily_equivalent(rate_type: str, basic: float) -> float:
    return forms.daily_rate_equivalent(rate_type, basic)

def _worker_wage_out(worker: models.Worker, wage: dict | None) -> WorkerWageOut:
    """The same figures Form 15/Wage Slip print, as JSON -- shared by the
    per-worker wage-computation endpoint and the factory-wide summary so
    both always agree on the same breakdown."""
    if wage is None:
        return WorkerWageOut(
            worker_id=worker.id,
            worker_name=worker.name,
            numeric_employee_code=worker.numeric_employee_code,
            has_rate=False,
            days_worked=0,
            gross_wage=0,
            net_wage=0,
            paid=False,
        )
    return WorkerWageOut(
        worker_id=worker.id,
        worker_name=worker.name,
        numeric_employee_code=worker.numeric_employee_code,
        has_rate=True,
        days_worked=wage["summary"]["days_worked"],
        days_absent=wage["summary"]["days_absent"],
        gross_wage=wage["gross"],
        net_wage=wage["net"],
        paid=wage["payment"] is not None and wage["payment"].date_of_payment is not None,
        rate_amount=wage["rate"].basic,
        rate_type=wage["rate"].rate_type,
        min_daily_wage=MINIMUM_DAILY_WAGE,
        daily_equivalent_rate=round(_daily_equivalent(wage["rate"].rate_type, wage["rate"].basic), 2),
        meets_min_wage=_daily_equivalent(wage["rate"].rate_type, wage["rate"].basic) >= MINIMUM_DAILY_WAGE,
        basic_wage=wage["basic_wage"],
        da=wage["rate"].da,
        hra=wage["rate"].hra,
        other_allowances=wage["rate"].other_allowances,
        ot_wages=wage["ot_wages"],
        leave_wages=wage["leave_wages"],
        pf=wage["pf"],
        pf_rate=wage["rate"].pf_rate,
        pf_base=wage["basic_wage"] + wage["rate"].da,
        esi=wage["esi"],
        esi_rate=wage["rate"].esi_rate,
        esi_base=wage["gross"],
        lwf=wage["lwf"],
        total_deductions=wage["total_deductions"],
    )

COMPLIANCE_CATEGORY_LABELS = {
    "workers": "Worker records",
    "age_hours": "Age & hours",
    "wages": "Wages & pay",
    "attendance": "Attendance",
    "registers": "Registers",
}

COMPLIANCE_SEVERITY_WEIGHT = {"critical": 3, "important": 2, "minor": 1}

def _compliance_plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"

def _compliance_names_preview(workers: list["models.Worker"], max_names: int = 2) -> str:
    names = [w.name for w in workers[:max_names]]
    if len(workers) > max_names:
        names.append(f"+{len(workers) - max_names} more")
    return ", ".join(names)

def _compliance_worker_action(workers: list["models.Worker"], filter_label: str):
    if not workers:
        return None
    if len(workers) == 1:
        w = workers[0]
        return ComplianceActionOut(
            screen="WorkerEdit",
            params={
                "workerId": w.id,
                "workerName": w.name,
                "workerStatus": w.status,
                "deactivatedAt": w.deactivated_at.isoformat() if w.deactivated_at else None,
            },
        )
    return ComplianceActionOut(
        screen="Workers",
        params={"filterIds": [w.id for w in workers], "filterLabel": filter_label},
    )

def _compliance_item(
    key: str,
    noun: str,
    detail_suffix: str,
    pass_detail: str,
    category: str,
    severity: str,
    affected_workers: list["models.Worker"],
    total: int,
    filter_label: str,
) -> ComplianceItemOut:
    affected = len(affected_workers)
    passed = affected == 0
    label = "All clear" if passed else f"{_compliance_plural(affected, 'worker')} {noun}"
    detail = pass_detail if passed else f"{_compliance_names_preview(affected_workers)} · {detail_suffix}"
    return ComplianceItemOut(
        key=key,
        label=label,
        detail=detail,
        category=category,
        severity=severity,
        weight=COMPLIANCE_SEVERITY_WEIGHT[severity],
        passed=passed,
        affected=affected,
        total=total,
        worker_ids=[w.id for w in affected_workers],
        action=_compliance_worker_action(affected_workers, filter_label),
    )

def _compliance_credit(item: ComplianceItemOut) -> float:
    if item.total <= 0:
        return item.weight
    return item.weight * (1 - item.affected / item.total)

def _log_form_generation(
    db: Session, owner: models.Owner, form_code: str, worker_id: int | None, start_date: date_ | None, end_date: date_ | None, action: str
) -> None:
    period_label = f"{start_date.isoformat()} to {end_date.isoformat()}" if start_date and end_date else None
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
    start_date: date_ | None,
    end_date: date_ | None,
) -> tuple[bytes, str, str]:
    """Every form is PDF only -- Excel export was removed entirely per
    explicit request, so there's no format parameter to validate here
    anymore (there used to be). form25/form25b/form15/wageslip accept a
    real date range, not a single month -- each calendar month the range
    touches gets its own complete statutory section inside one combined
    PDF (see forms.py's _months_in_range)."""
    if form_code == "form25":
        return forms.build_form25(db, owner, start_date, end_date)
    if form_code == "form15":
        return forms.build_form15(db, owner, start_date, end_date)
    if form_code == "form12":
        worker = _get_owned_worker(worker_id, owner, db) if worker_id is not None else None
        return forms.build_form12(db, owner, worker=worker)
    if form_code == "form25b":
        worker = _get_owned_worker(worker_id, owner, db)
        return forms.build_form25b(db, owner, worker, start_date, end_date)
    if form_code == "wageslip":
        worker = _get_owned_worker(worker_id, owner, db)
        return forms.build_wageslip(db, owner, worker, start_date, end_date)
    # A stubbed form_templates row (Karnataka today) is listed so the
    # owner knows it's coming, but has no build_* implementation yet --
    # a real "not built yet" response, not the same as a typo'd form_code.
    template = db.query(models.FormTemplate).filter(models.FormTemplate.form_code == form_code).first()
    if template is not None and not template.is_available:
        raise HTTPException(status_code=501, detail=f"{template.label} isn't available yet.")
    raise HTTPException(status_code=404, detail=f"Unknown form_code {form_code!r}")


__all__ = [
    "io",
    "os",
    "secrets",
    "asynccontextmanager",
    "date_",
    "datetime",
    "timedelta",
    "timezone",
    "Depends",
    "FastAPI",
    "File",
    "HTTPException",
    "Query",
    "Request",
    "Response",
    "UploadFile",
    "CORSMiddleware",
    "HTMLResponse",
    "JSONResponse",
    "run_in_threadpool",
    "PILImage",
    "UnidentifiedImageError",
    "_rate_limit_exceeded_handler",
    "RateLimitExceeded",
    "func",
    "text",
    "Session",
    "admin",
    "CHIPS",
    "biometric_api",
    "forms",
    "models",
    "ocr",
    "_age_years",
    "photo_storage",
    "privacy_policy",
    "reports",
    "limiter",
    "upsert_attendance",
    "create_token",
    "get_current_owner",
    "hash_password",
    "verify_password",
    "mask_aadhaar",
    "Base",
    "SessionLocal",
    "engine",
    "get_db",
    "send_plain_email",
    "send_report_email",
    "AccountUpdateIn",
    "AttendanceMarkIn",
    "AttendanceOut",
    "ComplianceActionOut",
    "ComplianceCategoryOut",
    "ComplianceCheckOut",
    "ComplianceItemOut",
    "DailyWageSummaryOut",
    "DailyWorkerWageOut",
    "DashboardOut",
    "FactoryProfileIn",
    "ForgotPasswordIn",
    "FormTemplateOut",
    "FormEmailIn",
    "HealthOut",
    "HomeAlertOut",
    "HomeAlertsOut",
    "LeaveEntryIn",
    "LeaveEntryOut",
    "MonthEndOut",
    "MonthEndStepOut",
    "OcrFieldsOut",
    "OwnerLoginIn",
    "OwnerOut",
    "OwnerSignupIn",
    "ReportEmailIn",
    "ResetPasswordIn",
    "ShiftConfigIn",
    "ShiftConfigOut",
    "SlotSummary",
    "TokenOut",
    "UpgradeRequestIn",
    "UpgradeRequestOut",
    "WageProfileIn",
    "WageProfileOut",
    "WagePaymentIn",
    "WagePaymentOut",
    "WageSummaryOut",
    "WorkerComplianceIn",
    "WorkerComplianceOut",
    "WorkerCreateIn",
    "WorkerOut",
    "WorkerEmploymentIn",
    "WorkerTypeAssignIn",
    "WorkerTypeIn",
    "WorkerTypeOut",
    "WorkerWageOut",
    "ATTENDANCE_STATUSES",
    "MAX_WORKERS_PER_OWNER",
    "DEFAULT_PF_RATE_PERCENT",
    "MINIMUM_WORKING_AGE",
    "YOUNG_PERSON_AGE_CEILING",
    "_add_years",
    "_get_joining_date",
    "_validate_date_of_joining",
    "_shift_configs_for_owner",
    "ENVIRONMENT",
    "TRIAL_DAYS",
    "_owner_out",
    "_find_owner_by_identifier",
    "RESET_CODE_TTL_MINUTES",
    "MAX_OCR_UPLOAD_BYTES",
    "MAX_PHOTO_UPLOAD_BYTES",
    "_generate_worker_code",
    "_compliance_out",
    "_get_owned_worker",
    "MINIMUM_DAILY_WAGE",
    "_daily_equivalent",
    "_worker_wage_out",
    "COMPLIANCE_CATEGORY_LABELS",
    "COMPLIANCE_SEVERITY_WEIGHT",
    "_compliance_plural",
    "_compliance_names_preview",
    "_compliance_worker_action",
    "_compliance_item",
    "_compliance_credit",
    "_log_form_generation",
    "_generate_form_content",
]
