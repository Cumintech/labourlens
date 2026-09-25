"""Verifies the Wage Rate feature's WorkerType work: CRUD, duplicate-name
rejection, assigning a type to a worker with no wage profile auto-creates
one from the type's defaults, assigning a type to a worker who already has
a rate leaves that rate untouched (their existing rate IS their override),
deleting a type clears the assignment on any worker pointing at it rather
than leaving a dangling reference, and cross-owner scoping.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_worker_type.py
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
    json={"name": "Type Owner A", "mobile": "9000000901", "password": "pass12345", "factory_name": "Type Factory A", "consent_given": True},
)
assert signup.status_code == 201, signup.text
token_a = signup.json()["access_token"]
headers_a = {"Authorization": f"Bearer {token_a}"}

# --- CRUD ---
create = client.post("/worker-types", headers=headers_a, json={"name": "Skilled", "default_rate_type": "daily", "default_rate": 700})
assert create.status_code == 201, create.text
skilled = create.json()
assert skilled["name"] == "Skilled" and skilled["default_rate"] == 700, skilled

dup = client.post("/worker-types", headers=headers_a, json={"name": "Skilled", "default_rate_type": "daily", "default_rate": 800})
assert dup.status_code == 409, dup.text
print("worker type creation + duplicate-name rejection: PASSED")

update = client.put(f"/worker-types/{skilled['id']}", headers=headers_a, json={"name": "Skilled", "default_rate_type": "daily", "default_rate": 750})
assert update.status_code == 200 and update.json()["default_rate"] == 750, update.text
print("worker type update: PASSED")

listing = client.get("/worker-types", headers=headers_a)
# Every new signup is pre-seeded with 3 default types (Plumber,
# Electrician, Helper) -- see main.py's signup() -- so a fresh owner who
# then creates one more type ("Skilled") has 4 total, not 1.
listing_names = {t["name"] for t in listing.json()}
assert listing.status_code == 200 and listing_names == {"Plumber", "Electrician", "Helper", "Skilled"}, listing.text
print("worker type listing (includes the 3 pre-seeded defaults): PASSED")

# --- Assigning a type to a worker with no wage profile auto-creates one ---
w1 = client.post("/workers", headers=headers_a, json={"name": "No Rate Yet", "aadhaar_number": "444455556666"}).json()
before = client.get(f"/workers/{w1['id']}/wage-profile", headers=headers_a)
assert before.status_code == 404, "worker should start with no wage profile"

assign = client.put(f"/workers/{w1['id']}/worker-type", headers=headers_a, json={"worker_type_id": skilled["id"]})
assert assign.status_code == 200 and assign.json()["worker_type_id"] == skilled["id"], assign.text

after = client.get(f"/workers/{w1['id']}/wage-profile", headers=headers_a)
assert after.status_code == 200, after.text
assert after.json()["rate_type"] == "daily" and after.json()["basic"] == 750, (
    f"expected wage profile auto-created from the type's default rate (750/daily): {after.json()}"
)
print("assigning a worker type to a worker with no rate auto-creates a wage profile from its defaults: PASSED")

# --- Assigning a type to a worker who already has a rate leaves it untouched ---
w2 = client.post("/workers", headers=headers_a, json={"name": "Already Has Rate", "aadhaar_number": "444455557777"}).json()
client.post(
    f"/workers/{w2['id']}/wage-profile",
    headers=headers_a,
    json={"rate_type": "daily", "basic": 1200, "hra": 0, "da": 0, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-01-01"},
)
client.put(f"/workers/{w2['id']}/worker-type", headers=headers_a, json={"worker_type_id": skilled["id"]})
still = client.get(f"/workers/{w2['id']}/wage-profile", headers=headers_a)
assert still.json()["basic"] == 1200, f"assigning a type overwrote an existing individual rate: {still.json()}"
print("assigning a worker type to a worker who already has a rate leaves their rate (their override) untouched: PASSED")

# --- Deleting a type clears the assignment on any worker ---
delete = client.delete(f"/worker-types/{skilled['id']}", headers=headers_a)
assert delete.status_code == 204, delete.text
w1_after = client.get("/workers", headers=headers_a).json()
w1_row = next(w for w in w1_after if w["id"] == w1["id"])
assert w1_row["worker_type_id"] is None, f"deleting a worker type should clear it off any worker: {w1_row}"
print("deleting a worker type clears the assignment on workers pointing at it: PASSED")

# --- Cross-owner scoping ---
signup_b = client.post(
    "/owners/signup",
    json={"name": "Type Owner B", "mobile": "9000000902", "password": "pass12345", "factory_name": "Type Factory B", "consent_given": True},
)
token_b = signup_b.json()["access_token"]
headers_b = {"Authorization": f"Bearer {token_b}"}

create_b = client.post("/worker-types", headers=headers_b, json={"name": "Skilled", "default_rate_type": "daily", "default_rate": 500})
assert create_b.status_code == 201, "owner B should be able to create a type with the same name as owner A's (different owner)"

listing_b = client.get("/worker-types", headers=headers_b)
listing_b_names = {t["name"] for t in listing_b.json()}
assert listing_b_names == {"Plumber", "Electrician", "Helper", "Skilled"}, "owner B should never see owner A's worker types"

cross_assign = client.put(f"/workers/{w1['id']}/worker-type", headers=headers_b, json={"worker_type_id": create_b.json()["id"]})
assert cross_assign.status_code == 404, "owner B should not be able to assign a type to owner A's worker"
print("cross-owner scoping on worker types: PASSED")

print("\nALL ASSERTIONS PASSED")
