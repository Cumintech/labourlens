"""Verifies GET /workers/{id}/wage-profile (the "effective rate as of
today" lookup the mobile Wage Rate list and Edit screens now use for
display/prefill): returns the worker's own latest WageProfile when one
exists, reflects a WorkerType-seeded default when no override was ever
added, and 404s cleanly when nothing has ever been set.

    DATABASE_URL=sqlite:///./scratch_wp_effective.db python verify_wage_profile_effective.py
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
    json={"name": "Effective Owner", "mobile": "9000000901", "password": "pass123", "factory_name": "Effective Factory"},
)
headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}

# --- No rate set at all: 404, not a crash or a fabricated zero ---
w1 = client.post("/workers", headers=headers, json={"name": "No Rate", "aadhaar_number": "111122223333"}).json()
none_resp = client.get(f"/workers/{w1['id']}/wage-profile", headers=headers)
assert none_resp.status_code == 404, none_resp.text
print("Effective rate for a worker with nothing set: 404, not fabricated: PASSED")

# --- WorkerType assignment auto-creates a WageProfile from the type's
# default -- the effective-rate lookup must reflect it immediately ---
wtype = client.post("/worker-types", headers=headers, json={"name": "Plumber", "default_rate_type": "daily", "default_rate": 650}).json()
w2 = client.post("/workers", headers=headers, json={"name": "Type Default Worker", "aadhaar_number": "444455556666"}).json()
assign = client.put(f"/workers/{w2['id']}/worker-type", headers=headers, json={"worker_type_id": wtype["id"]})
assert assign.status_code == 200, assign.text
effective = client.get(f"/workers/{w2['id']}/wage-profile", headers=headers)
assert effective.status_code == 200, effective.text
assert effective.json()["basic"] == 650 and effective.json()["rate_type"] == "daily"
print("Effective rate for a worker with only a WorkerType default: reflects the type's default: PASSED")

# --- An explicit override on top of a type default: the worker's own
# rate wins, not the type default. Uses today's date, matching real
# usage (and the mobile Edit Wage Rate screen's own prefill, which
# defaults effective_from to today) -- a correction dated in the past
# would correctly lose to the type-default row's own effective_from
# (also today), which is a separate, correct invariant, not this one. ---
override = client.post(
    f"/workers/{w2['id']}/wage-profile",
    headers=headers,
    json={"rate_type": "daily", "basic": 720, "effective_from": date.today().isoformat()},
)
assert override.status_code == 201, override.text
effective_after_override = client.get(f"/workers/{w2['id']}/wage-profile", headers=headers)
assert effective_after_override.json()["basic"] == 720, "worker's own override should win over the type default"
print("Effective rate after an explicit override: the worker's own rate wins over the type default: PASSED")

print("\nALL ASSERTIONS PASSED")
