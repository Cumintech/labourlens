"""Verifies Phase 3 Day 1's Form 12 (WorkerCompliance) work: the
adult/young_person category is computed from Worker.dob, the under-14
warning fires but never blocks the save (confirmed warn-only per
PHASE3_STATUTORY_FORMS_PLAN.md), the missing-compliance backfill list is
correct, and cross-owner scoping.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_form12.py
"""

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

signup = client.post(
    "/owners/signup",
    json={"name": "Compliance Owner A", "mobile": "9000000301", "password": "pass123", "factory_name": "Compliance Factory A"},
)
assert signup.status_code == 201, signup.text
token_a = signup.json()["access_token"]
headers_a = {"Authorization": f"Bearer {token_a}"}

today = date(2026, 9, 3)


def _worker_with_dob(dob: str) -> dict:
    return client.post(
        "/workers", headers=headers_a, json={"name": "W", "aadhaar_number": "999900001111", "dob": dob}
    ).json()


# --- Adult: DOB well over 18 ---
adult = _worker_with_dob("1985-03-14")
resp = client.post(
    f"/workers/{adult['id']}/compliance",
    headers=headers_a,
    json={"worker_code": "T-001", "father_or_spouse_name": "Muthu", "date_of_joining": "2020-01-01"},
)
assert resp.status_code == 201, resp.text
body = resp.json()
assert body["category"] == "adult", body
assert body["under_minimum_age_warning"] is False, body
print("adult (DOB well over 18): category=adult, no warning: PASSED")

# --- Young person: age 16, needs fitness certificate fields ---
young = _worker_with_dob(f"{today.year - 16}-06-01")
resp = client.post(
    f"/workers/{young['id']}/compliance",
    headers=headers_a,
    json={"fitness_cert_no": "FC-123", "fitness_cert_valid_till": "2027-01-01"},
)
assert resp.status_code == 201, resp.text
body = resp.json()
assert body["category"] == "young_person", body
assert body["under_minimum_age_warning"] is False, body
assert body["fitness_cert_no"] == "FC-123", body
assert body["worker_code"] == "T-002", f"expected auto-generated worker_code T-002, got {body['worker_code']!r}"
print("young person (age 16): category=young_person, no warning, certificate fields saved: PASSED")
print("worker_code auto-generated (sequential, T-002) when omitted from the request: PASSED")

# --- Under the legal minimum working age: warn, but never block ---
child = _worker_with_dob(f"{today.year - 10}-06-01")
resp = client.post(f"/workers/{child['id']}/compliance", headers=headers_a, json={})
assert resp.status_code == 201, f"registration must NOT be blocked for an under-14 DOB: {resp.text}"
body = resp.json()
assert body["category"] == "young_person", body
assert body["under_minimum_age_warning"] is True, body
print("under legal minimum working age (10): warning fires, save still succeeds (warn-only): PASSED")

# --- Missing-compliance backfill list ---
another = _worker_with_dob("1990-01-01")
missing = client.get("/workers/missing-compliance", headers=headers_a).json()
missing_ids = {w["id"] for w in missing}
assert another["id"] in missing_ids, missing
assert adult["id"] not in missing_ids, missing
assert young["id"] not in missing_ids, missing
assert child["id"] not in missing_ids, missing
print("missing-compliance list includes only workers without a compliance record: PASSED")

# --- Duplicate POST rejected, PUT updates, category recomputed not trusted from body ---
dup = client.post(f"/workers/{adult['id']}/compliance", headers=headers_a, json={})
assert dup.status_code == 409, dup.text

updated = client.put(
    f"/workers/{adult['id']}/compliance", headers=headers_a, json={"date_made_permanent": "2021-01-01"}
)
assert updated.status_code == 200, updated.text
assert updated.json()["date_made_permanent"] == "2021-01-01", updated.json()
assert updated.json()["category"] == "adult", updated.json()
assert updated.json()["worker_code"] == "T-001", (
    f"PUT without worker_code in the payload wiped it -- should be untouched (exclude_unset): {updated.json()}"
)
print("duplicate compliance POST rejected (409); PUT updates fields, category still server-derived: PASSED")
print("PUT omitting worker_code leaves the existing auto-generated code untouched (exclude_unset): PASSED")

# --- Cross-owner scoping ---
signup_b = client.post(
    "/owners/signup",
    json={"name": "Compliance Owner B", "mobile": "9000000302", "password": "pass123", "factory_name": "Compliance Factory B"},
)
token_b = signup_b.json()["access_token"]
headers_b = {"Authorization": f"Bearer {token_b}"}

get_from_b = client.get(f"/workers/{adult['id']}/compliance", headers=headers_b)
assert get_from_b.status_code == 404, get_from_b.text
post_from_b = client.post(f"/workers/{another['id']}/compliance", headers=headers_b, json={})
assert post_from_b.status_code == 404, post_from_b.text
print("cross-owner scoping on compliance records: PASSED")

print("\nALL ASSERTIONS PASSED")
