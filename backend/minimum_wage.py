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

import minimum_wage_data as data
import models

TN_RICE_FLOUR_DHALL = "tn_rice_flour_dhall_mills"
BRICK_TILES = data.BRICK_TILES
DA_DAYS_PER_MONTH = 30
MONTHLY_TO_DAILY_DIVISOR = 26
WEEKLY_TO_DAILY_DIVISOR = 6  # a weekly wage covers a 6-day working week


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


def _ensure_employment(db: Session, code: str, name: str) -> "models.MinimumWageEmployment":
    emp = db.query(models.MinimumWageEmployment).filter_by(code=code).first()
    if emp is None:
        emp = models.MinimumWageEmployment(
            code=code,
            name=name,
            jurisdiction="Tamil Nadu",
            da_unit="daily",
            da_days_per_month=DA_DAYS_PER_MONTH,
            monthly_to_daily_divisor=MONTHLY_TO_DAILY_DIVISOR,
            da_revision_note="Revised every 1 April",
        )
        db.add(emp)
        db.flush()
    return emp


def _ensure_da_versions(db: Session, emp, versions) -> None:
    have = {d.effective_from for d in db.query(models.MinimumWageDaVersion).filter_by(employment_id=emp.id)}
    for value, effective_from, valid_to, verified, source in versions:
        if effective_from not in have:
            db.add(
                models.MinimumWageDaVersion(
                    employment_id=emp.id, da_value=value, effective_from=effective_from,
                    valid_to=valid_to, verified=verified, source=source,
                )
            )


def _ensure_classes(db: Session, emp, classes) -> None:
    """classes: (sl_no, group, name, rate_type, unit, basic, note). Adds only what is missing;
    fills group/unit on rows an earlier release created without them."""
    existing = {c.name: c for c in db.query(models.MinimumWageClass).filter_by(employment_id=emp.id)}
    for sl_no, group, name, rate_type, unit, basic, note in classes:
        cls = existing.get(name)
        if cls is None:
            cls = models.MinimumWageClass(
                employment_id=emp.id, sl_no=sl_no, name=name, rate_type=rate_type, group_name=group, unit=unit
            )
            db.add(cls)
            db.flush()
            db.add(
                models.MinimumWageBasicVersion(
                    class_id=cls.id, basic=basic, effective_from=data.BASIC_SINCE, source=note or "Original GO"
                )
            )
        else:
            if cls.unit is None:
                cls.unit = unit
            if cls.group_name is None:
                cls.group_name = group


def seed_reference_data(db: Session) -> None:
    """Idempotent: inserts the scheduled employments, their classes and the initial
    Basic/DA versions only where missing. Never edits existing rates. Used by tests and
    local dev; the Alembic migrations seed production."""
    rice = _ensure_employment(db, TN_RICE_FLOUR_DHALL, "Rice Mills, Flour Mills or Dhall Mills")
    _ensure_da_versions(db, rice, data.RICE_DA_VERSIONS)
    _ensure_classes(
        db, rice, [(sl, None, name, rt, "month" if rt == "monthly" else "day", basic, None)
                   for sl, name, rt, basic in TN_RICE_FLOUR_DHALL_CLASSES],
    )
    brick = _ensure_employment(db, BRICK_TILES, data.EMPLOYMENT_NAMES[BRICK_TILES])
    _ensure_da_versions(db, brick, data.BRICK_DA_VERSIONS)
    _ensure_classes(db, brick, data.BRICK_CLASSES)
    db.commit()


# Industry choices at signup / in Factory Profile that map to a scheduled employment
INDUSTRY_TO_EMPLOYMENT = {"rice_mill": TN_RICE_FLOUR_DHALL, "brick_tiles": BRICK_TILES}


