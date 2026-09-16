"""Regression test for Apple Guideline 5.1.1(v): an app that supports
in-app account creation must also support in-app account deletion.
Confirms DELETE /owners/me permanently blocks login with the old
credentials AND with an already-issued token, while leaving the
owner's workers intact (the Tamil Nadu Factories Act requires those
statutory registers to be retained regardless of the login's fate).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_account_deletion.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

MOBILE = "9000001801"
PASSWORD = "pass123"

signup = client.post(
    "/owners/signup",
    json={"name": "Deletion Owner", "mobile": MOBILE, "password": PASSWORD, "factory_name": "Deletion Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

worker = client.post("/workers", headers=headers, json={"name": "Kept Worker", "aadhaar_number": "555588889999"}).json()
assert worker["id"], worker

still_logged_in = client.get("/owners/me", headers=headers)
assert still_logged_in.status_code == 200, still_logged_in.text
print("Before deletion: GET /owners/me works with the current token: PASSED")

delete_resp = client.delete("/owners/me", headers=headers)
assert delete_resp.status_code == 204, delete_resp.text
print("DELETE /owners/me returns 204: PASSED")

# The old password must never work again.
relogin = client.post("/owners/login", json={"mobile": MOBILE, "password": PASSWORD})
assert relogin.status_code == 401, relogin.text
print("After deletion: login with the old password now fails: PASSED")

# The token issued before deletion must also stop working immediately --
# an unexpired JWT alone shouldn't be enough to keep using a deleted account.
reused_token = client.get("/owners/me", headers=headers)
assert reused_token.status_code == 401, reused_token.text
print("After deletion: the pre-deletion token is rejected: PASSED")

# Once deleted, get_current_owner rejects every token for this owner
# (already proven above) -- so there is no valid credential left that
# could ever reach DELETE /owners/me again. The endpoint's own internal
# idempotency guard (skip re-setting deleted_at if already set) only
# matters for a race between two concurrent requests on the same
# not-yet-expired token, which isn't reproducible as a simple sequential
# HTTP test -- covered by code review instead.

# The worker record itself -- a statutory register entry -- must survive.
# Reach it directly via the DB session rather than the API, since every
# API route now correctly refuses this owner's token.
from database import SessionLocal
import models

db = SessionLocal()
try:
    kept_worker = db.get(models.Worker, worker["id"])
    assert kept_worker is not None, "worker row was deleted, but only the login should be"
    assert kept_worker.owner_id is not None
    owner_row = db.get(models.Owner, kept_worker.owner_id)
    assert owner_row.deleted_at is not None
    assert owner_row.mobile == MOBILE  # row kept, not scrubbed -- only login is blocked
    print("Worker row and Owner row both survive deletion, with deleted_at stamped: PASSED")
finally:
    db.close()

print("\nALL ASSERTIONS PASSED")
