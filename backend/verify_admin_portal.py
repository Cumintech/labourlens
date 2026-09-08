"""Verifies the admin portal's actual functionality: factory list/detail,
status updates, payment tracking with overdue flagging, and -- the one
thing that's easy to get wrong -- that the monthly employee snapshot
job produces genuinely historical, non-drifting data across multiple
months, not just a snapshot that happens to work for "today."

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_admin_portal.py
"""
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, SessionLocal, engine
import models
from admin_auth import hash_password
from main import app
from monthly_employee_snapshot import snapshot_month

Base.metadata.create_all(bind=engine)
client = TestClient(app)

db = SessionLocal()
admin = models.AdminUser(email="portal-check@example.com", password_hash=hash_password("a real strong password 123"))
db.add(admin)
db.commit()
db.close()

login = client.post("/admin/login", json={"email": "portal-check@example.com", "password": "a real strong password 123"})
assert login.status_code == 200, login.text
admin_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

# --- Two factory-owner signups -- each should auto-create a Factory row ---
owner_a = client.post(
    "/owners/signup",
    json={"name": "Portal Owner A", "mobile": "9000001401", "password": "pass123", "factory_name": "Portal Factory A", "consent_given": True},
)
assert owner_a.status_code == 201, owner_a.text
owner_a_token = owner_a.json()["access_token"]
owner_a_id = owner_a.json()["owner"]["id"]

owner_b = client.post(
    "/owners/signup",
    json={"name": "Portal Owner B", "mobile": "9000001402", "password": "pass123", "factory_name": "Portal Factory B", "consent_given": True},
)
assert owner_b.status_code == 201, owner_b.text

# --- Factory list shows both, auto-created at "trial" status ---
factories = client.get("/admin/factories", headers=admin_headers)
assert factories.status_code == 200, factories.text
names = {f["name"]: f for f in factories.json()}
assert "Portal Factory A" in names and "Portal Factory B" in names, names
assert names["Portal Factory A"]["status"] == "trial"
assert names["Portal Factory A"]["active_employee_count"] == 0
print("Factory auto-created at signup, listed at 'trial' status with 0 employees: PASSED")

factory_a_id = names["Portal Factory A"]["id"]

# --- Status filter ---
trial_only = client.get("/admin/factories", params={"status": "trial"}, headers=admin_headers)
assert trial_only.status_code == 200 and len(trial_only.json()) == 2, trial_only.json()
active_only = client.get("/admin/factories", params={"status": "active"}, headers=admin_headers)
assert active_only.status_code == 200 and len(active_only.json()) == 0, active_only.json()
print("Status filter on /admin/factories: PASSED")

# --- Status + plan_tier + notes update ---
update = client.patch(
    f"/admin/factories/{factory_a_id}",
    headers=admin_headers,
    json={"status": "active", "plan_tier": "pro", "notes": "Paid via bank transfer, confirmed by phone"},
)
assert update.status_code == 200, update.text
assert update.json()["status"] == "active"
assert update.json()["plan_tier"] == "pro"
print("Factory status/plan_tier/notes update: PASSED")

# --- Add workers to Factory A, confirm the "current" count is live ---
for i in range(3):
    w = client.post(
        f"/workers",
        headers={"Authorization": f"Bearer {owner_a_token}"},
        json={"name": f"Worker {i}", "aadhaar_number": f"11112222{i:04d}"},
    )
    assert w.status_code == 201, w.text

detail = client.get(f"/admin/factories/{factory_a_id}", headers=admin_headers)
assert detail.status_code == 200, detail.text
assert detail.json()["factory"]["active_employee_count"] == 3, detail.json()
print("Live active-employee count reflects newly-added workers: PASSED")

# --- Payments: create one overdue, one paid; confirm is_overdue flagging ---
overdue_payment = client.post(
    f"/admin/factories/{factory_a_id}/payments",
    headers=admin_headers,
    json={"amount": 999, "due_date": (date.today() - timedelta(days=10)).isoformat(), "status": "pending"},
)
assert overdue_payment.status_code == 201, overdue_payment.text
assert overdue_payment.json()["is_overdue"] is True, overdue_payment.json()

paid_payment = client.post(
    f"/admin/factories/{factory_a_id}/payments",
    headers=admin_headers,
    json={
        "amount": 999,
        "due_date": (date.today() - timedelta(days=40)).isoformat(),
        "paid_date": (date.today() - timedelta(days=41)).isoformat(),
        "status": "paid",
    },
)
assert paid_payment.status_code == 201, paid_payment.text
assert paid_payment.json()["is_overdue"] is False, paid_payment.json()
print("Payment overdue flagging (unpaid + past due_date = overdue, paid = not overdue): PASSED")

detail_with_payments = client.get(f"/admin/factories/{factory_a_id}", headers=admin_headers)
assert len(detail_with_payments.json()["payments"]) == 2
print("Factory detail includes payment history: PASSED")

# --- The core requirement: multi-month employee snapshot history that
# doesn't drift when a worker is later deactivated ---
db = SessionLocal()
snapshot_month(db, "2026-06")  # 3 active workers this "month"
db.close()

# Deactivate one worker -- July's snapshot should reflect 2, but June's
# already-recorded snapshot of 3 must NOT retroactively change.
worker_list = client.get("/workers", headers={"Authorization": f"Bearer {owner_a_token}"})
first_worker_id = worker_list.json()[0]["id"]
deactivate = client.patch(f"/workers/{first_worker_id}/deactivate", headers={"Authorization": f"Bearer {owner_a_token}"})
assert deactivate.status_code == 200, deactivate.text

db = SessionLocal()
snapshot_month(db, "2026-07")  # 2 active workers now
snapshot_month(db, "2026-08")  # still 2
db.close()

trend = client.get(f"/admin/factories/{factory_a_id}", headers=admin_headers).json()["employee_trend"]
by_month = {t["month"]: t["active_employee_count"] for t in trend}
assert by_month["2026-06"] == 3, f"June snapshot should stay 3 even after a later deactivation, got {by_month}"
assert by_month["2026-07"] == 2, by_month
assert by_month["2026-08"] == 2, by_month
print("Multi-month employee snapshot history: June stays 3 after a later deactivation, July/August correctly show 2: PASSED")

# --- Re-running snapshot_month for an already-snapshotted month upserts, doesn't duplicate ---
db = SessionLocal()
snapshot_month(db, "2026-06")
db.close()
trend_after_rerun = client.get(f"/admin/factories/{factory_a_id}", headers=admin_headers).json()["employee_trend"]
june_rows = [t for t in trend_after_rerun if t["month"] == "2026-06"]
assert len(june_rows) == 1, f"re-running the same month should upsert, not duplicate: {june_rows}"
print("Re-running the snapshot job for the same month upserts rather than duplicating: PASSED")

# --- Dashboard summary ---
dashboard = client.get("/admin/dashboard", headers=admin_headers)
assert dashboard.status_code == 200, dashboard.text
d = dashboard.json()
assert d["total_factories"] == 2, d
assert d["counts_by_status"]["active"] == 1 and d["counts_by_status"]["trial"] == 1, d
assert d["total_active_employees"] == 2, d  # Factory A now has 2 active (after 1 deactivation), Factory B has 0
print("Dashboard summary counts: PASSED")

print("\nALL ASSERTIONS PASSED")
