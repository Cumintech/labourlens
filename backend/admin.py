"""Admin portal API -- platform-operator use only, one admin account,
no roles. Every route here is behind get_current_admin (see
admin_auth.py) except /admin/login itself. Deliberately simple: no
pagination, no complex query builder -- this is sized for "one person
watching a still-small number of factories," not a general admin
platform."""

from datetime import date as date_, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from admin_auth import create_admin_token, get_current_admin, verify_password
from database import get_db
from rate_limit import limiter
from schemas import (
    AdminDashboardOut,
    AdminLoginIn,
    AdminTokenOut,
    FactoryDetailOut,
    FactoryEmployeeSnapshotOut,
    FactoryOut,
    FactoryPaymentIn,
    FactoryPaymentOut,
    FactoryUpdateIn,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def _current_month_label(as_of: date_ | None = None) -> str:
    d = as_of or datetime.now(timezone.utc).date()
    return f"{d.year:04d}-{d.month:02d}"


def _active_employee_count(db: Session, owner_id: int) -> int:
    return (
        db.query(func.count(models.Worker.id))
        .filter(models.Worker.owner_id == owner_id, models.Worker.status == "active")
        .scalar()
        or 0
    )


def _factory_out(db: Session, factory: models.Factory) -> FactoryOut:
    return FactoryOut(
        id=factory.id,
        owner_id=factory.owner_id,
        name=factory.name,
        owner_name=factory.owner_name,
        owner_contact=factory.owner_contact,
        status=factory.status,
        plan_tier=factory.plan_tier,
        enrolled_at=factory.enrolled_at,
        notes=factory.notes,
        active_employee_count=_active_employee_count(db, factory.owner_id),
    )


def _payment_out(payment: models.FactoryPayment) -> FactoryPaymentOut:
    is_overdue = payment.status != "paid" and payment.due_date < datetime.now(timezone.utc).date()
    return FactoryPaymentOut(
        id=payment.id,
        factory_id=payment.factory_id,
        amount=payment.amount,
        due_date=payment.due_date,
        paid_date=payment.paid_date,
        status=payment.status,
        is_overdue=is_overdue,
    )


def _get_owned_factory(factory_id: int, db: Session) -> models.Factory:
    factory = db.get(models.Factory, factory_id)
    if not factory:
        raise HTTPException(status_code=404, detail="Factory not found")
    return factory


@router.post("/login", response_model=AdminTokenOut)
@limiter.limit("10/minute")
def admin_login(request: Request, body: AdminLoginIn, db: Session = Depends(get_db)):
    admin = db.query(models.AdminUser).filter(models.AdminUser.email == body.email).first()
    if not admin or not verify_password(body.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return AdminTokenOut(access_token=create_admin_token(admin.id))


@router.get("/dashboard", response_model=AdminDashboardOut)
def admin_dashboard(
    admin: models.AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    factories = db.query(models.Factory).all()
    counts_by_status: dict[str, int] = {}
    total_active_employees = 0
    for f in factories:
        counts_by_status[f.status] = counts_by_status.get(f.status, 0) + 1
        total_active_employees += _active_employee_count(db, f.owner_id)
    return AdminDashboardOut(
        total_factories=len(factories),
        counts_by_status=counts_by_status,
        total_active_employees=total_active_employees,
    )


@router.get("/factories", response_model=list[FactoryOut])
def list_factories(
    status: str | None = None,
    admin: models.AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(models.Factory)
    if status:
        query = query.filter(models.Factory.status == status)
    factories = query.order_by(models.Factory.enrolled_at.desc()).all()
    return [_factory_out(db, f) for f in factories]


@router.get("/factories/{factory_id}", response_model=FactoryDetailOut)
def get_factory_detail(
    factory_id: int,
    admin: models.AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    factory = _get_owned_factory(factory_id, db)
    payments = (
        db.query(models.FactoryPayment)
        .filter(models.FactoryPayment.factory_id == factory_id)
        .order_by(models.FactoryPayment.due_date.desc())
        .all()
    )
    snapshots = (
        db.query(models.FactoryEmployeeSnapshot)
        .filter(models.FactoryEmployeeSnapshot.factory_id == factory_id)
        .order_by(models.FactoryEmployeeSnapshot.month.asc())
        .all()
    )
    current_month = _current_month_label()
    return FactoryDetailOut(
        factory=_factory_out(db, factory),
        payments=[_payment_out(p) for p in payments],
        employee_trend=[
            FactoryEmployeeSnapshotOut(
                month=s.month,
                active_employee_count=s.active_employee_count,
                is_current_month=(s.month == current_month),
            )
            for s in snapshots
        ],
    )


@router.patch("/factories/{factory_id}", response_model=FactoryOut)
def update_factory(
    factory_id: int,
    body: FactoryUpdateIn,
    admin: models.AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    factory = _get_owned_factory(factory_id, db)
    if body.status is not None:
        factory.status = body.status
    if body.plan_tier is not None:
        factory.plan_tier = body.plan_tier
    if body.notes is not None:
        factory.notes = body.notes
    db.commit()
    db.refresh(factory)
    return _factory_out(db, factory)


@router.post("/factories/{factory_id}/payments", response_model=FactoryPaymentOut, status_code=201)
def create_factory_payment(
    factory_id: int,
    body: FactoryPaymentIn,
    admin: models.AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    _get_owned_factory(factory_id, db)  # 404s if the factory doesn't exist
    payment = models.FactoryPayment(factory_id=factory_id, **body.model_dump())
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return _payment_out(payment)


@router.patch("/factories/{factory_id}/payments/{payment_id}", response_model=FactoryPaymentOut)
def update_factory_payment(
    factory_id: int,
    payment_id: int,
    body: FactoryPaymentIn,
    admin: models.AdminUser = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    payment = db.get(models.FactoryPayment, payment_id)
    if not payment or payment.factory_id != factory_id:
        raise HTTPException(status_code=404, detail="Payment not found")
    payment.amount = body.amount
    payment.due_date = body.due_date
    payment.paid_date = body.paid_date
    payment.status = body.status
    db.commit()
    db.refresh(payment)
    return _payment_out(payment)
