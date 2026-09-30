"""Verifies the mobile-number validation rules: 10 digits starting 6-9,
a pasted +91/0 prefix reduced to the bare 10 digits, worker mobile is
optional (empty is fine, a partial number isn't), owner signup mobile
is required and strictly validated, and owner login (by username, which
defaults to the mobile number when signup doesn't send one explicitly)
never hard-rejects on format, so no already-existing account can be
locked out.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_mobile_validation.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from database import Base, engine
from main import app
from verhoeff import validate_verhoeff

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def find_valid_aadhaar(prefix_digit: str) -> str:
    for last in range(10):
        candidate = f"{prefix_digit}23456789012"[:11] + str(last)
        if validate_verhoeff(candidate):
            return candidate
    raise AssertionError("could not find a valid test Aadhaar number")

# --- Owner signup: required, strictly validated ---
r = client.post(
    "/owners/signup",
    json={"name": "Mobile Owner", "mobile": "12345", "password": "pass12345", "factory_name": "Mobile Factory", "consent_given": True},
)
assert r.status_code == 422, r.text
print("Owner signup with invalid mobile rejected: PASSED")

r = client.post(
    "/owners/signup",
    json={"name": "Mobile Owner", "mobile": "+91 90000-04001", "password": "pass12345", "factory_name": "Mobile Factory", "consent_given": True},
)
assert r.status_code == 201, r.text
assert r.json()["owner"]["mobile"] == "9000004001", r.json()
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}
print("Owner signup with +91-prefixed mobile normalized to 10 digits: PASSED")

# --- Owner login: by username now, not mobile (see schemas.OwnerLoginIn)
# -- a signup with no explicit username falls back to the mobile number,
# so the account above logs in with "9000004001" as its username. ---
r = client.post("/owners/login", json={"username": "9000004001", "password": "pass12345"})
assert r.status_code == 200, r.text
print("Owner login with mobile-derived default username: PASSED")

r = client.post("/owners/login", json={"username": "not-a-real-user", "password": "pass12345"})
assert r.status_code == 401, r.text  # falls through to generic invalid-credentials, never a 422
print("Owner login with unknown username falls through to 401, not 422: PASSED")

# --- Worker mobile: optional ---
r = client.post("/workers", headers=headers, json={"name": "W1", "aadhaar_number": find_valid_aadhaar("2"), "dob": "1995-01-01"})
assert r.status_code == 201, r.text
print("Worker with no mobile at all accepted (optional field): PASSED")

r = client.post("/workers", headers=headers, json={"name": "W2", "aadhaar_number": find_valid_aadhaar("3"), "dob": "1995-01-01", "mobile": "12345"})
assert r.status_code == 422, r.text
print("Worker with a partial/invalid mobile rejected: PASSED")

r = client.post("/workers", headers=headers, json={"name": "W3", "aadhaar_number": find_valid_aadhaar("4"), "dob": "1995-01-01", "mobile": "0 98765 43210"})
assert r.status_code == 201, r.text
assert r.json()["mobile"] == "9876543210", r.json()
print("Worker mobile with 0-prefix and spaces normalized to 10 digits: PASSED")

print("\nALL MOBILE VALIDATION CHECKS PASSED")
