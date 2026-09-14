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

from sqlalchemy.orm import load_only, sessionmaker

from database import Base, engine
import biometric_api
import models

Base.metadata.create_all(bind=engine)
# expire_on_commit=False (unlike the app's normal SessionLocal) --
# otherwise every commit() below expires ALL objects the session is
# tracking, not just the one just committed, so the NEXT worker in the
# same owner's `missing` list would need a lazy reload on its next
# attribute access. That reload ignores load_only() and fetches the
# full row instead, defeating the whole point of restricting columns
# to avoid needing the real ENCRYPTION_KEY.
db = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)()

# load_only restricts which columns actually get selected (and, for
# Worker, decrypted -- EncryptedString runs on every loaded column
# regardless of whether the script touches it). This backfill only
# ever reads/writes numeric_employee_code, so there's no reason to
# touch aadhaar_encrypted/current_address/etc. at all, or need the
# real ENCRYPTION_KEY just to run it.
WORKER_COLUMNS = (
    models.Worker.id,
    models.Worker.owner_id,
    models.Worker.name,
    models.Worker.numeric_employee_code,
    models.Worker.created_at,
)

try:
    owners = db.query(models.Owner).all()
    backfilled = 0
    for owner in owners:
        missing = (
            db.query(models.Worker)
            .options(load_only(*WORKER_COLUMNS))
            .filter(models.Worker.owner_id == owner.id, models.Worker.numeric_employee_code.is_(None))
            .order_by(models.Worker.created_at)
            .all()
        )
        if not missing:
            continue
        for worker in missing:
            biometric_api.assign_employee_code_if_missing(worker, owner.id, db)
            # Captured before commit -- session.commit() expires every
            # attribute by default, and touching worker.* afterward
            # would trigger a full reload (hitting the same encrypted
            # columns this was written to avoid).
            code = worker.numeric_employee_code
            worker_id, worker_name = worker.id, worker.name
            db.commit()
            print(f"owner {owner.id} ({owner.factory_name}): worker {worker_id} ({worker_name}) -> #{code}")
            backfilled += 1

    print(f"\n=== BACKFILL DONE: {backfilled} worker(s) assigned a code ===")
finally:
    db.close()
