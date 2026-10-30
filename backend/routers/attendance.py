"""attendance routes (moved verbatim from main.py)."""

from fastapi import APIRouter

from common import *  # noqa: F401,F403

router = APIRouter()


@router.get("/shift-configs", response_model=list[ShiftConfigOut])
def list_shift_configs(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    return _shift_configs_for_owner(db, owner.id)


@router.post("/shift-configs", response_model=ShiftConfigOut, status_code=201)
def create_shift_config(
    body: ShiftConfigIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(models.ShiftConfig)
        .filter(models.ShiftConfig.owner_id == owner.id, models.ShiftConfig.slot_key == body.slot_key)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"A shift with slot_key {body.slot_key!r} already exists")
    max_sort_order = (
        db.query(func.max(models.ShiftConfig.sort_order))
        .filter(models.ShiftConfig.owner_id == owner.id)
        .scalar()
    )
    shift = models.ShiftConfig(
        owner_id=owner.id,
        sort_order=(max_sort_order + 1) if max_sort_order is not None else 0,
        **body.model_dump(),
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift


@router.put("/shift-configs/{shift_id}", response_model=ShiftConfigOut)
def update_shift_config(
    shift_id: int,
    body: ShiftConfigIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    shift = (
        db.query(models.ShiftConfig)
        .filter(models.ShiftConfig.id == shift_id, models.ShiftConfig.owner_id == owner.id)
        .first()
    )
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    shift.label = body.label
    shift.start_time = body.start_time
    shift.end_time = body.end_time
    shift.rest_interval = body.rest_interval
    db.commit()
    db.refresh(shift)
    return shift


@router.delete("/shift-configs/{shift_id}", status_code=204)
def delete_shift_config(
    shift_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    shift = (
        db.query(models.ShiftConfig)
        .filter(models.ShiftConfig.id == shift_id, models.ShiftConfig.owner_id == owner.id)
        .first()
    )
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    in_use = (
        db.query(models.Attendance)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.Attendance.slot == shift.slot_key)
        .first()
    )
    if in_use:
        raise HTTPException(
            status_code=409, detail="This shift has attendance history and can't be deleted"
        )
    db.delete(shift)
    db.commit()


@router.post("/attendance", response_model=AttendanceOut)
def mark_attendance(
    body: AttendanceMarkIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    owner_slot_keys = {s.slot_key for s in _shift_configs_for_owner(db, owner.id)}
    if body.slot not in owner_slot_keys:
        raise HTTPException(status_code=422, detail=f"slot must be one of {sorted(owner_slot_keys)}")
    if body.status not in ATTENDANCE_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {ATTENDANCE_STATUSES}")

    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == body.worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    if body.date > date_.today():
        raise HTTPException(status_code=422, detail="Attendance can't be marked for a future date")
    joining_date = _get_joining_date(db, body.worker_id)
    if joining_date is not None and body.date < joining_date:
        raise HTTPException(
            status_code=422,
            detail=f"Attendance can't be marked before this worker's date of entry into service ({joining_date.isoformat()})",
        )

    # Upsert on (worker_id, date, slot) -- re-marking the same slot updates
    # it rather than creating a duplicate row (matches the DB's own unique
    # constraint, so this also avoids ever hitting that constraint error).
    # Shared with the biometric sync job (attendance_service.py) so a
    # supervisor's manual tap and a resolved punch write the same way.
    return upsert_attendance(
        db,
        worker_id=body.worker_id,
        date=body.date,
        slot=body.slot,
        status=body.status,
        overtime_hours=body.overtime_hours,
        marked_by=owner.id,
        source="manual",
        source_detail=owner.name,
    )


@router.get("/attendance", response_model=list[AttendanceOut])
def list_attendance(
    date: date_ = Query(default_factory=date_.today),
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    return (
        db.query(models.Attendance)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.Attendance.date == date)
        .all()
    )


@router.get("/dashboard", response_model=DashboardOut)
def get_dashboard(
    date: date_ = Query(default_factory=date_.today),
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    active_workers = (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id, models.Worker.status == "active")
        .all()
    )
    total = len(active_workers)
    active_ids = {w.id for w in active_workers}

    records = (
        db.query(models.Attendance)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.Attendance.date == date)
        .all()
    )

    # "Present today" = marked present in at least one slot -- a worker
    # present only in the AM slot still counts, not just all-slots-present.
    present_worker_ids = {
        r.worker_id for r in records if r.status == "present" and r.worker_id in active_ids
    }

    slots = []
    for shift in _shift_configs_for_owner(db, owner.id):
        slot_present = sum(
            1
            for r in records
            if r.slot == shift.slot_key and r.status == "present" and r.worker_id in active_ids
        )
        slots.append(SlotSummary(slot=shift.slot_key, present=slot_present, total=total))

    return DashboardOut(
        date=date,
        total_workers=total,
        present_today=len(present_worker_ids),
        slots=slots,
    )
