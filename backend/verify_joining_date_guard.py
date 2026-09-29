"""Verifies a worker's date_of_joining blocks attendance/leave before it,
across all three write paths that can create an Attendance row: manual
marking (POST /attendance), leave (POST /workers/{id}/leave), and the
biometric sync job (attendance_service.upsert_attendance via
biometric_sync.derive_attendance_for_punches). A worker with no
date_of_joining recorded is unrestricted -- this only ever tightens
once a real joining date is on file.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_joining_date_guard.py
"""

import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from database import Base, SessionLocal, engine
import models
from main import app
from biometric_sync import derive_attendance_for_punches
from verhoeff import validate_verhoeff

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _valid_aadhaar(prefix11: str) -> str:
    for last in range(10):
        cand = prefix11 + str(last)
        if validate_verhoeff(cand):
            return cand
    raise AssertionError("no valid checksum found")


signup = client.post(
    "/owners/signup",
    json={"name": "Joining Guard Owner", "mobile": "9000005101", "password": "pass12345", "factory_name": "Joining Guard Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# A real shift with real times -- the default-seeded shift has no
# start_time/end_time, which _slot_for_time can't use.
am_shift = client.get("/shift-configs", headers=headers).json()[0]
client.put(f"/shift-configs/{am_shift['id']}", headers=headers, json={"slot_key": "AM", "label": "AM", "start_time": "08:00", "end_time": "17:00"})

worker_resp = client.post(
    "/workers", headers=headers,
    json={"name": "Joining Guard Worker", "aadhaar_number": _valid_aadhaar("20000000201"), "dob": "2000-01-01"},
)
assert worker_resp.status_code == 201, worker_resp.text
worker_id = worker_resp.json()["id"]

joining_date = "2026-06-01"
compliance_resp = client.post(f"/workers/{worker_id}/compliance", headers=headers, json={"date_of_joining": joining_date})
assert compliance_resp.status_code == 201, compliance_resp.text

before_joining = "2026-05-15"
on_joining = joining_date
after_joining = "2026-06-10"

# --- 1. Manual marking (POST /attendance) ---
r = client.post("/attendance", headers=headers, json={"worker_id": worker_id, "date": before_joining, "slot": "AM", "status": "present"})
assert r.status_code == 422 and "date of entry into service" in r.json()["detail"], r.text
print("Manual attendance before joining date rejected: PASSED")

r = client.post("/attendance", headers=headers, json={"worker_id": worker_id, "date": on_joining, "slot": "AM", "status": "present"})
assert r.status_code == 200, r.text
print("Manual attendance on joining date accepted: PASSED")

# Future date also rejected (same endpoint, separate rule)
future = (date.today() + timedelta(days=10)).isoformat()
r = client.post("/attendance", headers=headers, json={"worker_id": worker_id, "date": future, "slot": "AM", "status": "present"})
assert r.status_code == 422 and "future" in r.json()["detail"], r.text
print("Manual attendance for a future date rejected: PASSED")

# --- 2. Leave (POST /workers/{id}/leave) ---
r = client.post(
    f"/workers/{worker_id}/leave", headers=headers,
    json={"leave_type": "earned", "date_from": before_joining, "date_to": before_joining, "days": 1},
)
assert r.status_code == 422 and "date of entry into service" in r.json()["detail"], r.text
print("Leave starting before joining date rejected: PASSED")

r = client.post(
    f"/workers/{worker_id}/leave", headers=headers,
    json={"leave_type": "earned", "date_from": after_joining, "date_to": after_joining, "days": 1},
)
assert r.status_code == 201, r.text
print("Leave on/after joining date accepted: PASSED")

# --- 3. Biometric sync path (derive_attendance_for_punches) ---
db = SessionLocal()
try:
    device = models.BiometricDevice(owner_id=1, name="Guard Device", ip_address="10.0.0.60")
    db.add(device)
    db.commit()
    db.refresh(device)

    def _make_punch(day: str) -> models.BiometricPunch:
        ts = datetime.combine(date.fromisoformat(day), datetime.min.time().replace(hour=9), tzinfo=timezone.utc)
        punch = models.BiometricPunch(
            device_id=device.id, worker_id=worker_id, raw_device_user_id="9001",
            timestamp=ts, punch_type="in", source="mock",
        )
        db.add(punch)
        db.commit()
        db.refresh(punch)
        return punch

    stale_punch = _make_punch("2026-04-01")  # well before joining_date
    derive_attendance_for_punches(db, [stale_punch], device)
    stale_attendance = (
        db.query(models.Attendance)
        .filter(models.Attendance.worker_id == worker_id, models.Attendance.date == date(2026, 4, 1))
        .first()
    )
    assert stale_attendance is None, "attendance must NOT be derived for a punch before the joining date"
    still_there = db.get(models.BiometricPunch, stale_punch.id)
    assert still_there is not None, "the raw punch row must still be stored, not deleted"
    print("Sync: punch before joining date does not derive attendance, but the raw punch is kept: PASSED")

    fresh_punch = _make_punch("2026-06-15")  # after joining_date
    derive_attendance_for_punches(db, [fresh_punch], device)
    fresh_attendance = (
        db.query(models.Attendance)
        .filter(models.Attendance.worker_id == worker_id, models.Attendance.date == date(2026, 6, 15))
        .first()
    )
    assert fresh_attendance is not None and fresh_attendance.status == "present", "attendance SHOULD be derived for a punch after the joining date"
    print("Sync: punch on/after joining date derives attendance normally: PASSED")
finally:
    db.close()

# --- 4. Worker with no date_of_joining on file: unrestricted ---
unrestricted_resp = client.post(
    "/workers", headers=headers,
    json={"name": "No Joining Date Worker", "aadhaar_number": _valid_aadhaar("20000000301"), "dob": "2000-01-01"},
)
assert unrestricted_resp.status_code == 201, unrestricted_resp.text
unrestricted_id = unrestricted_resp.json()["id"]
r = client.post("/attendance", headers=headers, json={"worker_id": unrestricted_id, "date": "2020-01-01", "slot": "AM", "status": "present"})
assert r.status_code == 200, r.text
print("Worker with no date_of_joining on file: attendance unrestricted: PASSED")

print("\nALL JOINING-DATE GUARD CHECKS PASSED")
