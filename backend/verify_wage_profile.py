"""Verifies Phase 3 Day 2's WageProfile work: as_of resolution picks the
correct historical rate, a new version never mutates an old one (the
invariant that makes computing Form 15 live, without a cached rollup,
safe), and cross-owner scoping.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_wage_profile.py
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
    json={"name": "Wage Owner A", "mobile": "9000000401", "password": "pass123", "factory_name": "Wage Factory A"},
)
assert signup.status_code == 201, signup.text
token_a = signup.json()["access_token"]
headers_a = {"Authorization": f"Bearer {token_a}"}

worker = client.post(
    "/workers", headers=headers_a, json={"name": "Wage Worker", "aadhaar_number": "444455556666"}
).json()

v1 = client.post(
    f"/workers/{worker['id']}/wage-profile",
    headers=headers_a,
    json={"rate_type": "daily", "basic": 500, "da": 50, "effective_from": "2026-01-01"},
)
assert v1.status_code == 201, v1.text

v2 = client.post(
    f"/workers/{worker['id']}/wage-profile",
    headers=headers_a,
    json={"rate_type": "daily", "basic": 600, "da": 60, "effective_from": "2026-06-01"},
)
assert v2.status_code == 201, v2.text

before_any = client.get(f"/workers/{worker['id']}/wage-profile", headers=headers_a, params={"as_of": "2025-12-01"})
assert before_any.status_code == 404, before_any.text
print("as_of before any rate exists: 404, not a wrong-but-present rate: PASSED")

mid = client.get(f"/workers/{worker['id']}/wage-profile", headers=headers_a, params={"as_of": "2026-03-01"})
assert mid.status_code == 200 and mid.json()["basic"] == 500, mid.text
print("as_of resolves to the rate that applied at that time (v1, basic=500): PASSED")

later = client.get(f"/workers/{worker['id']}/wage-profile", headers=headers_a, params={"as_of": "2026-07-01"})
assert later.status_code == 200 and later.json()["basic"] == 600, later.text
print("as_of resolves to the newer rate once its effective_from has passed (v2, basic=600): PASSED")

history = client.get(f"/workers/{worker['id']}/wage-profile/history", headers=headers_a).json()
assert [h["basic"] for h in history] == [600, 500], history
print("history returns both versions, newest first: PASSED")

# The invariant that makes this safe without a cached rollup: v1's row
# must still read basic=500 after v2 was added -- nothing mutates it.
v1_still = next(h for h in history if h["id"] == v1.json()["id"])
assert v1_still["basic"] == 500, "an old WageProfile row was mutated by adding a new version -- this must never happen"
print("adding a new version never mutates an existing one: PASSED")

# No PUT/edit endpoint exists at all -- confirm there's genuinely no way
# to edit an existing row via the API.
put_attempt = client.put(f"/workers/{worker['id']}/wage-profile", headers=headers_a, json={"basic": 999})
assert put_attempt.status_code in (404, 405), put_attempt.status_code
print("no PUT/edit endpoint exists for wage-profile (append-only enforced at the API layer): PASSED")

# --- Cross-owner scoping ---
signup_b = client.post(
    "/owners/signup",
    json={"name": "Wage Owner B", "mobile": "9000000402", "password": "pass123", "factory_name": "Wage Factory B"},
)
token_b = signup_b.json()["access_token"]
headers_b = {"Authorization": f"Bearer {token_b}"}

get_from_b = client.get(f"/workers/{worker['id']}/wage-profile", headers=headers_b)
assert get_from_b.status_code == 404, get_from_b.text
post_from_b = client.post(
    f"/workers/{worker['id']}/wage-profile", headers=headers_b, json={"basic": 100, "effective_from": "2026-01-01"}
)
assert post_from_b.status_code == 404, post_from_b.text
print("cross-owner scoping on wage profiles: PASSED")

print("\nALL ASSERTIONS PASSED")
