"""One-off backfill: assigns employment classification (employment_type/
is_ism/home_state) to a Salem factory's existing workers who don't have
it set yet, as seed/demo data -- not a permanent code path.

Finds the owner by factory_name/factory_address/state containing "salem"
(case-insensitive). If that doesn't resolve to exactly one owner, prints
every match and exits without changing anything -- pass --owner-id to
pick one explicitly instead of relying on the name search.

For that owner's workers with employment_type IS NULL, splits by
worker.id % 3:
    0 -> permanent, is_ism=False, home_state=owner.state
    1 -> temporary (Contractor), is_ism=False, home_state=owner.state
    2 -> temporary (ISM), is_ism=True, home_state cycling through
         Bihar / Odisha / Uttar Pradesh / West Bengal

Dry-run by default -- prints the counts per group and the first few
examples, writes nothing. Pass --apply to actually commit the changes.

    DATABASE_URL=... JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python scripts/backfill_employment.py
    DATABASE_URL=... JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python scripts/backfill_employment.py --apply
    DATABASE_URL=... JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python scripts/backfill_employment.py --owner-id 7 --apply
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import load_only, sessionmaker

from database import Base, engine
import models

ISM_HOME_STATES = ["Bihar", "Odisha", "Uttar Pradesh", "West Bengal"]

# Only the columns this script actually reads/writes -- Worker has
# several EncryptedString columns (aadhaar_encrypted, addresses, bank
# details) that decrypt on every load regardless of use; restricting
# the select avoids needing the real ENCRYPTION_KEY to run this,
# matching migrate_backfill_employee_codes.py's existing pattern.
WORKER_COLUMNS = (
    models.Worker.id,
    models.Worker.owner_id,
    models.Worker.name,
    models.Worker.employment_type,
    models.Worker.is_ism,
    models.Worker.home_state,
)


def find_salem_owner(db, owner_id: int | None):
    if owner_id is not None:
        owner = db.get(models.Owner, owner_id)
        if not owner:
            print(f"No owner with id={owner_id}")
            sys.exit(1)
        return owner

    needle = "salem"
    candidates = [
        o
        for o in db.query(models.Owner).all()
        if needle in (o.factory_name or "").lower()
        or needle in (o.factory_address or "").lower()
        or needle in (o.state or "").lower()
    ]
    if len(candidates) != 1:
        print(f"Expected exactly 1 owner matching 'salem', found {len(candidates)}:")
        for o in candidates:
            print(f"  id={o.id} factory_name={o.factory_name!r} factory_address={o.factory_address!r} state={o.state!r}")
        print("\nRe-run with --owner-id <id> to pick one explicitly.")
        sys.exit(1)
    return candidates[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write changes (default: dry-run)")
    parser.add_argument("--owner-id", type=int, default=None, help="Skip the 'salem' name search, use this owner id")
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)()

    try:
        owner = find_salem_owner(db, args.owner_id)
        print(f"Owner: id={owner.id} factory_name={owner.factory_name!r} state={owner.state!r}\n")

        workers = (
            db.query(models.Worker)
            .options(load_only(*WORKER_COLUMNS))
            .filter(models.Worker.owner_id == owner.id, models.Worker.employment_type.is_(None))
            .order_by(models.Worker.id)
            .all()
        )

        counts = {"permanent": 0, "contractor": 0, "ism": 0}
        ism_cycle_index = 0
        plan: list[tuple[models.Worker, str, bool, str | None]] = []

        for worker in workers:
            bucket = worker.id % 3
            if bucket == 0:
                counts["permanent"] += 1
                plan.append((worker, "permanent", False, owner.state))
            elif bucket == 1:
                counts["contractor"] += 1
                plan.append((worker, "temporary", False, owner.state))
            else:
                home_state = ISM_HOME_STATES[ism_cycle_index % len(ISM_HOME_STATES)]
                ism_cycle_index += 1
                counts["ism"] += 1
                plan.append((worker, "temporary", True, home_state))

        print(f"Workers with employment_type unset: {len(workers)}")
        print(f"  permanent (id%3==0):            {counts['permanent']}")
        print(f"  temporary, Contractor (id%3==1): {counts['contractor']}")
        print(f"  temporary, ISM (id%3==2):        {counts['ism']}")

        if not args.apply:
            print("\nDry-run only -- no changes written. Examples (first 5):")
            for worker, employment_type, is_ism, home_state in plan[:5]:
                print(f"  worker {worker.id} ({worker.name}) -> employment_type={employment_type} is_ism={is_ism} home_state={home_state!r}")
            print(f"\nRe-run with --apply --owner-id {owner.id} to write these changes.")
            return

        for worker, employment_type, is_ism, home_state in plan:
            worker.employment_type = employment_type
            worker.is_ism = is_ism
            worker.home_state = home_state
            db.commit()

        print(f"\n=== APPLIED: {len(plan)} worker(s) updated ===")
    finally:
        db.close()


if __name__ == "__main__":
    main()
