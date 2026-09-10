"""Verifies AuditLog coverage (Day 1 infra push): activate/deactivate
was the only thing ever logged before this round; compliance-record
edits and wage-rate changes (both a manual entry and a WorkerType's
auto-created default) must now produce their own audit rows too, each
with the right owner_id/worker_id/action -- and, same discipline as
every other verify_*.py script, cross-owner scoping must hold (owner B
never sees owner A's audit trail).

    DATABASE_URL=sqlite:///./scratch_audit.db python verify_audit_log.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, SessionLocal, engine
import models
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

signup = client.post(
    "/owners/signup",
    json={"name": "Audit Owner", "mobile": "9000001001", "password": "pass123", "factory_name": "Audit Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
owner_id = signup.json()["owner"]["id"]
headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}


def audit_rows(worker_id: int) -> list[models.AuditLog]:
    db = SessionLocal()
    try:
        return (
            db.query(models.AuditLog)
            .filter(models.AuditLog.owner_id == owner_id, models.AuditLog.worker_id == worker_id)
            .order_by(models.AuditLog.id)
            .all()
        )
    finally:
        db.close()


# --- Deactivate: the one action already logged before this round --
# confirmed still works, not regressed by the new additions below. ---
worker1 = client.post("/workers", headers=headers, json={"name": "Deactivate Me", "aadhaar_number": "111100002222"}).json()
deact = client.patch(f"/workers/{worker1['id']}/deactivate", headers=headers)
assert deact.status_code == 200, deact.text
rows1 = audit_rows(worker1["id"])
assert [r.action for r in rows1] == ["deactivate"], f"expected exactly one 'deactivate' row, got {[r.action for r in rows1]}"
print("Deactivate still produces its audit row: PASSED")

# --- Compliance create + update ---
worker2 = client.post("/workers", headers=headers, json={"name": "Compliance Worker", "aadhaar_number": "333344445555", "dob": "1990-01-01"}).json()
created = client.post(
    f"/workers/{worker2['id']}/compliance", headers=headers, json={"designation_or_nature_of_work": "Fitter"}
)
assert created.status_code == 201, created.text
updated = client.put(
    f"/workers/{worker2['id']}/compliance", headers=headers, json={"designation_or_nature_of_work": "Senior Fitter"}
)
assert updated.status_code == 200, updated.text
rows2 = audit_rows(worker2["id"])
assert [r.action for r in rows2] == ["compliance_create", "compliance_update"], (
    f"expected compliance_create then compliance_update, got {[r.action for r in rows2]}"
)
assert all(r.owner_id == owner_id and r.worker_id == worker2["id"] for r in rows2)
print("Compliance create + update each produce their own audit row, right owner/worker: PASSED")

# --- Wage rate: a manual entry via POST /wage-profile ---
worker3 = client.post("/workers", headers=headers, json={"name": "Manual Rate Worker", "aadhaar_number": "666677778888"}).json()
rate = client.post(
    f"/workers/{worker3['id']}/wage-profile",
    headers=headers,
    json={"rate_type": "daily", "basic": 500, "effective_from": "2026-09-01"},
)
assert rate.status_code == 201, rate.text
rows3 = audit_rows(worker3["id"])
assert [r.action for r in rows3] == ["wage_rate_set"], f"expected one wage_rate_set row, got {[r.action for r in rows3]}"
assert "500" in (rows3[0].reason or ""), f"expected the rate figure in the audit reason, got {rows3[0].reason!r}"
print("A manual wage-rate entry produces a wage_rate_set audit row with the figure in the reason: PASSED")

# --- Wage rate: auto-created from a WorkerType default on assignment ---
worker4 = client.post("/workers", headers=headers, json={"name": "Type Default Worker", "aadhaar_number": "999900001111"}).json()
wtype = client.post("/worker-types", headers=headers, json={"name": "Electrician Test Type", "default_rate_type": "daily", "default_rate": 800}).json()
assign = client.put(f"/workers/{worker4['id']}/worker-type", headers=headers, json={"worker_type_id": wtype["id"]})
assert assign.status_code == 200, assign.text
rows4 = audit_rows(worker4["id"])
assert [r.action for r in rows4] == ["wage_rate_set"], f"expected one wage_rate_set row, got {[r.action for r in rows4]}"
assert "Electrician Test Type" in (rows4[0].reason or ""), f"expected the worker type's name in the audit reason, got {rows4[0].reason!r}"
print("A WorkerType-auto-created default wage rate produces its own wage_rate_set audit row: PASSED")

# Assigning a type to a worker who already has their own rate must NOT
# fabricate a second wage_rate_set row -- nothing about their wage
# actually changed (see assign_worker_type's own "already has a rate
# keeps it" rule).
wtype2 = client.post("/worker-types", headers=headers, json={"name": "Plumber Test Type", "default_rate_type": "daily", "default_rate": 900}).json()
reassign = client.put(f"/workers/{worker4['id']}/worker-type", headers=headers, json={"worker_type_id": wtype2["id"]})
assert reassign.status_code == 200, reassign.text
rows4_after = audit_rows(worker4["id"])
assert len(rows4_after) == 1, (
    f"reassigning a type to a worker who already has their own rate shouldn't log a fake wage change: {[r.action for r in rows4_after]}"
)
print("Reassigning a worker type to a worker who already has a rate doesn't fabricate a wage_rate_set row: PASSED")

# --- Cross-owner scoping ---
signup_b = client.post(
    "/owners/signup",
    json={"name": "Audit Owner B", "mobile": "9000001002", "password": "pass123", "factory_name": "Audit Factory B", "consent_given": True},
)
owner_b_id = signup_b.json()["owner"]["id"]
db = SessionLocal()
try:
    leaked = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.owner_id == owner_b_id)
        .count()
    )
finally:
    db.close()
assert leaked == 0, "owner B has audit rows before doing anything -- scoping bug"
print("Cross-owner scoping: a fresh owner starts with zero audit rows (none leaked from owner A): PASSED")

print("\nALL ASSERTIONS PASSED")
