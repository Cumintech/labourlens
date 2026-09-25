"""Regression test for a real bug: GET /workers/{worker_id} (used by the
mobile Wage Rate detail screen) returned device_user_id=None for a
worker who WAS mapped to a biometric device, because it returned the
bare Worker ORM row directly instead of joining DeviceUserMapping the
same way GET /workers already does. Confirms the single-worker endpoint
now reports the same mapped device_user_id as the list endpoint, for a
worker created and mapped in this same run (not relying on data that
happened to already exist).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_worker_detail_device_mapping.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

signup = client.post(
    "/owners/signup",
    json={"name": "Mapping Owner", "mobile": "9000001701", "password": "pass12345", "factory_name": "Mapping Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

worker = client.post("/workers", headers=headers, json={"name": "Ganesh", "aadhaar_number": "555566667777"}).json()

# Before mapping: both endpoints correctly agree it's unmapped.
before_detail = client.get(f"/workers/{worker['id']}", headers=headers)
assert before_detail.status_code == 200, before_detail.text
assert before_detail.json()["device_user_id"] is None, before_detail.json()
print("Before mapping: GET /workers/{id} correctly reports device_user_id=None: PASSED")

device = client.post("/biometric/devices", headers=headers, json={"name": "Main Gate", "ip_address": "192.168.1.50"}).json()
consent = client.post(f"/workers/{worker['id']}/biometric-consent", headers=headers, json={"notice_text": "Consent captured."})
assert consent.status_code == 201, consent.text
mapping = client.post(
    "/biometric/device-mappings", headers=headers, json={"device_id": device["id"], "device_user_id": "1002", "worker_id": worker["id"]}
)
assert mapping.status_code == 201, mapping.text

# The actual bug: this endpoint (what the Wage Rate detail screen calls)
# previously never looked at DeviceUserMapping at all, so it kept
# reporting None here even with a confirmed mapping.
after_detail = client.get(f"/workers/{worker['id']}", headers=headers)
assert after_detail.status_code == 200, after_detail.text
assert after_detail.json()["device_user_id"] == "1002", after_detail.json()
print("After mapping: GET /workers/{id} correctly reports the mapped device_user_id: PASSED")

# The list endpoint already got this right -- confirm both endpoints
# agree, so the two screens reading from them can never disagree again.
list_resp = client.get("/workers", headers=headers)
listed = next(w for w in list_resp.json() if w["id"] == worker["id"])
assert listed["device_user_id"] == "1002", listed
print("GET /workers (list) agrees with GET /workers/{id} (detail): PASSED")

print("\nALL ASSERTIONS PASSED")
