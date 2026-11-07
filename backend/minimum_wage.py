"""Statutory minimum-wage reference data and comparison logic.

Basic rates (from the Government Order) and DA are stored as SEPARATELY
versioned components: a DA revision adds a new MinimumWageDaVersion row and
never touches the Basic versions, so the minimum for a past date is always
recomputed from the Basic + DA that were in force then. Rows are append-only.

Rules (Tamil Nadu Rice/Flour/Dhall Mills):
  daily class   : minimum = Basic + DA/day
  monthly class : minimum = Basic + DA/day x 30
  a monthly figure converts to a day figure as monthly / 26
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

import models

TN_RICE_FLOUR_DHALL = "tn_rice_flour_dhall_mills"
DA_DAYS_PER_MONTH = 30
MONTHLY_TO_DAILY_DIVISOR = 26
WEEKLY_TO_DAILY_DIVISOR = 6  # a weekly wage covers a 6-day working week

# Original GO carries no effective date in the source supplied: Basic rates are
# versioned from this sentinel and a later GO revision adds a new row.
BASIC_EFFECTIVE_FROM = date(2000, 1, 1)
# DA is revised every 1 April. Value needs official verification (verified=False).
DA_EFFECTIVE_FROM = date(2026, 4, 1)
DA_DAILY_CURRENT = 292.80

_D = "daily"
_M = "monthly"
# (sl_no, class, rate_type, basic)
TN_RICE_FLOUR_DHALL_CLASSES: list[tuple[int, str, str, float]] = [
    (1, "Hamalis (Bag Carriers)", _D, 270.50),
    (2, "Bag Weighter of Katta Mazdoors", _D, 267),
    (3, "Bag Stitchers", _D, 267),
    (4, "Carriers of husk", _D, 261),
    (5, "Mazdoors including miscellaneous workers", _D, 261),
    (6, "Carriers of Rice", _D, 261),
    (7, "Engine Driver", _D, 279),
    (8, "Electrician", _D, 279),
    (9, "Fireman", _D, 262),
    (10, "Fitter", _D, 267),
    (11, "Hullerman", _D, 262),
    (12, "Maistries", _D, 270.50),
    (13, "Mechanic", _D, 270.50),
    (14, "Oilers", _D, 261),
    (15, "Paddy Boilers", _D, 267),
    (16, "Paddy Drivers", _D, 261),
    (17, "Paddy Millers", _D, 261),
    (18, "Sweepers", _D, 261),
    (19, "Shellerman", _D, 261),
    (20, "Winnowers", _D, 261),
    (21, "Paddy Soakers", _D, 261),
    (22, "Water Carriers", _D, 261),
    (23, "Watchman", _D, 261),
    (24, "Mazdoors employed in polishing", _D, 261),
    (25, "Rice Measures", _D, 262),
    (26, "Mazdoors employed in grinding grain", _D, 261),
    (27, "Dhall Manufacturers", _D, 261),
    (28, "Loadman", _D, 261),
    (29, "Peons", _D, 261),
    (30, "Carpenters", _D, 267),
    (31, "Varukadalai Workers", _D, 270.50),
    (32, "Clerk", _M, 7632),
    (33, "Attenders", _M, 7363),
]


def seed_reference_data(db: Session) -> None:
    """Idempotent: inserts the Tamil Nadu employment, its classes and the
    initial Basic/DA versions only where missing. Never edits existing rows.
    Used by tests and local dev; the Alembic migration seeds production."""
    emp = db.query(models.MinimumWageEmployment).filter_by(code=TN_RICE_FLOUR_DHALL).first()
    if emp is None:
        emp = models.MinimumWageEmployment(
            code=TN_RICE_FLOUR_DHALL,
            name="Rice Mills, Flour Mills or Dhall Mills",
            jurisdiction="Tamil Nadu",
            da_unit="daily",
            da_days_per_month=DA_DAYS_PER_MONTH,
            monthly_to_daily_divisor=MONTHLY_TO_DAILY_DIVISOR,
            da_revision_note="Revised every 1 April",
        )
        db.add(emp)
        db.flush()
    have_da = db.query(models.MinimumWageDaVersion).filter_by(employment_id=emp.id).first()
    if have_da is None:
        db.add(
            models.MinimumWageDaVersion(
                employment_id=emp.id,
                da_value=DA_DAILY_CURRENT,
                effective_from=DA_EFFECTIVE_FROM,
                verified=False,
                source="Current DA per day; subject to official verification",
            )
        )
    existing = {c.name: c for c in db.query(models.MinimumWageClass).filter_by(employment_id=emp.id)}
    for sl_no, name, rate_type, basic in TN_RICE_FLOUR_DHALL_CLASSES:
        cls = existing.get(name)
        if cls is None:
            cls = models.MinimumWageClass(employment_id=emp.id, sl_no=sl_no, name=name, rate_type=rate_type)
            db.add(cls)
            db.flush()
            db.add(
                models.MinimumWageBasicVersion(
                    class_id=cls.id, basic=basic, effective_from=BASIC_EFFECTIVE_FROM, source="Original GO"
                )
            )
    db.commit()


def minimum_for(rate_type: str, basic: float, da_daily: float, da_days_per_month: int = DA_DAYS_PER_MONTH) -> float:
    """daily class: Basic + DA; monthly class: Basic + DA x 30."""
    if rate_type == "monthly":
        return round(basic + da_daily * da_days_per_month, 2)
    return round(basic + da_daily, 2)


def convert_amount(
    amount: float, from_type: str, to_type: str, monthly_to_daily_divisor: int = MONTHLY_TO_DAILY_DIVISOR
) -> float:
    """Convert a wage between daily / weekly / monthly units using the
    26-day month (weekly = 6 working days)."""
    if from_type == to_type:
        return amount
    if from_type == "monthly":
        daily = amount / monthly_to_daily_divisor
    elif from_type == "weekly":
        daily = amount / WEEKLY_TO_DAILY_DIVISOR
    else:
        daily = amount
    if to_type == "monthly":
        return daily * monthly_to_daily_divisor
    if to_type == "weekly":
        return daily * WEEKLY_TO_DAILY_DIVISOR
    return daily


def _as_of_version(versions, as_of: date):
    """Latest version with effective_from <= as_of (ties -> newest id)."""
    best = None
    for v in versions:
        if v.effective_from <= as_of and (
            best is None or (v.effective_from, v.id) > (best.effective_from, best.id)
        ):
            best = v
    return best


class MinimumWageResolver:
    """Loads the (tiny) reference tables once, so a whole-factory wage
    summary resolves every worker with zero extra queries."""

    def __init__(self, db: Session):
        self.employments = {e.id: e for e in db.query(models.MinimumWageEmployment)}
        self.classes = {c.id: c for c in db.query(models.MinimumWageClass)}
        self._basics: dict[int, list] = {}
        for b in db.query(models.MinimumWageBasicVersion):
            self._basics.setdefault(b.class_id, []).append(b)
        self._das: dict[int, list] = {}
        for d in db.query(models.MinimumWageDaVersion):
            self._das.setdefault(d.employment_id, []).append(d)

    def minimum_as_of(self, class_id: int, as_of: date) -> dict | None:
        """Statutory minimum for a class on a date, or None if no Basic or DA
        version was in force then."""
        cls = self.classes.get(class_id)
        if cls is None:
            return None
        emp = self.employments[cls.employment_id]
        basic_v = _as_of_version(self._basics.get(cls.id, []), as_of)
        da_v = _as_of_version(self._das.get(emp.id, []), as_of)
        if basic_v is None or da_v is None:
            return None
        return {
            "class_id": cls.id,
            "class_name": cls.name,
            "employment_name": emp.name,
            "jurisdiction": emp.jurisdiction,
            "rate_type": cls.rate_type,
            "basic": basic_v.basic,
            "da": da_v.da_value,
            "minimum": minimum_for(cls.rate_type, basic_v.basic, da_v.da_value, emp.da_days_per_month),
            "da_effective_from": da_v.effective_from,
            "da_verified": da_v.verified,
            "monthly_to_daily_divisor": emp.monthly_to_daily_divisor,
        }

    def check(self, class_id: int | None, rate_type: str, basic: float, da: float, as_of: date) -> dict:
        """Compare a proposed salary (Basic + DA, in the worker's own unit)
        with the class minimum on `as_of`. Always returns a dict; `available`
        is False (with a reason) when no comparison can be made."""
        if class_id is None:
            return {"available": False, "reason": "No minimum-wage class selected"}
        m = self.minimum_as_of(class_id, as_of)
        if m is None:
            return {"available": False, "reason": "No minimum-wage rate in force on this date"}
        proposed = round(
            convert_amount(basic + da, rate_type, m["rate_type"], m["monthly_to_daily_divisor"]), 2
        )
        div = m["monthly_to_daily_divisor"]
        return {
            "available": True,
            "reason": None,
            **m,
            "unit": "month" if m["rate_type"] == "monthly" else "day",
            "proposed": proposed,
            "meets": proposed >= m["minimum"],
            "shortfall": round(max(m["minimum"] - proposed, 0), 2),
            "minimum_per_day": round(m["minimum"] / div, 2) if m["rate_type"] == "monthly" else m["minimum"],
            "proposed_per_day": round(proposed / div, 2) if m["rate_type"] == "monthly" else proposed,
        }
