"""Verifies Phase 3 Day 1's ShiftConfig work: the seed migration for
pre-existing owners, that new signups get default shifts automatically,
that attendance marking is validated against the owner's own shifts (not
a hardcoded AM/PM/Evening tuple), that deleting a shift with attendance
history is blocked, and cross-owner scoping throughout.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_shift_config.py
"""

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, SessionLocal, engine
import models
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

# --- New signup gets default shifts automatically ---
signup = client.post(
    "/owners/signup",
    json={"name": "Shift Owner A", "mobile": "9000000201", "password": "pass123", "factory_name": "Shift Factory A"},
)
assert signup.status_code == 201, signup.text
token_a = signup.json()["access_token"]
headers_a = {"Authorization": f"Bearer {token_a}"}

shifts = client.get("/shift-configs", headers=headers_a).json()
assert [s["slot_key"] for s in shifts] == ["AM", "PM", "Evening"], shifts
print("new signup gets 3 default shifts automatically: PASSED")

# --- Migration script backfills a pre-existing owner with zero shifts ---
db = SessionLocal()
legacy_owner = models.Owner(
    name="Legacy Owner", mobile="9000000202", password_hash="x", factory_name="Legacy Factory"
)
db.add(legacy_owner)
db.commit()
db.refresh(legacy_owner)
legacy_owner_id = legacy_owner.id
db.close()

assert (
    SessionLocal().query(models.ShiftConfig).filter(models.ShiftConfig.owner_id == legacy_owner_id).count() == 0
)
result = subprocess.run(
    [sys.executable, "migrate_seed_shift_config.py"],
    cwd=str(Path(__file__).parent),
    env=os.environ,
    capture_output=True,
    text=True,
)
assert result.returncode == 0, f"migration script failed:\n{result.stdout}\n{result.stderr}"
assert "confirmed: every owner has at least 3 shift configs" in result.stdout, result.stdout
db2 = SessionLocal()
legacy_shifts = db2.query(models.ShiftConfig).filter(models.ShiftConfig.owner_id == legacy_owner_id).all()
assert len(legacy_shifts) == 3, legacy_shifts
assert {s.slot_key for s in legacy_shifts} == {"AM", "PM", "Evening"}
db2.close()
print("migration script backfills a pre-existing owner with exactly 3 shifts: PASSED")

# Running it again must not duplicate rows for either owner.
result2 = subprocess.run(
    [sys.executable, "migrate_seed_shift_config.py"],
    cwd=str(Path(__file__).parent),
    env=os.environ,
    capture_output=True,
    text=True,
)
assert result2.returncode == 0, result2.stdout
db3 = SessionLocal()
assert (
    db3.query(models.ShiftConfig).filter(models.ShiftConfig.owner_id == legacy_owner_id).count() == 3
), "migration duplicated rows on a second run"
db3.close()
print("migration script is idempotent on a second run: PASSED")

# --- Attendance marking validated against the owner's own shifts ---
worker = client.post(
    "/workers", headers=headers_a, json={"name": "Shift Worker", "aadhaar_number": "111122223333"}
).json()

mark_default = client.post(
    "/attendance",
    headers=headers_a,
    json={"worker_id": worker["id"], "date": "2026-09-01", "slot": "AM", "status": "present"},
)
assert mark_default.status_code == 200, mark_default.text
print("marking attendance against a default shift slot: PASSED")

bad_slot = client.post(
    "/attendance",
    headers=headers_a,
    json={"worker_id": worker["id"], "date": "2026-09-01", "slot": "Night", "status": "present"},
)
assert bad_slot.status_code == 422, bad_slot.text
print("marking attendance against a slot the owner doesn't have: rejected with 422: PASSED")

