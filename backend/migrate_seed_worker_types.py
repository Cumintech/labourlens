"""One-off migration: seed the same 3 default Worker Types (Plumber,
Electrician, Helper) that new signups get automatically, for every
existing Owner who currently has zero worker types -- mirrors
migrate_seed_shift_config.py's exact pattern. Owners who already have at
least one type (including ones they've since deleted down from a set
that once included these) are skipped, so this never fights a
deliberate delete.

Not a permanent code path -- run once against the real DB, then done.

    DATABASE_URL=sqlite:///./dev.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python migrate_seed_worker_types.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from database import Base, SessionLocal, engine
import models

DEFAULT_TYPES = [
    ("Plumber", "daily", 1000),
    ("Electrician", "daily", 1000),
    ("Helper", "daily", 500),
]

Base.metadata.create_all(bind=engine)
db = SessionLocal()

try:
    owners = db.query(models.Owner).all()
    seeded = 0
    for owner in owners:
        existing_count = db.query(models.WorkerType).filter(models.WorkerType.owner_id == owner.id).count()
        if existing_count > 0:
            print(f"owner {owner.id} ({owner.factory_name}) already has {existing_count} worker type(s) -- skipped")
            continue
        for name, rate_type, default_rate in DEFAULT_TYPES:
            db.add(
                models.WorkerType(owner_id=owner.id, name=name, default_rate_type=rate_type, default_rate=default_rate)
            )
        seeded += 1
    db.commit()
    print(f"seeded default worker types for {seeded} owner(s) (of {len(owners)} total)")
finally:
    db.close()
