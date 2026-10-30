"""insights routes (moved verbatim from main.py)."""

from fastapi import APIRouter

from common import *  # noqa: F401,F403

router = APIRouter()


@router.get("/home/alerts", response_model=HomeAlertsOut)
def get_home_alerts(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """"Needs attention" list for the Today screen -- a small, actionable
    set of things worth surfacing before the owner starts their day, not
    a general notification feed. Empty list means nothing needs
    attention right now."""
    alerts: list[HomeAlertOut] = []

    active_workers = (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id, models.Worker.status == "active")
        .all()
    )
    active_ids = {w.id for w in active_workers}

    compliant_worker_ids = (
        db.query(models.WorkerCompliance.worker_id)
        .join(models.Worker, models.Worker.id == models.WorkerCompliance.worker_id)
        .filter(models.Worker.owner_id == owner.id)
    )
    missing_count = (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id, models.Worker.id.not_in(compliant_worker_ids))
        .count()
    )
    if missing_count > 0:
        alerts.append(
            HomeAlertOut(
                code="missing_compliance",
                message=f"{missing_count} worker{'s' if missing_count != 1 else ''} need Form 12 details",
                count=missing_count,
            )
        )

    device_count = db.query(models.BiometricDevice).filter(models.BiometricDevice.owner_id == owner.id).count()
    if device_count > 0:
        mapped_worker_ids = {
            worker_id
            for (worker_id,) in db.query(models.DeviceUserMapping.worker_id)
            .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
            .filter(models.BiometricDevice.owner_id == owner.id)
            .all()
        }
        unmapped_count = len(active_ids - mapped_worker_ids)
        if unmapped_count > 0:
            alerts.append(
                HomeAlertOut(
                    code="unmapped_devices",
                    message=f"{unmapped_count} worker{'s' if unmapped_count != 1 else ''} not mapped to a biometric device",
                    count=unmapped_count,
                )
            )

    today = date_.today()
    marked_worker_ids = {
        worker_id
        for (worker_id,) in db.query(models.Attendance.worker_id)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.Attendance.date == today)
        .distinct()
        .all()
    }
    not_marked_count = len(active_ids - marked_worker_ids)
    if not_marked_count > 0:
        alerts.append(
            HomeAlertOut(
                code="not_marked_today",
                message=f"{not_marked_count} worker{'s' if not_marked_count != 1 else ''} not marked for today yet",
                count=not_marked_count,
            )
        )

    underage_count = sum(
        1 for w in active_workers if w.dob and _age_years(w.dob, date_.today()) < MINIMUM_WORKING_AGE
    )
    if underage_count > 0:
        alerts.append(
            HomeAlertOut(
                code="underage_workers",
                message=f"{underage_count} worker{'s' if underage_count != 1 else ''} under the legal minimum working age ({MINIMUM_WORKING_AGE})",
                count=underage_count,
            )
        )

    return HomeAlertsOut(alerts=alerts)


