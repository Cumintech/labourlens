"""Verifies Day 3's Portal Sync Worker end to end against the REAL Test
Portal (test-portal/main.py must be running on 127.0.0.1:8020) -- real
Playwright browser automation, not a mocked HTTP client. Covers: create
sync (registration -> Portal entry appears), deactivate sync (Portal
entry flips to inactive), Aadhaar-based matching, and a genuine failure
path (wrong credentials -> sync_status stays failed with a real error,
not silently swallowed).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_sync_worker.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import requests
from fastapi.testclient import TestClient
from database import Base, SessionLocal, engine
import models
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

PORTAL_URL = "http://127.0.0.1:8020"
assert requests.get(f"{PORTAL_URL}/login").status_code == 200, (
    "Test Portal isn't reachable on 127.0.0.1:8020 -- start it first: "
    "cd test-portal && python -m uvicorn main:app --port 8020"
)

# --- Owner + Portal credentials ---
signup = client.post(
    "/owners/signup",
    json={"name": "Sync Test Owner", "mobile": "9000000099", "password": "pass123", "factory_name": "Sync Test Factory"},
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

cred_resp = client.post(
    "/portal-credentials",
    headers=headers,
    json={"portal_username": "portaladmin", "portal_password": "portalpass123"},
)
assert cred_resp.status_code == 204, cred_resp.text
print("portal credentials set")

# --- Register a worker (writes a pending sync_status row, doesn't sync yet) ---
worker_resp = client.post(
    "/workers",
    headers=headers,
    json={"name": "Sync Test Worker", "aadhaar_number": "111122223333"},
)
assert worker_resp.status_code == 201, worker_resp.text
worker_id = worker_resp.json()["id"]

status_before = client.get("/sync-status", headers=headers).json()
assert len(status_before) == 1 and status_before[0]["state"] == "pending", status_before
print("sync_status is pending before sync runs:", status_before[0])

# --- Run sync -- real Playwright automation against the real Test Portal ---
run_resp = client.post("/sync/run", headers=headers)
assert run_resp.status_code == 202, run_resp.text

status_after = client.get("/sync-status", headers=headers).json()
create_row = status_after[0]
print("sync_status after create sync:", create_row)
assert create_row["state"] == "synced", f"create sync failed: {create_row.get('last_error')}"

# --- Confirm the worker actually exists on the real Test Portal now ---
portal_search = requests.get(f"{PORTAL_URL}/workers/search?aadhaar=111122223333")
# Not logged in via requests session -- expect 401, confirming the search
# endpoint itself requires auth (a real check, not just trusting it works)
assert portal_search.status_code == 401, "search endpoint should require login"
print("search endpoint correctly requires login (401 without a session): PASSED")

# Use a real logged-in session to actually verify the Portal-side entry
portal_session = requests.Session()
login_resp = portal_session.post(f"{PORTAL_URL}/login", data={"username": "portaladmin", "password": "portalpass123"})
assert login_resp.status_code == 200
portal_check = portal_session.get(f"{PORTAL_URL}/workers/search?aadhaar=111122223333").json()
assert len(portal_check["matches"]) == 1, f"worker not found on Portal after sync: {portal_check}"
assert portal_check["matches"][0]["status"] == "active"
print("worker confirmed present and active on the real Test Portal: PASSED")

# --- Deactivate, sync again, confirm Portal reflects it ---
deactivate_resp = client.patch(f"/workers/{worker_id}/deactivate", headers=headers)
assert deactivate_resp.status_code == 200, deactivate_resp.text

run_resp2 = client.post("/sync/run", headers=headers)
assert run_resp2.status_code == 202, run_resp2.text

status_final = client.get("/sync-status", headers=headers).json()
deactivate_row = next(r for r in status_final if r["action"] == "deactivate")
print("sync_status after deactivate sync:", deactivate_row)
assert deactivate_row["state"] == "synced", f"deactivate sync failed: {deactivate_row.get('last_error')}"

portal_check2 = portal_session.get(f"{PORTAL_URL}/workers/search?aadhaar=111122223333").json()
assert portal_check2["matches"][0]["status"] == "inactive", f"Portal still shows active: {portal_check2}"
print("worker confirmed inactive on the real Test Portal after deactivate sync: PASSED")

# --- Genuine failure path: wrong Portal credentials ---
signup2 = client.post(
    "/owners/signup",
    json={"name": "Bad Cred Owner", "mobile": "9000000098", "password": "pass123", "factory_name": "Bad Cred Factory"},
)
token2 = signup2.json()["access_token"]
headers2 = {"Authorization": f"Bearer {token2}"}
client.post("/portal-credentials", headers=headers2, json={"portal_username": "portaladmin", "portal_password": "wrongpassword"})
client.post("/workers", headers=headers2, json={"name": "Should Fail", "aadhaar_number": "444455556666"})
client.post("/sync/run", headers=headers2)
fail_status = client.get("/sync-status", headers=headers2).json()
print("sync_status with wrong credentials:", fail_status[0])
assert fail_status[0]["state"] == "failed", "wrong credentials should have failed, not synced"
assert fail_status[0]["last_error"], "a failure should record a real error message, not be silent"
print("wrong-credentials failure path confirmed (not silently swallowed): PASSED")

print("\nALL ASSERTIONS PASSED")
