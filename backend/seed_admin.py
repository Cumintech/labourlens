"""One-time provisioning for the single admin_user row -- there is no
signup route for this account by design (see admin.py/admin_auth.py).
Run this once per environment, after ADMIN_EMAIL/ADMIN_PASSWORD are
set (as real environment variables, never committed to a file):

    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a real strong password' python seed_admin.py

Refuses to run if an admin_user row already exists, unless --force is
passed -- this is the one account that can see every factory's data,
so an accidental re-run overwriting it silently would be a real
problem, not just an inconvenience.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from database import Base, SessionLocal, engine
import models
from admin_auth import hash_password

Base.metadata.create_all(bind=engine)

email = os.environ.get("ADMIN_EMAIL")
password = os.environ.get("ADMIN_PASSWORD")
force = "--force" in sys.argv

if not email or not password:
    print("Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables first.", file=sys.stderr)
    sys.exit(1)

if len(password) < 12:
    print("ADMIN_PASSWORD should be a real strong password (12+ characters) -- this account sees every factory's data.", file=sys.stderr)
    sys.exit(1)

db = SessionLocal()
try:
    existing = db.query(models.AdminUser).first()
    if existing and not force:
        print(
            f"An admin_user row already exists ({existing.email}). "
            "Pass --force to replace its email/password, or leave it alone.",
            file=sys.stderr,
        )
        sys.exit(1)

    if existing:
        existing.email = email
        existing.password_hash = hash_password(password)
        db.commit()
        print(f"Updated existing admin account: {email}")
    else:
        db.add(models.AdminUser(email=email, password_hash=hash_password(password)))
        db.commit()
        print(f"Created admin account: {email}")
finally:
    db.close()
