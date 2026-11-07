"""Statutory minimum-wage routes: reference data, selection, comparison."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import minimum_wage as mw
import models
from auth import get_current_owner
from database import get_db
from schemas import (
    MinimumWageCheckOut,
    MinimumWageClassOut,
    MinimumWageEmploymentIn,
    MinimumWageEmploymentOut,
    OwnerOut,
    WorkerMinimumWageClassIn,
    WorkerOut,
)

router = APIRouter()


@router.get("/minimum-wages/employments", response_model=list[MinimumWageEmploymentOut])
def list_minimum_wage_employments(
    as_of: date | None = None,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Every employment with its classes and the Basic/DA/minimum in force
    on `as_of` (default today). Reference data, same for every owner."""
    day = as_of or date.today()
    resolver = mw.MinimumWageResolver(db)
    out = []
    for emp in sorted(resolver.employments.values(), key=lambda e: e.name):
        da_v = mw._as_of_version(resolver._das.get(emp.id, []), day)
        classes = []
        for cls in sorted((c for c in resolver.classes.values() if c.employment_id == emp.id), key=lambda c: c.sl_no):
            m = resolver.minimum_as_of(cls.id, day)
            classes.append(
                MinimumWageClassOut(
                    id=cls.id,
                    sl_no=cls.sl_no,
                    name=cls.name,
                    rate_type=cls.rate_type,
                    basic=m["basic"] if m else None,
                    minimum=m["minimum"] if m else None,
                )
            )
        out.append(
            MinimumWageEmploymentOut(
                id=emp.id,
                code=emp.code,
                name=emp.name,
                jurisdiction=emp.jurisdiction,
                da_unit=emp.da_unit,
                da_days_per_month=emp.da_days_per_month,
                monthly_to_daily_divisor=emp.monthly_to_daily_divisor,
                da_value=da_v.da_value if da_v else None,
                da_effective_from=da_v.effective_from if da_v else None,
                da_verified=da_v.verified if da_v else None,
                classes=classes,
            )
        )
    return out


@router.get("/minimum-wages/check", response_model=MinimumWageCheckOut)
def check_minimum_wage(
    class_id: int,
    rate_type: str = Query(pattern="^(daily|weekly|monthly)$"),
    basic: float = Query(ge=0),
    da: float = Query(default=0, ge=0),
    as_of: date | None = None,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Compare a proposed salary (Basic + DA in `rate_type`) with the class
    minimum in force on `as_of` (default today)."""
    return mw.MinimumWageResolver(db).check(class_id, rate_type, basic, da, as_of or date.today())


@router.put("/owners/me/minimum-wage-employment", response_model=OwnerOut)
def set_owner_minimum_wage_employment(
    body: MinimumWageEmploymentIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    from common import _owner_out

    if body.employment_id is not None and not db.get(models.MinimumWageEmployment, body.employment_id):
        raise HTTPException(status_code=404, detail="Employment not found")
    if owner.min_wage_employment_id != body.employment_id:
        owner.min_wage_employment_id = body.employment_id
        # Classes belong to one employment: drop the now-foreign assignments.
        db.query(models.Worker).filter(
            models.Worker.owner_id == owner.id,
            models.Worker.min_wage_class_id.isnot(None),
        ).update({models.Worker.min_wage_class_id: None}, synchronize_session=False)
    db.commit()
    db.refresh(owner)
    return _owner_out(db, owner)


@router.put("/workers/{worker_id}/minimum-wage-class", response_model=WorkerOut)
def set_worker_minimum_wage_class(
    worker_id: int,
    body: WorkerMinimumWageClassIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    from common import _get_owned_worker

    worker = _get_owned_worker(worker_id, owner, db)
    if body.class_id is not None:
        cls = db.get(models.MinimumWageClass, body.class_id)
        if cls is None:
            raise HTTPException(status_code=404, detail="Class not found")
        if owner.min_wage_employment_id is None or cls.employment_id != owner.min_wage_employment_id:
            raise HTTPException(status_code=422, detail="Class does not belong to the factory's selected employment")
    worker.min_wage_class_id = body.class_id
    db.commit()
    db.refresh(worker)
    return worker
