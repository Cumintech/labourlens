"""One-off migration: seed a default Morning/Evening ShiftConfig for every
existing Owner with zero shifts, so attendance marking keeps working --
owners who don't care to customize their shifts never notice a change;
owners who do can rename/retime/replace these via the Shift Settings
screen afterward (now fully editable there, not just add/remove).

Not a permanent code path -- run once against the real DB, then done.

    DATABASE_URL=sqlite:///./dev.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python migrate_seed_shift_config.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from database import Base, SessionLocal, engine
import models

DEFAULT_SHIFTS = [
    ("Morning", "Morning", "06:00", "14:00", 0),
    ("Evening", "Evening", "14:00", "22:00", 1),
]

Base.metadata.create_all(bind=engine)
db = SessionLocal()

try:
    owners = db.query(models.Owner).all()
    seeded = 0
    for owner in owners:
        existing_count = (
            db.query(models.ShiftConfig).filter(models.ShiftConfig.owner_id == owner.id).count()
        )
        if existing_count > 0:
            print(f"owner {owner.id} ({owner.factory_name}) already has {existing_count} shifts -- skipped")
            continue
        for slot_key, label, start_time, end_time, sort_order in DEFAULT_SHIFTS:
            db.add(
                models.ShiftConfig(
                    owner_id=owner.id,
                    slot_key=slot_key,
                    label=label,
                    start_time=start_time,
                    end_time=end_time,
                    sort_order=sort_order,
                )
            )
        seeded += 1
    db.commit()
    print(f"seeded default shifts for {seeded} owner(s) (of {len(owners)} total)")

    # Confirm every owner now has at least one shift (2 by default, or
    # more/fewer if they already had a customized set that was skipped above).
    for owner in owners:
        count = db.query(models.ShiftConfig).filter(models.ShiftConfig.owner_id == owner.id).count()
        assert count > 0, f"owner {owner.id} has no shift configs after migration"
    print("confirmed: every owner has at least one shift config")
finally:
    db.close()
