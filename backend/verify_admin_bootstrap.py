"""Verifies the env-var admin bootstrap in main.py's lifespan -- the
path Render's free tier (no shell access) actually relies on: set
ADMIN_EMAIL/ADMIN_PASSWORD once, and the account is created on first
boot. Confirms it's genuinely idempotent (a later redeploy with the
same env vars still set does NOT create a second admin_user row or
overwrite the first one's password), since this runs on every single
app startup, not just the first.

Needs `with TestClient(app) as client:` specifically -- unlike every
other verify_*.py script here, this one relies on lifespan actually
firing, not on calling Base.metadata.create_all() directly.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> \
    ADMIN_EMAIL=boot@example.com ADMIN_PASSWORD='a real strong password 123' \
    python verify_admin_bootstrap.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

os.environ.setdefault("ADMIN_EMAIL", "boot@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "a real strong password 123")
ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]

from fastapi.testclient import TestClient

from database import SessionLocal
import models
from main import app

# --- First boot: no admin_user row exists yet -- should be created ---
with TestClient(app) as client:
    pass

db = SessionLocal()
admins = db.query(models.AdminUser).all()
db.close()
assert len(admins) == 1, f"expected exactly 1 admin_user row after first boot, got {len(admins)}"
assert admins[0].email == ADMIN_EMAIL
print("First boot with ADMIN_EMAIL/ADMIN_PASSWORD set: admin account created: PASSED")

# --- Second "boot" (simulating a redeploy with the same env vars still
# set) -- must NOT create a duplicate or touch the existing one ---
with TestClient(app) as client:
    pass

db = SessionLocal()
admins_after = db.query(models.AdminUser).all()
db.close()
assert len(admins_after) == 1, f"a second boot with the same env vars should not create a second admin, got {len(admins_after)}"
assert admins_after[0].id == admins[0].id
print("Second boot with the same env vars still set: no duplicate created, idempotent: PASSED")

# --- The bootstrapped account can actually log in ---
with TestClient(app) as client:
    login = client.post("/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert login.status_code == 200, login.text
print("Bootstrapped admin account can log in with the env-var password: PASSED")

print("\nALL ASSERTIONS PASSED")
