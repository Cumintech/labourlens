"""Verifies worker employment classification (employment_type/is_ism/
home_state): valid values round-trip through create and the dedicated
update endpoint, an invalid employment_type is rejected with 422, and
is_ism is independent of employment_type (a permanent worker can be ISM).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_worker_employment.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from database import Base, engine
from main import app
from verhoeff import validate_verhoeff


def _aadhaar(prefix11):
    return next(prefix11 + str(d) for d in range(10) if validate_verhoeff(prefix11 + str(d)))


Base.metadata.create_all(bind=engine)
client = TestClient(app)

signup = client.post(
    "/owners/signup",
    json={"name": "Emp Owner", "mobile": "9000004001", "password": "pass12345", "factory_name": "Emp Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}

# 1. Create with employment_type unset -> defaults to None/not-ism
r = client.post("/workers", headers=headers, json={"name": "W1", "aadhaar_number": _aadhaar("22345678901"), "dob": "1995-01-01"})
assert r.status_code == 201, r.text
assert r.json()["employment_type"] is None and r.json()["is_ism"] is False
print("Create with no employment fields defaults correctly: PASSED")

# 2. Create a permanent + ISM worker (independent flags)
r = client.post(
    "/workers",
    headers=headers,
    json={"name": "W2", "aadhaar_number": _aadhaar("32345678901"), "dob": "1995-01-01", "employment_type": "permanent", "is_ism": True, "home_state": "Bihar"},
)
assert r.status_code == 201, r.text
body = r.json()
assert body["employment_type"] == "permanent" and body["is_ism"] is True and body["home_state"] == "Bihar"
print("Permanent + ISM worker created with independent flags: PASSED")
w2_id = body["id"]

# 3. Invalid employment_type rejected
r = client.post("/workers", headers=headers, json={"name": "W3", "aadhaar_number": _aadhaar("42345678901"), "employment_type": "casual"})
assert r.status_code == 422, r.text
print("Invalid employment_type rejected: PASSED")

# 4. Update via the dedicated employment endpoint
r = client.put(f"/workers/{w2_id}/employment", headers=headers, json={"employment_type": "temporary", "is_ism": False, "home_state": "Tamil Nadu"})
assert r.status_code == 200, r.text
body = r.json()
assert body["employment_type"] == "temporary" and body["is_ism"] is False and body["home_state"] == "Tamil Nadu"
print("Update via PUT /workers/{id}/employment: PASSED")

print("\nALL ASSERTIONS PASSED")