@router.get("/compliance/check", response_model=ComplianceCheckOut)
def get_compliance_check(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """A single weighted score (0-100) over everything Labour Lens already
    tracks for statutory record-keeping -- read-only, computed fresh from
    the same tables /home/alerts and the Form 12 screens already read,
    nothing cached or written. Not a legal certificate -- a guide to
    which records are incomplete (see the "How your score is calculated"
    sheet on the mobile screen for the exact wording shown to owners).

    Two checks from the original spec are skipped outright because no
    model in this schema holds the data they'd need: adolescent
    night-shift restriction and daily/weekly overtime limits -- there's
    no shift-time-of-day or per-worker hour-cap tracking anywhere here.
    """
    today = date_.today()
    active_workers = (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id, models.Worker.status == "active")
        .all()
    )
    total_active = len(active_workers)

    # --- age_hours: under minimum working age ---
    underage = [w for w in active_workers if w.dob and _age_years(w.dob, today) < MINIMUM_WORKING_AGE]

    # --- wages: effective wage profile per worker -- the latest row with
    # effective_from <= today, same "current rate" definition get_wage_profile uses ---
    wage_rows = (
        db.query(models.WageProfile)
        .join(models.Worker, models.Worker.id == models.WageProfile.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.WageProfile.effective_from <= today)
        .order_by(models.WageProfile.worker_id, models.WageProfile.effective_from.desc(), models.WageProfile.id.desc())
        .all()
    )
    current_wage_by_worker: dict[int, models.WageProfile] = {}
    for row in wage_rows:
        current_wage_by_worker.setdefault(row.worker_id, row)
    no_wage_rate = [w for w in active_workers if w.id not in current_wage_by_worker]

    # --- wages: last month's payment recorded, for workers who are actually paid (basic > 0) ---
    first_of_this_month = today.replace(day=1)
    last_month_end = first_of_this_month - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1)
    paid_last_month_ids = {
        worker_id
        for (worker_id,) in db.query(models.WagePayment.worker_id)
        .join(models.Worker, models.Worker.id == models.WagePayment.worker_id)
        .filter(
            models.Worker.owner_id == owner.id,
            models.WagePayment.month == last_month_start.month,
            models.WagePayment.year == last_month_start.year,
        )
        .all()
    }
    payable_workers = [w for w in active_workers if (p := current_wage_by_worker.get(w.id)) and p.basic > 0]
    unpaid_last_month = [w for w in payable_workers if w.id not in paid_last_month_ids]

    # --- workers: Form 12 completeness -- same 5 fields as the app's own completeness calc ---
    compliance_by_worker = {
        c.worker_id: c
        for c in db.query(models.WorkerCompliance)
        .join(models.Worker, models.Worker.id == models.WorkerCompliance.worker_id)
        .filter(models.Worker.owner_id == owner.id)
        .all()
    }
    FORM12_FIELDS = ("father_or_spouse_name", "designation_or_nature_of_work", "epf_uan_no", "esic_no", "date_of_joining")

    def _form12_filled(c) -> int:
        return sum(1 for f in FORM12_FIELDS if c and getattr(c, f)) if c else 0

    form12_incomplete = [w for w in active_workers if _form12_filled(compliance_by_worker.get(w.id)) < len(FORM12_FIELDS)]

    # --- attendance: at least one record last month -- a coarse "ever marked",
    # not a day-by-day diff; a worker can still have gaps within the month and pass ---
    marked_last_month_ids = {
        worker_id
        for (worker_id,) in db.query(models.Attendance.worker_id)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(
            models.Worker.owner_id == owner.id,
            models.Attendance.date >= last_month_start,
            models.Attendance.date <= last_month_end,
        )
        .distinct()
        .all()
    }
    unmarked_last_month = [w for w in active_workers if w.id not in marked_last_month_ids]

    # --- registers: biometric consent on file ---
    consented_ids = {
        worker_id
        for (worker_id,) in db.query(models.BiometricConsent.worker_id)
        .join(models.Worker, models.Worker.id == models.BiometricConsent.worker_id)
        .filter(models.Worker.owner_id == owner.id)
        .all()
    }
    no_consent = [w for w in active_workers if w.id not in consented_ids]

    no_photo = [w for w in active_workers if not w.photo_key]
    no_bank = [w for w in active_workers if not w.bank_account_number or not w.bank_ifsc]
    no_worker_type = [w for w in active_workers if not w.worker_type_id]

    # --- registers: mapped to a biometric device -- only scored if the
    # owner has registered at least one device (same gate /home/alerts uses) ---
    device_count = db.query(models.BiometricDevice).filter(models.BiometricDevice.owner_id == owner.id).count()
    device_unmapped = None
    if device_count > 0:
        mapped_ids = {
            worker_id
            for (worker_id,) in db.query(models.DeviceUserMapping.worker_id)
            .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
            .filter(models.BiometricDevice.owner_id == owner.id)
            .all()
        }
        device_unmapped = [w for w in active_workers if w.id not in mapped_ids]

    items: list[ComplianceItemOut] = []
    if total_active > 0:
        items.append(_compliance_item("under_minimum_age", "under minimum age", "verify date of birth",
                                       "No active worker is under the legal minimum working age.",
                                       "age_hours", "critical", underage, total_active, "Under minimum age"))
        items.append(_compliance_item("no_wage_rate", "without a wage rate", "no wage rate set",
                                       "Every active worker has a wage rate set.",
                                       "wages", "critical", no_wage_rate, total_active, "No wage rate"))
        items.append(_compliance_item("form12_incomplete", "missing Form 12 details", "Form 12 details incomplete",
                                       "Form 12 details are complete for every active worker.",
                                       "workers", "important", form12_incomplete, total_active, "Form 12 incomplete"))
        items.append(_compliance_item("attendance_unmarked_last_month", "with no attendance marked last month",
                                       "no attendance marked last month",
                                       "Every active worker has at least one attendance record for last month.",
                                       "attendance", "important", unmarked_last_month, total_active, "Unmarked last month"))
        items.append(_compliance_item("no_biometric_consent", "missing biometric consent", "biometric consent not captured",
                                       "Biometric consent is on file for every active worker.",
                                       "registers", "important", no_consent, total_active, "Missing consent"))
        items.append(_compliance_item("no_photo", "missing a photo", "no ID photo uploaded",
                                       "Every active worker has a photo on file.",
                                       "workers", "minor", no_photo, total_active, "No photo"))
        items.append(_compliance_item("no_bank_details", "missing bank details", "bank details missing",
                                       "Bank details are on file for every active worker.",
                                       "wages", "minor", no_bank, total_active, "Missing bank details"))
        items.append(_compliance_item("no_worker_type", "without a worker type", "rate set manually",
                                       "Every active worker has a worker type assigned.",
                                       "wages", "minor", no_worker_type, total_active, "No worker type"))

    if payable_workers:
        items.append(_compliance_item("last_month_unpaid", "with last month's wages unpaid",
                                       "last month's wages not recorded as paid",
                                       "Last month's wages are recorded as paid for every worker who earns one.",
                                       "wages", "critical", unpaid_last_month, len(payable_workers), "Wages unpaid"))

    if device_unmapped is not None:
        items.append(_compliance_item("device_unmapped", "not on the biometric device", "attendance won't clock in automatically",
                                       "Every active worker is mapped to a biometric device.",
                                       "registers", "minor", device_unmapped, total_active, "Not mapped to device"))

    # --- registers: one-time factory setup, not per-worker ---
    shift_count = db.query(models.ShiftConfig).filter(models.ShiftConfig.owner_id == owner.id).count()
    setup_passed = bool(owner.factory_address) and shift_count > 0
    items.append(
        ComplianceItemOut(
            key="factory_setup",
            label="Factory setup complete" if setup_passed else "Factory setup incomplete",
            detail=(
                "Factory address and at least one shift are set up."
                if setup_passed
                else "Add your factory address and at least one shift."
            ),
            category="registers",
            severity="minor",
            weight=COMPLIANCE_SEVERITY_WEIGHT["minor"],
            passed=setup_passed,
            affected=0 if setup_passed else 1,
            total=1,
            worker_ids=[],
            action=None if setup_passed else ComplianceActionOut(screen="Profile", params={}),
        )
    )

    total_weight = sum(i.weight for i in items)
    total_credit = sum(_compliance_credit(i) for i in items)
    score = round(100 * total_credit / total_weight) if total_weight else 100
    band = "ready" if score >= 90 else "good" if score >= 70 else "act"

    categories = []
    for cat_key, cat_label in COMPLIANCE_CATEGORY_LABELS.items():
        cat_items = [i for i in items if i.category == cat_key]
        if not cat_items:
            continue
        cat_weight = sum(i.weight for i in cat_items)
        cat_credit = sum(_compliance_credit(i) for i in cat_items)
        cat_score = round(100 * cat_credit / cat_weight) if cat_weight else 100
        categories.append(ComplianceCategoryOut(key=cat_key, label=cat_label, score=cat_score))

    return ComplianceCheckOut(
        score=score,
        band=band,
        checked_at=datetime.now(timezone.utc),
        categories=categories,
        items=items,
    )


@router.get("/ask/{chip}")
def ask_chip(
    chip: str,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """"Ask Labour Lens" one-tap question chips -- read-only, no AI/LLM
    yet (see ask.py); each chip function is already shaped to become an
    AI tool implementation later without changing this endpoint."""
    fn = CHIPS.get(chip)
    if fn is None:
        raise HTTPException(status_code=404, detail="Unknown question")
    return fn(db, owner.id)
