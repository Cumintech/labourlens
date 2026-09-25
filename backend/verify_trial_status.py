"""Verifies the informational (never-gating) trial status now returned
on /owners/me and friends: a brand-new signup shows "trial" with the
full TRIAL_DAYS remaining, elapsed time correctly counts down, it
never goes negative, and switching the Factory's status in the admin
portal (e.g. to "active") is reflected back to the owner with
trial_days_remaining cleared.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_trial_status.py
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, SessionLocal, engine
import models
from admin_auth import hash_password
from main import TRIAL_DAYS, app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

# --- Brand-new signup: trial, full days remaining ---
signup = client.post(
    "/owners/signup",
    json={"name": "Trial Owner", "mobile": "9000001501", "password": "pass12345", "factory_name": "Trial Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
owner_body = signup.json()["owner"]
assert owner_body["plan_status"] == "trial", owner_body
assert owner_body["trial_days_remaining"] == TRIAL_DAYS, owner_body
token = signup.json()["access_token"]
owner_id = owner_body["id"]
print(f"New signup: plan_status='trial', trial_days_remaining={TRIAL_DAYS}: PASSED")

# --- /owners/me reflects the same thing ---
me = client.get("/owners/me", headers={"Authorization": f"Bearer {token}"})
assert me.status_code == 200
assert me.json()["plan_status"] == "trial" and me.json()["trial_days_remaining"] == TRIAL_DAYS
print("GET /owners/me matches signup response: PASSED")

# --- Backdate the Factory's enrolled_at to simulate elapsed trial time
# -- 1 day in, TRIAL_DAYS - 1 remaining ---
db = SessionLocal()
factory = db.query(models.Factory).filter(models.Factory.owner_id == owner_id).first()
factory.enrolled_at = datetime.now(timezone.utc) - timedelta(days=1)
db.commit()
db.close()

me_day1 = client.get("/owners/me", headers={"Authorization": f"Bearer {token}"})
assert me_day1.json()["trial_days_remaining"] == TRIAL_DAYS - 1, me_day1.json()
print(f"1 day elapsed: trial_days_remaining={TRIAL_DAYS - 1}: PASSED")

# --- Backdate well past the trial window -- must clamp at 0, never go negative ---
db = SessionLocal()
factory = db.query(models.Factory).filter(models.Factory.owner_id == owner_id).first()
factory.enrolled_at = datetime.now(timezone.utc) - timedelta(days=TRIAL_DAYS + 10)
db.commit()
db.close()

me_expired = client.get("/owners/me", headers={"Authorization": f"Bearer {token}"})
assert me_expired.json()["plan_status"] == "trial", me_expired.json()  # still "trial" -- no auto-gate, no auto-status-flip
assert me_expired.json()["trial_days_remaining"] == 0, me_expired.json()
print("Trial well past its window: clamps to 0, never negative, status stays 'trial' (no auto-gate): PASSED")

# --- Confirm nothing here actually blocks real app usage once "expired" ---
worker = client.post(
    "/workers", headers={"Authorization": f"Bearer {token}"}, json={"name": "Post-Trial Worker", "aadhaar_number": "888899990000"}
)
assert worker.status_code == 201, worker.text
print("Creating a worker still works after the trial window has passed -- informational only, not a gate: PASSED")

# --- Admin marks the factory active -- trial_days_remaining clears ---
admin_db = SessionLocal()
admin_user = models.AdminUser(email="trial-check@example.com", password_hash=hash_password("a real strong password 123"))
admin_db.add(admin_user)
admin_db.commit()
admin_db.close()

admin_login = client.post("/admin/login", json={"email": "trial-check@example.com", "password": "a real strong password 123"})
admin_headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

factories = client.get("/admin/factories", headers=admin_headers).json()
factory_id = next(f["id"] for f in factories if f["owner_id"] == owner_id)
update = client.patch(f"/admin/factories/{factory_id}", headers=admin_headers, json={"status": "active"})
assert update.status_code == 200, update.text

me_active = client.get("/owners/me", headers={"Authorization": f"Bearer {token}"})
assert me_active.json()["plan_status"] == "active", me_active.json()
assert me_active.json()["trial_days_remaining"] is None, me_active.json()
print("After admin marks the factory 'active': owner sees plan_status='active', trial_days_remaining=None: PASSED")

print("\nALL ASSERTIONS PASSED")
