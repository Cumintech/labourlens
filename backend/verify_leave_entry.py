"""Verifies Phase 3 Day 2's LeaveEntry work: date_to < date_from is
rejected, leave_type is restricted to Form 15's three actual leave-wage
categories (not a generic HR taxonomy), overlap-based date-range
filtering, cross-owner scoping, and (real-device feedback pass) the
day-scoped GET /leave and DELETE /leave/{id} endpoints that back
Dashboard's inline Leave chip.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_leave_entry.py
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
    json={"name": "Leave Owner A", "mobile": "9000000501", "password": "pass123", "factory_name": "Leave Factory A"},
)
assert signup.status_code == 201, signup.text
token_a = signup.json()["access_token"]
headers_a = {"Authorization": f"Bearer {token_a}"}

worker = client.post(
    "/workers", headers=headers_a, json={"name": "Leave Worker", "aadhaar_number": "777788889999"}
).json()

backwards = client.post(
    f"/workers/{worker['id']}/leave",
    headers=headers_a,
    json={"leave_type": "earned", "date_from": "2026-03-10", "date_to": "2026-03-05", "days": 1},
)
assert backwards.status_code == 422, backwards.text
print("date_to before date_from: rejected with 422: PASSED")

bad_type = client.post(
    f"/workers/{worker['id']}/leave",
    headers=headers_a,
    json={"leave_type": "sick", "date_from": "2026-03-01", "date_to": "2026-03-02", "days": 2},
)
assert bad_type.status_code == 422, bad_type.text
print("leave_type outside Form 15's 3 statutory categories (e.g. 'sick'): rejected with 422: PASSED")

march_leave = client.post(
    f"/workers/{worker['id']}/leave",
    headers=headers_a,
    json={
        "leave_type": "national_festival_special",
        "date_from": "2026-03-10",
        "date_to": "2026-03-12",
        "days": 3,
        "wages_paid": 1500,
    },
)
assert march_leave.status_code == 201, march_leave.text
print("valid leave entry with a real Form 15 category saved: PASSED")

overlapping = client.get(
    f"/workers/{worker['id']}/leave",
    headers=headers_a,
    params={"start_date": "2026-03-01", "end_date": "2026-03-11"},
).json()
assert len(overlapping) == 1, overlapping
print("date range partially overlapping an entry still includes it: PASSED")

non_overlapping = client.get(
    f"/workers/{worker['id']}/leave",
    headers=headers_a,
    params={"start_date": "2026-04-01", "end_date": "2026-04-30"},
).json()
assert len(non_overlapping) == 0, non_overlapping
print("date range not overlapping an entry excludes it: PASSED")

# --- Day-scoped GET /leave (backs Dashboard's inline Leave chip -- one
# call for every worker's leave state on one date, not N per-worker calls) ---
worker2 = client.post(
    "/workers", headers=headers_a, json={"name": "Second Leave Worker", "aadhaar_number": "666677778888"}
).json()
quick_leave = client.post(
    f"/workers/{worker2['id']}/leave",
    headers=headers_a,
    json={"leave_type": "earned", "date_from": "2026-03-11", "date_to": "2026-03-11", "days": 1},
)
assert quick_leave.status_code == 201, quick_leave.text

day_scoped = client.get("/leave", headers=headers_a, params={"date": "2026-03-11"}).json()
day_scoped_worker_ids = {e["worker_id"] for e in day_scoped}
assert worker["id"] in day_scoped_worker_ids, day_scoped  # march_leave covers 03-10 to 03-12
assert worker2["id"] in day_scoped_worker_ids, day_scoped
print("GET /leave?date= returns every worker's leave entries for that one date in a single call: PASSED")

day_scoped_before = client.get("/leave", headers=headers_a, params={"date": "2026-01-01"}).json()
assert day_scoped_before == [], day_scoped_before
print("GET /leave?date= excludes entries that don't cover that date: PASSED")

# --- DELETE /leave/{id} (the "un-mark leave" half of the toggle) ---
delete_resp = client.delete(f"/leave/{quick_leave.json()['id']}", headers=headers_a)
assert delete_resp.status_code == 204, delete_resp.text
after_delete = client.get("/leave", headers=headers_a, params={"date": "2026-03-11"}).json()
assert worker2["id"] not in {e["worker_id"] for e in after_delete}, after_delete
print("DELETE /leave/{id} removes the entry: PASSED")

# --- Cross-owner scoping ---
signup_b = client.post(
    "/owners/signup",
    json={"name": "Leave Owner B", "mobile": "9000000502", "password": "pass123", "factory_name": "Leave Factory B"},
)
token_b = signup_b.json()["access_token"]
headers_b = {"Authorization": f"Bearer {token_b}"}

get_from_b = client.get(
    f"/workers/{worker['id']}/leave", headers=headers_b, params={"start_date": "2026-01-01", "end_date": "2026-12-31"}
)
assert get_from_b.status_code == 404, get_from_b.text
post_from_b = client.post(
    f"/workers/{worker['id']}/leave",
    headers=headers_b,
    json={"leave_type": "earned", "date_from": "2026-05-01", "date_to": "2026-05-02", "days": 2},
)
assert post_from_b.status_code == 404, post_from_b.text
print("cross-owner scoping on leave entries: PASSED")

owner_b_day_scoped = client.get("/leave", headers=headers_b, params={"date": "2026-03-11"}).json()
assert owner_b_day_scoped == [], f"owner B's day-scoped leave list leaked owner A's data: {owner_b_day_scoped}"
delete_cross = client.delete(f"/leave/{march_leave.json()['id']}", headers=headers_b)
assert delete_cross.status_code == 404, delete_cross.text
print("cross-owner scoping on GET /leave and DELETE /leave/{id}: PASSED")

print("\nALL ASSERTIONS PASSED")
