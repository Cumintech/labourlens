"""Verifies date_of_joining validation on the compliance create/update
endpoints: can't be in the future, can't be before the worker turned
the Factories Act's minimum working age (14), and a valid date is
accepted -- for both POST (create) and PUT (update).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_date_of_joining_validation.py
"""

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from database import Base, engine
from main import app
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
    json={"name": "Joining Owner", "mobile": "9000005001", "password": "pass12345", "factory_name": "Joining Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

dob = "2000-06-15"  # turns 14 on 2014-06-15
w = client.post("/workers", headers=headers, json={"name": "Joining Worker", "aadhaar_number": _valid_aadhaar("20000000001"), "dob": dob})
assert w.status_code == 201, w.text
worker_id = w.json()["id"]

# 1. Future date rejected
future = (date.today() + timedelta(days=5)).isoformat()
r = client.post(f"/workers/{worker_id}/compliance", headers=headers, json={"date_of_joining": future})
assert r.status_code == 422 and "future" in r.json()["detail"], r.text
print("Future date_of_joining rejected: PASSED")

# 2. Before worker turned 14 rejected
too_early = "2010-01-01"  # worker was 9 years old
r = client.post(f"/workers/{worker_id}/compliance", headers=headers, json={"date_of_joining": too_early})
assert r.status_code == 422 and "turned 14" in r.json()["detail"], r.text
print("date_of_joining before minimum working age rejected: PASSED")

# 3. Valid date (turned 14 exactly, or after) accepted
valid_join = "2015-01-01"  # worker was 14 by then
r = client.post(f"/workers/{worker_id}/compliance", headers=headers, json={"date_of_joining": valid_join})
assert r.status_code == 201, r.text
print("Valid date_of_joining accepted on create: PASSED")

# 4. Update (PUT) with an invalid date rejected
r = client.put(f"/workers/{worker_id}/compliance", headers=headers, json={"date_of_joining": too_early})
assert r.status_code == 422, r.text
print("Invalid date_of_joining rejected on update: PASSED")

# 5. Update omitting date_of_joining entirely leaves the existing value untouched, no validation error
r = client.put(f"/workers/{worker_id}/compliance", headers=headers, json={"designation_or_nature_of_work": "Helper"})
assert r.status_code == 200, r.text
assert r.json()["date_of_joining"] == valid_join, r.json()
print("Omitting date_of_joining on update leaves existing value untouched: PASSED")

# 6. Worker with no DOB on file -- date_of_joining can't be validated against age, future-check still applies
w2 = client.post("/workers", headers=headers, json={"name": "No DOB Worker", "aadhaar_number": _valid_aadhaar("30000000001")})
assert w2.status_code == 201, w2.text
worker2_id = w2.json()["id"]
# create_worker_compliance itself requires a DOB on file (pre-existing rule) -- confirm that's still enforced
r = client.post(f"/workers/{worker2_id}/compliance", headers=headers, json={"date_of_joining": "2020-01-01"})
assert r.status_code == 422 and "date of birth" in r.json()["detail"], r.text
print("Worker with no DOB still blocked from compliance creation (pre-existing rule, unchanged): PASSED")

print("\nALL DATE-OF-JOINING VALIDATION CHECKS PASSED")
