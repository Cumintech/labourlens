"""Verifies the Wage Calculation tab's backend: per-worker wage
computation as JSON (same figures Form 15 prints), the factory-wide
monthly summary (totals = sum of the individual workers), the
factory-wide daily summary (a simpler day-scoped cost, not the
statutory monthly figure), a worker with no wage profile falling back
to zero rather than crashing or being omitted, and cross-owner scoping.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_wage_summary.py
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
    json={"name": "Wage Summary Owner A", "mobile": "9000000801", "password": "pass123", "factory_name": "Wage Summary Factory A"},
)
assert signup.status_code == 201, signup.text
token_a = signup.json()["access_token"]
headers_a = {"Authorization": f"Bearer {token_a}"}

am_shift = client.get("/shift-configs", headers=headers_a).json()[0]
assert am_shift["slot_key"] == "AM"
client.put(f"/shift-configs/{am_shift['id']}", headers=headers_a, json={"slot_key": "AM", "label": "AM", "start_time": "06:00", "end_time": "14:00"})

# --- Worker 1: daily rate, 3 days present in September, one with OT ---
w1 = client.post("/workers", headers=headers_a, json={"name": "Wage Worker One", "aadhaar_number": "555511112222"}).json()
client.post(f"/workers/{w1['id']}/wage-profile", headers=headers_a, json={"rate_type": "daily", "basic": 500, "hra": 0, "da": 0, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-09-01"})
for day, ot in (("2026-09-01", 0), ("2026-09-02", 0), ("2026-09-03", 4)):
    r = client.post("/attendance", headers=headers_a, json={"worker_id": w1["id"], "date": day, "slot": "AM", "status": "present", "overtime_hours": ot})
    assert r.status_code == 200, r.text

# --- Worker 2: monthly rate, no attendance marked at all this month ---
w2 = client.post("/workers", headers=headers_a, json={"name": "Wage Worker Two", "aadhaar_number": "555511113333"}).json()
client.post(f"/workers/{w2['id']}/wage-profile", headers=headers_a, json={"rate_type": "monthly", "basic": 15000, "hra": 0, "da": 0, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-09-01"})

# --- Worker 3: no wage profile at all ---
w3 = client.post("/workers", headers=headers_a, json={"name": "No Rate Worker", "aadhaar_number": "555511114444"}).json()

# --- Independently hand-computed expected figures for worker 1 ---
DAYS_WORKED = 3
BASIC_WAGE = 500 * DAYS_WORKED  # 1500
HOURLY_RATE = 500 / 8  # 62.5
OT_WAGES = 4 * HOURLY_RATE * 2  # 500
GROSS_W1 = BASIC_WAGE + OT_WAGES  # 2000
NET_W1 = GROSS_W1  # no PF/ESI/LWF set

# --- Per-worker wage computation endpoint ---
w1_wage = client.get(f"/workers/{w1['id']}/wage-computation", headers=headers_a, params={"month": 9, "year": 2026})
assert w1_wage.status_code == 200, w1_wage.text
body = w1_wage.json()
assert body["has_rate"] is True, body
assert body["days_worked"] == DAYS_WORKED, body
assert abs(body["gross_wage"] - GROSS_W1) < 0.01, body
assert abs(body["net_wage"] - NET_W1) < 0.01, body
assert body["paid"] is False, body
# Full breakdown -- backs the wage detail view on the Wage Calculation tab.
assert body["rate_amount"] == 500 and body["rate_type"] == "daily", body
assert abs(body["basic_wage"] - BASIC_WAGE) < 0.01, body
assert abs(body["ot_wages"] - OT_WAGES) < 0.01, body
assert body["pf"] == 0 and body["esi"] == 0 and body["lwf"] == 0 and body["total_deductions"] == 0, body
assert body["days_absent"] >= 0, body
assert body["pf_rate"] == 0 and body["pf_base"] == body["basic_wage"], body  # DA=0 here, so PF base == basic wage
assert body["esi_rate"] == 0 and abs(body["esi_base"] - body["gross_wage"]) < 0.01, body
print("per-worker wage computation matches hand-computed expected value: PASSED")

w3_wage = client.get(f"/workers/{w3['id']}/wage-computation", headers=headers_a, params={"month": 9, "year": 2026})
assert w3_wage.status_code == 200, w3_wage.text
assert w3_wage.json()["has_rate"] is False, w3_wage.json()
assert w3_wage.json()["gross_wage"] == 0, w3_wage.json()
print("per-worker wage computation for a worker with no wage profile: falls back to zero, doesn't crash: PASSED")

# --- Factory-wide monthly summary ---
summary = client.get("/wage-summary", headers=headers_a, params={"month": 9, "year": 2026})
assert summary.status_code == 200, summary.text
sbody = summary.json()
assert sbody["total_workers"] == 3, sbody
by_name = {w["worker_name"]: w for w in sbody["workers"]}
assert abs(by_name["Wage Worker One"]["gross_wage"] - GROSS_W1) < 0.01, sbody
assert by_name["Wage Worker Two"]["gross_wage"] == 15000, sbody
assert by_name["No Rate Worker"]["has_rate"] is False, sbody
expected_total_gross = GROSS_W1 + 15000
assert abs(sbody["total_gross"] - expected_total_gross) < 0.01, f"expected total_gross {expected_total_gross}, got {sbody['total_gross']}"
print("factory-wide monthly wage summary: totals match the sum of individual workers: PASSED")

# --- Factory-wide daily summary ---
daily = client.get("/wage-summary/daily", headers=headers_a, params={"date": "2026-09-03"})
assert daily.status_code == 200, daily.text
dbody = daily.json()
assert dbody["total_workers_present"] == 1, dbody  # only worker 1 marked present on this date
expected_daily_cost = 500 + OT_WAGES  # daily rate + that day's OT
assert abs(dbody["total_daily_cost"] - expected_daily_cost) < 0.01, dbody
worker1_daily = next(w for w in dbody["workers"] if w["worker_name"] == "Wage Worker One")
assert worker1_daily["present"] is True and abs(worker1_daily["daily_cost"] - expected_daily_cost) < 0.01, worker1_daily
worker2_daily = next(w for w in dbody["workers"] if w["worker_name"] == "Wage Worker Two")
assert worker2_daily["present"] is False and worker2_daily["daily_cost"] == 0, worker2_daily
print("factory-wide daily wage summary: correct present-worker cost, absent workers cost zero: PASSED")

# --- Cross-owner scoping ---
signup_b = client.post(
    "/owners/signup",
    json={"name": "Wage Summary Owner B", "mobile": "9000000802", "password": "pass123", "factory_name": "Wage Summary Factory B"},
)
token_b = signup_b.json()["access_token"]
headers_b = {"Authorization": f"Bearer {token_b}"}

summary_b = client.get("/wage-summary", headers=headers_b, params={"month": 9, "year": 2026})
assert summary_b.status_code == 200 and summary_b.json()["total_workers"] == 0, summary_b.text
daily_b = client.get("/wage-summary/daily", headers=headers_b, params={"date": "2026-09-03"})
assert daily_b.status_code == 200 and daily_b.json()["total_workers_present"] == 0, daily_b.text
cross = client.get(f"/workers/{w1['id']}/wage-computation", headers=headers_b, params={"month": 9, "year": 2026})
assert cross.status_code == 404, cross.text
print("cross-owner scoping on wage summaries: owner B never sees owner A's workers: PASSED")

print("\nALL ASSERTIONS PASSED")
