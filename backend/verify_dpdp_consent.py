"""Verifies the DPDP signup consent gate (Day 1 compliance groundwork):
signup must be genuinely blocked server-side without explicit consent
-- not just a decorative UI checkbox that any other API client could
skip straight past -- and a successful signup must record real
evidence of consent (a timestamp), not just a boolean flag.

    DATABASE_URL=sqlite:///./scratch_dpdp.db python verify_dpdp_consent.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, SessionLocal, engine
import models
from main import app
from verhoeff import validate_verhoeff


def _valid_aadhaar(prefix11: str) -> str:
    for last in range(10):
        cand = prefix11 + str(last)
        if validate_verhoeff(cand):
            return cand
    raise AssertionError("no valid checksum found")


Base.metadata.create_all(bind=engine)
client = TestClient(app)

# --- consent_given omitted entirely ---
no_field = client.post(
    "/owners/signup",
    json={"name": "No Consent Owner", "mobile": "9000002001", "password": "pass12345", "factory_name": "No Consent Factory"},
)
assert no_field.status_code == 422, f"signup without consent_given at all should be blocked: {no_field.status_code} {no_field.text}"
assert "Privacy Policy" in no_field.text, f"expected a clear reason in the response: {no_field.text}"
print("Signup with consent_given omitted entirely: blocked with 422: PASSED")

# --- consent_given explicitly false ---
false_field = client.post(
    "/owners/signup",
    json={
        "name": "False Consent Owner", "mobile": "9000002002", "password": "pass12345",
        "factory_name": "False Consent Factory", "consent_given": False,
    },
)
assert false_field.status_code == 422, f"signup with consent_given=False should be blocked: {false_field.status_code}"
print("Signup with consent_given=False: blocked with 422: PASSED")

# --- No account was actually created by either rejected attempt ---
db = SessionLocal()
try:
    leaked = db.query(models.Owner).filter(models.Owner.mobile.in_(["9000002001", "9000002002"])).count()
finally:
    db.close()
assert leaked == 0, "a rejected signup must not create a row at all"
print("Rejected signups create no Owner row: PASSED")

# --- consent_given=True succeeds and records a real timestamp ---
ok = client.post(
    "/owners/signup",
    json={
        "name": "Real Consent Owner", "mobile": "9000002003", "password": "pass12345",
        "factory_name": "Real Consent Factory", "consent_given": True,
    },
)
assert ok.status_code == 201, ok.text
owner_id = ok.json()["owner"]["id"]
db = SessionLocal()
try:
    owner = db.query(models.Owner).filter(models.Owner.id == owner_id).first()
    assert owner.consent_given_at is not None, "a successful signup must record when consent was given"
finally:
    db.close()
print("Signup with consent_given=True: succeeds and records a consent timestamp: PASSED")

# --- Biometric consent gate (separate from the signup consent above --
# this one guards enrolling a WORKER's fingerprint on a device, not
# creating an owner account). Pilot testing found the screen that
# captures this was unreachable anywhere in the app -- see
# WorkerEditScreen.tsx's new "Biometric consent" row and
# BiometricConsentScreen.tsx's returnTo param. This verifies the
# backend gate + message text those fixes rely on, not the navigation
# itself (not reachable via a plain API test). ---
owner_token = ok.json()["access_token"]
owner_headers = {"Authorization": f"Bearer {owner_token}"}
worker_resp = client.post(
    "/workers", headers=owner_headers,
    json={"name": "Biometric Worker", "aadhaar_number": _valid_aadhaar("20000000101")},
)
assert worker_resp.status_code == 201, worker_resp.text
worker_id = worker_resp.json()["id"]

device_resp = client.post(
    "/biometric/devices", headers=owner_headers,
    json={"name": "Consent Test Device", "ip_address": "10.0.0.50"},
)
assert device_resp.status_code == 201, device_resp.text
device_id = device_resp.json()["id"]

blocked = client.post(
    "/biometric/device-mappings", headers=owner_headers,
    json={"device_id": device_id, "device_user_id": "5001", "worker_id": worker_id},
)
assert blocked.status_code == 422, blocked.text
assert "Worker -> Edit details -> Biometric consent" in blocked.json()["detail"], blocked.json()
print("Mapping without biometric consent: blocked with 422, error names the real screen location: PASSED")

consent_resp = client.post(
    f"/workers/{worker_id}/biometric-consent", headers=owner_headers,
    json={"notice_text": "Fingerprint used only for attendance."},
)
assert consent_resp.status_code == 201, consent_resp.text
print("Capturing biometric consent succeeds: PASSED")

now_allowed = client.post(
    "/biometric/device-mappings", headers=owner_headers,
    json={"device_id": device_id, "device_user_id": "5001", "worker_id": worker_id},
)
assert now_allowed.status_code == 201, now_allowed.text
print("Mapping succeeds once consent is captured: PASSED")

print("\nALL ASSERTIONS PASSED")
