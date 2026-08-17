"""Verifies Day 4's attendance marking + dashboard summary against the
real backend (TestClient over the real FastAPI app + real SQLite DB, not
mocks). Covers: mark present/absent per slot, re-marking upserts instead
of duplicating, owner scoping, dashboard math (present-today = present in
at least one slot, per-slot breakdown, deactivated workers excluded).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_attendance_dashboard.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from datetime import date

from fastapi.testclient import TestClient
from database import Base, engine
import models
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)
TODAY = date(2026, 8, 18)

# --- Owner + 3 workers ---
signup = client.post(
    "/owners/signup",
    json={"name": "Attendance Owner", "mobile": "9000000077", "password": "pass123", "factory_name": "Attendance Factory"},
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

worker_ids = []
for i in range(3):
    r = client.post("/workers", headers=headers, json={"name": f"Worker {i}", "aadhaar_number": f"11112222{i:04d}"})
    assert r.status_code == 201, r.text
    worker_ids.append(r.json()["id"])
w0, w1, w2 = worker_ids

# --- Mark attendance: w0 present AM+PM+Evening, w1 present AM only, w2 absent everywhere ---
for slot in ("AM", "PM", "Evening"):
    r = client.post("/attendance", headers=headers, json={"worker_id": w0, "date": str(TODAY), "slot": slot, "status": "present"})
    assert r.status_code == 200, r.text

r = client.post("/attendance", headers=headers, json={"worker_id": w1, "date": str(TODAY), "slot": "AM", "status": "present"})
assert r.status_code == 200, r.text
for slot in ("PM", "Evening"):
    r = client.post("/attendance", headers=headers, json={"worker_id": w1, "date": str(TODAY), "slot": slot, "status": "absent"})
    assert r.status_code == 200, r.text

for slot in ("AM", "PM", "Evening"):
    r = client.post("/attendance", headers=headers, json={"worker_id": w2, "date": str(TODAY), "slot": slot, "status": "absent"})
    assert r.status_code == 200, r.text

print("marked attendance for 3 workers across 3 slots each: PASSED")

# --- Re-mark w0's AM slot: absent -> should UPDATE, not duplicate ---
r = client.post("/attendance", headers=headers, json={"worker_id": w0, "date": str(TODAY), "slot": "AM", "status": "absent"})
assert r.status_code == 200, r.text
am_records = [a for a in client.get("/attendance", headers=headers, params={"date": str(TODAY)}).json() if a["worker_id"] == w0 and a["slot"] == "AM"]
assert len(am_records) == 1, f"re-marking should update in place, not duplicate: {am_records}"
assert am_records[0]["status"] == "absent"
print("re-marking the same slot upserts (no duplicate row): PASSED")

# --- Bad input rejected ---
r = client.post("/attendance", headers=headers, json={"worker_id": w0, "date": str(TODAY), "slot": "Night", "status": "present"})
assert r.status_code == 422, "invalid slot should be rejected"
r = client.post("/attendance", headers=headers, json={"worker_id": w0, "date": str(TODAY), "slot": "AM", "status": "maybe"})
assert r.status_code == 422, "invalid status should be rejected"
print("invalid slot/status rejected with 422: PASSED")

# --- Owner scoping: a second owner cannot mark a worker they don't own ---
signup2 = client.post(
    "/owners/signup",
    json={"name": "Other Owner", "mobile": "9000000076", "password": "pass123", "factory_name": "Other Factory"},
)
headers2 = {"Authorization": f"Bearer {signup2.json()['access_token']}"}
r = client.post("/attendance", headers=headers2, json={"worker_id": w0, "date": str(TODAY), "slot": "AM", "status": "present"})
assert r.status_code == 404, "another owner should not be able to mark a worker they don't own"
print("cross-owner attendance marking blocked: PASSED")

# --- Deactivate w2, confirm dashboard excludes them from totals ---
r = client.patch(f"/workers/{w2}/deactivate", headers=headers)
assert r.status_code == 200, r.text

dashboard = client.get("/dashboard", headers=headers, params={"date": str(TODAY)}).json()
print("dashboard:", dashboard)
# w0: re-marked AM->absent, so present in PM+Evening only, but still
# counts once toward present_today (present in >=1 slot).
# w1: present AM only. w2: deactivated, excluded entirely.
assert dashboard["total_workers"] == 2, f"deactivated worker should not count toward total: {dashboard}"
assert dashboard["present_today"] == 2, f"w0 and w1 both present in >=1 slot: {dashboard}"
slots_by_name = {s["slot"]: s for s in dashboard["slots"]}
assert slots_by_name["AM"]["present"] == 1, f"only w1 present in AM now: {slots_by_name}"  # w0 was flipped to absent
assert slots_by_name["PM"]["present"] == 1, f"only w0 present in PM: {slots_by_name}"
assert slots_by_name["Evening"]["present"] == 1, f"only w0 present in Evening: {slots_by_name}"
assert slots_by_name["AM"]["total"] == 2 and slots_by_name["PM"]["total"] == 2
print("dashboard summary math (present-today, per-slot, deactivated excluded): PASSED")

print("\nALL ASSERTIONS PASSED")