def minimum_for(rate_type: str, basic: float, da_daily: float, da_days_per_month: int = DA_DAYS_PER_MONTH) -> float:
    """daily class: Basic + DA; monthly class: Basic + DA x 30."""
    if rate_type == "piece":
        raise ValueError("a piece rate has no automatic minimum")
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
        if cls.rate_type == "piece":
            return None  # published per quantity: no automatic minimum
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
            # past the period the DA was published for, until a revision is added
            "da_stale": da_v.valid_to is not None and as_of > da_v.valid_to,
            "monthly_to_daily_divisor": emp.monthly_to_daily_divisor,
            "group_name": cls.group_name,
        }

    def check(self, class_id: int | None, rate_type: str, basic: float, da: float, as_of: date) -> dict:
        """Compare a proposed salary (Basic + DA, in the worker's own unit)
        with the class minimum on `as_of`. Always returns a dict; `available`
        is False (with a reason) when no comparison can be made."""
        if class_id is None:
            return {"available": False, "reason": "No minimum-wage class selected"}
        cls = self.classes.get(class_id)
        if cls is not None and cls.rate_type == "piece":
            return {
                "available": False,
                "piece_rate": True,
                "class_name": cls.name,
                "unit": cls.unit,
                "reason": f"Piece-rate work (per {cls.unit}): the minimum is not checked automatically",
            }
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


def type_defaults(resolver: "MinimumWageResolver", worker_type, as_of: date) -> dict:
    """What picking this worker type fills in. For a type created from a minimum-wage
    class this follows the class's CURRENT Basic + DA (so a DA revision updates it);
    otherwise it is the type's own stored default rate."""
    if worker_type.min_wage_class_id is not None:
        cls = resolver.classes.get(worker_type.min_wage_class_id)
        if cls is not None and cls.rate_type == "piece":
            return {"rate_type": "daily", "basic": 0.0, "da": 0.0, "rate": 0.0, "piece_rate": True, "unit": cls.unit}
        m = resolver.minimum_as_of(worker_type.min_wage_class_id, as_of)
        if m is not None:
            da = m["da"] * (resolver.employments[cls.employment_id].da_days_per_month if m["rate_type"] == "monthly" else 1)
            return {
                "rate_type": m["rate_type"], "basic": m["basic"], "da": round(da, 2),
                "rate": m["minimum"], "piece_rate": False, "unit": cls.unit,
            }
    return {
        "rate_type": worker_type.default_rate_type, "basic": worker_type.default_rate, "da": 0.0,
        "rate": worker_type.default_rate, "piece_rate": False, "unit": None,
    }


def ensure_worker_types(db: Session, owner_id: int, employment_id: int) -> int:
    """Creates one worker type per class of the factory's scheduled employment (idempotent:
    a class that already has a type for this owner is skipped; a same-named type the owner
    made by hand is linked to the class instead of duplicated). Returns how many were created.
    Does not commit."""
    resolver = MinimumWageResolver(db)
    today = date.today()
    have = {t.min_wage_class_id: t for t in db.query(models.WorkerType).filter(
        models.WorkerType.owner_id == owner_id, models.WorkerType.min_wage_class_id.isnot(None))}
    by_name = {t.name: t for t in db.query(models.WorkerType).filter(models.WorkerType.owner_id == owner_id)}
    created = 0
    for cls in sorted((c for c in resolver.classes.values() if c.employment_id == employment_id), key=lambda c: c.sl_no):
        if cls.id in have:
            continue
        m = resolver.minimum_as_of(cls.id, today)
        rate = m["minimum"] if m else 0.0
        rate_type = cls.rate_type if cls.rate_type in ("daily", "monthly") else "daily"
        same_name = by_name.get(cls.name)
        if same_name is not None:
            if same_name.min_wage_class_id is None:
                same_name.min_wage_class_id = cls.id
            continue
        wt = models.WorkerType(
            owner_id=owner_id, name=cls.name, default_rate_type=rate_type, default_rate=rate, min_wage_class_id=cls.id
        )
        db.add(wt)
        by_name[cls.name] = wt
        created += 1
    return created
