"""One-off migration: backfill numeric_employee_code for every existing
worker who doesn't have one yet. This is item 17's fix -- worker
creation never set this field at all until now (it was only ever
assigned lazily, via the biometric mapping screen's "generate a direct
employee code" button), so any worker registered before that fix
stays permanently blank otherwise. Uses the exact same per-owner
sequential assignment as normal creation (biometric_api.
assign_employee_code_if_missing), processed owner by owner, oldest
worker first within each owner, so codes come out in registration
order rather than an arbitrary one.

Not a permanent code path -- run once against the real DB, then done.

    DATABASE_URL=sqlite:///./dev.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python migrate_backfill_employee_codes.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from database import Base, SessionLocal, engine
import biometric_api
import models

Base.metadata.create_all(bind=engine)
db = SessionLocal()

try:
    owners = db.query(models.Owner).all()
    backfilled = 0
    for owner in owners:
        missing = (
            db.query(models.Worker)
            .filter(models.Worker.owner_id == owner.id, models.Worker.numeric_employee_code.is_(None))
            .order_by(models.Worker.created_at)
            .all()
        )
        if not missing:
            continue
        for worker in missing:
            biometric_api.assign_employee_code_if_missing(worker, owner.id, db)
            db.commit()
            db.refresh(worker)
            print(f"owner {owner.id} ({owner.factory_name}): worker {worker.id} ({worker.name}) -> #{worker.numeric_employee_code}")
            backfilled += 1

    print(f"\n=== BACKFILL DONE: {backfilled} worker(s) assigned a code ===")
finally:
    db.close()
