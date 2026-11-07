"""wages routes (moved verbatim from main.py)."""

from fastapi import APIRouter

from common import *  # noqa: F401,F403

router = APIRouter()


@router.get("/wage-summary", response_model=WageSummaryOut)
def get_wage_summary(
    month: int,
    year: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Factory-wide monthly wage bill -- every active worker's
    contribution to the total, for the Wage Calculation tab."""
    workers = [w for w in forms._all_workers(db, owner.id) if w.status == "active"]
    results = []
    total_gross = 0.0
    total_net = 0.0
    wages = forms.compute_wage_bulk(db, owner.id, [w.id for w in workers], month, year)
    for worker in workers:
        wage = wages.get(worker.id)
        if wage is not None:
            total_gross += wage["gross"]
            total_net += wage["net"]
        results.append(_worker_wage_out(worker, wage))
    return WageSummaryOut(
        period_label=f"{year}-{month:02d}", total_workers=len(workers), total_gross=total_gross, total_net=total_net, workers=results
    )


@router.get("/wage-summary/daily", response_model=DailyWageSummaryOut)
def get_daily_wage_summary(
    date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Factory-wide labour cost for one specific day -- a quick
    cash-flow figure, not the statutory monthly wage register."""
    workers = [w for w in forms._all_workers(db, owner.id) if w.status == "active"]
    results = []
    total_cost = 0.0
    present_count = 0
    dailies = forms.compute_daily_wage_bulk(db, [w.id for w in workers], date)
    for worker in workers:
        daily = dailies[worker.id]
        if daily["present"]:
            present_count += 1
            total_cost += daily["daily_cost"]
        results.append(
            DailyWorkerWageOut(
                worker_id=worker.id,
                worker_name=worker.name,
                numeric_employee_code=worker.numeric_employee_code,
                has_rate=daily["has_rate"],
                present=daily["present"],
                daily_cost=daily["daily_cost"],
            )
        )
    return DailyWageSummaryOut(date=date, total_workers_present=present_count, total_daily_cost=total_cost, workers=results)


@router.get("/month-end/{year}/{month}", response_model=MonthEndOut)
def get_month_end(
    year: int,
    month: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Progress for the 4-step month-end guided flow (Attendance / Wages
    / Payments / Forms & slips) -- every step's "complete" is derived
    from real data (never a manually-ticked checkbox), reusing the same
    wage computation the Wages tab itself uses so the two can't disagree."""
    month_start, month_end = forms._month_date_range(month, year)
    today = date_.today()
    check_end = min(month_end, today) if (year, month) == (today.year, today.month) else month_end

    active_workers = (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id, models.Worker.status == "active")
        .all()
    )
    worker_ids = [w.id for w in active_workers]

    # Attendance step: every active worker (from their joining date, or
    # month start if none on file) accounted for -- present, absent, or
    # on leave -- on every day up to today (the current month) or the
    # full month (a past month).
    attendance_dates_by_worker: dict[int, set[date_]] = {}
    for worker_id, a_date in (
        db.query(models.Attendance.worker_id, models.Attendance.date)
        .filter(models.Attendance.worker_id.in_(worker_ids), models.Attendance.date >= month_start, models.Attendance.date <= check_end)
        .distinct()
        .all()
    ):
        attendance_dates_by_worker.setdefault(worker_id, set()).add(a_date)

    leave_by_worker: dict[int, list[tuple[date_, date_]]] = {}
    for worker_id, date_from, date_to in (
        db.query(models.LeaveEntry.worker_id, models.LeaveEntry.date_from, models.LeaveEntry.date_to)
        .filter(models.LeaveEntry.worker_id.in_(worker_ids), models.LeaveEntry.date_from <= check_end, models.LeaveEntry.date_to >= month_start)
        .all()
    ):
        leave_by_worker.setdefault(worker_id, []).append((date_from, date_to))

    expected_days = 0
    marked_days = 0
    for worker in active_workers:
        joined = _get_joining_date(db, worker.id) or month_start
        day = max(joined, month_start)
        marked = attendance_dates_by_worker.get(worker.id, set())
        leaves = leave_by_worker.get(worker.id, [])
        while day <= check_end:
            expected_days += 1
            if day in marked or any(f <= day <= t for f, t in leaves):
                marked_days += 1
            day += timedelta(days=1)

    attendance_complete = expected_days > 0 and marked_days == expected_days
    attendance_detail = f"{marked_days} of {expected_days} worker-days marked" if expected_days > 0 else "No active workers yet"

    # Wages / Payments steps: reuse the same per-worker wage computation
    # the Wages tab itself uses.
    rated_count = 0
    paid_count = 0
    wages_by_worker = forms.compute_wage_bulk(db, owner.id, [w.id for w in active_workers], month, year)
    for worker in active_workers:
        wage = wages_by_worker.get(worker.id)
        wage_out = _worker_wage_out(worker, wage)
        if wage_out.has_rate:
            rated_count += 1
            if wage_out.paid:
                paid_count += 1

    wages_complete = len(active_workers) > 0 and rated_count == len(active_workers)
    payments_complete = rated_count > 0 and paid_count == rated_count

    # Forms step: at least one of the period-scoped statutory forms was
    # generated or emailed FOR this month -- there's no "reviewed and
    # correct" signal to check server-side, only that it was produced.
    # `period_label` (the requested range, e.g. "2026-08-01 to
    # 2026-08-31") is what has to overlap the target month here, not
    # `generated_at` (when the action happened) -- a form for a past
    # month is often generated well into the next one.
    candidate_logs = (
        db.query(models.FormGenerationLog)
        .filter(
            models.FormGenerationLog.owner_id == owner.id,
            models.FormGenerationLog.form_code.in_(["form25", "form25b", "form12", "form15", "wageslip"]),
        )
        .all()
    )
    forms_complete = False
    for log in candidate_logs:
        if not log.period_label:
            continue
        try:
            start_str, end_str = log.period_label.split(" to ")
            log_start = date_.fromisoformat(start_str)
            log_end = date_.fromisoformat(end_str)
        except ValueError:
            continue
        if log_start <= month_end and log_end >= month_start:
            forms_complete = True
            break

    return MonthEndOut(
        year=year,
        month=month,
        steps=[
            MonthEndStepOut(key="attendance", label="Attendance", complete=attendance_complete, detail=attendance_detail),
            MonthEndStepOut(
                key="wages",
                label="Wages",
                complete=wages_complete,
                detail=f"{rated_count} of {len(active_workers)} workers have a wage rate" if active_workers else "No active workers yet",
            ),
            MonthEndStepOut(
                key="payments",
                label="Payments",
                complete=payments_complete,
                detail=f"{paid_count} of {rated_count} paid" if rated_count > 0 else "Set wage rates first",
            ),
            MonthEndStepOut(
                key="forms",
                label="Forms & slips",
                complete=forms_complete,
                detail="Generated or emailed this month" if forms_complete else "Not generated yet this month",
            ),
        ],
    )
