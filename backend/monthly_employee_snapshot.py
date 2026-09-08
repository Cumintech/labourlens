"""Monthly scheduled job (see README.md's Admin Portal section for how
this is actually scheduled -- a Render Cron Job hitting this script
once a month) -- counts each factory's currently-active workers and
records one FactoryEmployeeSnapshot row per factory per month. This is
what the admin portal's employee-trend chart reads from, deliberately
not a live join over Worker every time a factory's page loads: a
historical month must keep showing what was true that month even after
workers are later deactivated.

Idempotent -- safe to re-run for the same month (e.g. after a fix, or
a manual backfill run for testing): upserts on the (factory_id, month)
unique constraint rather than erroring on a duplicate.

    DATABASE_URL=... python monthly_employee_snapshot.py [YYYY-MM]

With no argument, snapshots the current month. An explicit YYYY-MM
argument lets you backfill a past month (used by
verify_admin_portal.py to build a multi-month trend for testing).
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import func

from database import Base, SessionLocal, engine
import models

Base.metadata.create_all(bind=engine)


def snapshot_month(db, month_label: str) -> int:
    factories = db.query(models.Factory).all()
    count = 0
    for factory in factories:
        active_count = (
            db.query(func.count(models.Worker.id))
            .filter(models.Worker.owner_id == factory.owner_id, models.Worker.status == "active")
            .scalar()
            or 0
        )
        existing = (
            db.query(models.FactoryEmployeeSnapshot)
            .filter(
                models.FactoryEmployeeSnapshot.factory_id == factory.id,
                models.FactoryEmployeeSnapshot.month == month_label,
            )
            .first()
        )
        if existing:
            existing.active_employee_count = active_count
        else:
            db.add(
                models.FactoryEmployeeSnapshot(
                    factory_id=factory.id, month=month_label, active_employee_count=active_count
                )
            )
        count += 1
    db.commit()
    return count


if __name__ == "__main__":
    if len(sys.argv) > 1:
        month_label = sys.argv[1]
    else:
        today = datetime.now(timezone.utc)
        month_label = f"{today.year:04d}-{today.month:02d}"

    db = SessionLocal()
    try:
        n = snapshot_month(db, month_label)
        print(f"Snapshotted {n} factories for {month_label}")
    finally:
        db.close()
