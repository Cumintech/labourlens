"""Verifies the Aadhaar validation rule added to WorkerCreateIn: exactly
12 digits, first digit 2-9, and a valid Verhoeff checksum -- both wrong
format and a bad checksum must be rejected with a 422, a real,
checksum-valid number must be accepted, and spaces must be stripped
before validating.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_aadhaar_validation.py
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

signup = client.post(
    "/owners/signup",
    json={"name": "Aadhaar Owner", "mobile": "9000003001", "password": "pass12345", "factory_name": "Aadhaar Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}


def find_valid_aadhaar(prefix_digit: str) -> str:
    """Brute-forces a real Verhoeff-valid 12-digit number starting with
    the given first digit, for use as a known-good test value."""
    for last in range(10):
        candidate = f"{prefix_digit}23456789012"[:11] + str(last)
        if validate_verhoeff(candidate):
            return candidate
    raise AssertionError("could not find a valid test Aadhaar number")


valid_aadhaar = find_valid_aadhaar("2")

# 1. Wrong length rejected
r = client.post("/workers", headers=headers, json={"name": "W1", "aadhaar_number": "12345", "dob": "1995-01-01"})
assert r.status_code == 422, r.text
print("Wrong-length Aadhaar rejected: PASSED")

# 2. First digit 0/1 rejected even with correct length
r = client.post("/workers", headers=headers, json={"name": "W2", "aadhaar_number": "012345678901", "dob": "1995-01-01"})
assert r.status_code == 422, r.text
print("Aadhaar starting with 0/1 rejected: PASSED")

# 3. Right length/first-digit but bad checksum rejected
bad_checksum = valid_aadhaar[:-1] + str((int(valid_aadhaar[-1]) + 1) % 10)
r = client.post("/workers", headers=headers, json={"name": "W3", "aadhaar_number": bad_checksum, "dob": "1995-01-01"})
assert r.status_code == 422, r.text
assert "valid 12-digit Aadhaar" in r.json()["detail"][0]["msg"]
print("Bad Verhoeff checksum rejected: PASSED")

# 4. A real, checksum-valid number is accepted
r = client.post("/workers", headers=headers, json={"name": "W4", "aadhaar_number": valid_aadhaar, "dob": "1995-01-01"})
assert r.status_code == 201, r.text
assert r.json()["aadhaar_last4"] == valid_aadhaar[-4:]
print("Valid Aadhaar accepted: PASSED")

# 5. Spaces stripped before validating
spaced = f"{valid_aadhaar[:4]} {valid_aadhaar[4:8]} {valid_aadhaar[8:]}"
r = client.post("/workers", headers=headers, json={"name": "W5", "aadhaar_number": spaced, "dob": "1995-01-01"})
assert r.status_code == 201, r.text
print("Spaces in Aadhaar stripped before validating: PASSED")

print("\nALL AADHAAR VALIDATION CHECKS PASSED")