# --- Malformed shift times are rejected, not silently stored (real bug:
# a free-typed "6.00am"/"2pm" pre-dating the mobile app's time picker
# crashed form generation for every worker on that owner's account,
# since it can't be parsed as 24-hour HH:MM) ---
for bad_time_field, bad_value in (("start_time", "6.00am"), ("end_time", "2pm")):
    bad_shift = client.post(
        "/shift-configs",
        headers=headers_a,
        json={"slot_key": "Bad", "label": "Bad Shift", "start_time": "09:00", "end_time": "17:00", bad_time_field: bad_value},
    )
    assert bad_shift.status_code == 422, f"{bad_time_field}={bad_value!r} should be rejected: {bad_shift.text}"
print("malformed shift times (e.g. '6.00am', '2pm') rejected with 422, not stored: PASSED")

update_to_bad_time = client.put(
    f"/shift-configs/{shifts[0]['id']}", headers=headers_a, json={"slot_key": "AM", "label": "AM", "start_time": "6.00am"}
)
assert update_to_bad_time.status_code == 422, update_to_bad_time.text
print("PUT with a malformed time is also rejected, not just POST: PASSED")

# --- Add a custom shift, mark attendance against it, dashboard reflects it ---
new_shift = client.post(
    "/shift-configs",
    headers=headers_a,
    json={"slot_key": "Night", "label": "Night Shift", "start_time": "22:00", "end_time": "06:00"},
)
assert new_shift.status_code == 201, new_shift.text

mark_night = client.post(
    "/attendance",
    headers=headers_a,
    json={
        "worker_id": worker["id"],
        "date": "2026-09-01",
        "slot": "Night",
        "status": "present",
        "overtime_hours": 1.5,
    },
)
assert mark_night.status_code == 200, mark_night.text
assert mark_night.json()["overtime_hours"] == 1.5, mark_night.json()

dashboard = client.get("/dashboard", headers=headers_a, params={"date": "2026-09-01"}).json()
slot_keys = {s["slot"] for s in dashboard["slots"]}
assert slot_keys == {"AM", "PM", "Evening", "Night"}, dashboard
night_summary = next(s for s in dashboard["slots"] if s["slot"] == "Night")
assert night_summary["present"] == 1, night_summary
print("dashboard summary reflects a customized (4-shift) scheme, not a fixed 3: PASSED")

# --- Deleting a shift with attendance history is blocked ---
delete_in_use = client.delete(f"/shift-configs/{new_shift.json()['id']}", headers=headers_a)
assert delete_in_use.status_code == 409, delete_in_use.text
print("deleting a shift with attendance history: rejected with 409: PASSED")

# --- Deleting an unused shift succeeds ---
unused_shift = client.post(
    "/shift-configs", headers=headers_a, json={"slot_key": "Unused", "label": "Unused Shift"}
).json()
delete_unused = client.delete(f"/shift-configs/{unused_shift['id']}", headers=headers_a)
assert delete_unused.status_code == 204, delete_unused.text
print("deleting a shift with no attendance history: succeeds: PASSED")

# --- Cross-owner scoping ---
signup_b = client.post(
    "/owners/signup",
    json={"name": "Shift Owner B", "mobile": "9000000203", "password": "pass123", "factory_name": "Shift Factory B"},
)
token_b = signup_b.json()["access_token"]
headers_b = {"Authorization": f"Bearer {token_b}"}

shifts_b = client.get("/shift-configs", headers=headers_b).json()
assert len(shifts_b) == 3 and all(s["slot_key"] in ("AM", "PM", "Evening") for s in shifts_b), shifts_b

edit_a_from_b = client.put(
    f"/shift-configs/{new_shift.json()['id']}", headers=headers_b, json={"slot_key": "Night", "label": "Hijacked"}
)
assert edit_a_from_b.status_code == 404, edit_a_from_b.text

delete_a_from_b = client.delete(f"/shift-configs/{new_shift.json()['id']}", headers=headers_b)
assert delete_a_from_b.status_code == 404, delete_a_from_b.text
print("cross-owner scoping on shift configs (owner B can't see/edit/delete owner A's shifts): PASSED")

print("\nALL ASSERTIONS PASSED")
