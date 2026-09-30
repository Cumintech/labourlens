"""Verifies the two new v2-redesign endpoints:

- GET /home/alerts -- "Needs attention" list for the Today screen
  (missing Form 12 details, unmapped biometric devices, not marked
  for today).
- GET /month-end/{year}/{month} -- the 4-step month-end guided flow's
  progress (Attendance / Wages / Payments / Forms & slips), derived
  from real data.

Uses a past month (August 2026) for the month-end checks so the result
doesn't depend on the real system date, and the real system date for
the "not marked today" alert so it always matches the server's own
`date.today()`.

    DATABASE_URL=sqlite:///./scratch_monthend.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_month_end_and_alerts.py
"""
import sys
from datetime import date
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
    json={"name": "Month End Owner", "mobile": "9000009001", "password": "pass12345", "factory_name": "Month End Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# --- Worker 1: full August attendance, wage rate set, payment recorded ---
w1 = client.post("/workers", headers=headers, json={"name": "Full Worker", "aadhaar_number": _valid_aadhaar("60000000001"), "dob": "1990-01-01"}).json()
for day in range(1, 32):
    r = client.post("/attendance", headers=headers, json={"worker_id": w1["id"], "date": f"2026-08-{day:02d}", "slot": "AM", "status": "present", "overtime_hours": 0})
    assert r.status_code == 200, r.text
rate1 = client.post(f"/workers/{w1['id']}/wage-profile", headers=headers, json={"rate_type": "daily", "basic": 500, "hra": 0, "da": 0, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-08-01"})
assert rate1.status_code == 201, rate1.text

# --- Worker 2: only 10 of 31 August days marked, no wage rate ---
w2 = client.post("/workers", headers=headers, json={"name": "Partial Worker", "aadhaar_number": _valid_aadhaar("60000000002"), "dob": "1990-01-01"}).json()
for day in range(1, 11):
    r = client.post("/attendance", headers=headers, json={"worker_id": w2["id"], "date": f"2026-08-{day:02d}", "slot": "AM", "status": "present", "overtime_hours": 0})
    assert r.status_code == 200, r.text

# ============================================================
# Month-end: before any payment/forms activity
# ============================================================
me = client.get("/month-end/2026/8", headers=headers)
assert me.status_code == 200, me.text
steps = {s["key"]: s for s in me.json()["steps"]}

assert steps["attendance"]["complete"] is False, steps["attendance"]
assert steps["attendance"]["detail"] == "41 of 62 worker-days marked", steps["attendance"]  # 31 (w1) + 10 (w2) of 31*2
print("Month-end attendance step (2 workers, one partial): 41 of 62, not complete: PASSED")

assert steps["wages"]["complete"] is False, steps["wages"]
assert steps["wages"]["detail"] == "1 of 2 workers have a wage rate", steps["wages"]
print("Month-end wages step (1 of 2 rated): PASSED")

assert steps["payments"]["complete"] is False, steps["payments"]
assert steps["payments"]["detail"] == "0 of 1 paid", steps["payments"]
print("Month-end payments step (0 of 1 paid): PASSED")

assert steps["forms"]["complete"] is False, steps["forms"]
print("Month-end forms step (nothing generated yet): PASSED")

# ============================================================
# Record payment for worker 1 -> payments step completes
# ============================================================
pay = client.post(f"/workers/{w1['id']}/wage-payment", headers=headers, json={"month": 8, "year": 2026, "date_of_payment": "2026-09-01"})
assert pay.status_code in (200, 201), pay.text
me2 = client.get("/month-end/2026/8", headers=headers).json()
steps2 = {s["key"]: s for s in me2["steps"]}
assert steps2["payments"]["complete"] is True, steps2["payments"]
assert steps2["payments"]["detail"] == "1 of 1 paid", steps2["payments"]
print("Month-end payments step after recording payment (1 of 1): PASSED")

# ============================================================
# Generate a period-scoped form for August -> forms step completes
# (form12 is NOT period-scoped -- no start/end date, no period_label --
# so form25 is used here instead.)
# ============================================================
form_resp = client.get("/forms/form25", headers=headers, params={"start_date": "2026-08-01", "end_date": "2026-08-31"})
assert form_resp.status_code == 200, form_resp.text
me3 = client.get("/month-end/2026/8", headers=headers).json()
steps3 = {s["key"]: s for s in me3["steps"]}
assert steps3["forms"]["complete"] is True, steps3["forms"]
print("Month-end forms step after generating Form 25: PASSED")

# ============================================================
# Mark every worker fully present -> attendance step completes
# ============================================================
for day in range(11, 32):
    r = client.post("/attendance", headers=headers, json={"worker_id": w2["id"], "date": f"2026-08-{day:02d}", "slot": "AM", "status": "absent", "overtime_hours": 0})
    assert r.status_code == 200, r.text
me4 = client.get("/month-end/2026/8", headers=headers).json()
steps4 = {s["key"]: s for s in me4["steps"]}
assert steps4["attendance"]["complete"] is True, steps4["attendance"]
assert steps4["attendance"]["detail"] == "62 of 62 worker-days marked", steps4["attendance"]
print("Month-end attendance step after fully marking both workers: PASSED")

# ============================================================
# Home alerts
# ============================================================
alerts = client.get("/home/alerts", headers=headers)
assert alerts.status_code == 200, alerts.text
alert_by_code = {a["code"]: a for a in alerts.json()["alerts"]}

# Both workers have no Form 12 (WorkerCompliance) record yet.
assert alert_by_code["missing_compliance"]["count"] == 2, alert_by_code

# No biometric device registered yet -> no unmapped_devices alert at all.
assert "unmapped_devices" not in alert_by_code, alert_by_code
print("Home alerts (no device registered -> no unmapped_devices alert): PASSED")

device = client.post("/biometric/devices", headers=headers, json={"name": "Main Gate", "ip_address": "10.0.0.5"})
assert device.status_code == 201, device.text
device_id = device.json()["id"]

alerts2 = client.get("/home/alerts", headers=headers).json()
alert_by_code2 = {a["code"]: a for a in alerts2["alerts"]}
assert alert_by_code2["unmapped_devices"]["count"] == 2, alert_by_code2
print("Home alerts (device registered, both workers unmapped): PASSED")

consent = client.post(f"/workers/{w1['id']}/biometric-consent", headers=headers, json={"notice_text": "consent notice"})
assert consent.status_code == 201, consent.text
mapping = client.post("/biometric/device-mappings", headers=headers, json={"device_id": device_id, "device_user_id": "1001", "worker_id": w1["id"]})
assert mapping.status_code == 201, mapping.text

alerts3 = client.get("/home/alerts", headers=headers).json()
alert_by_code3 = {a["code"]: a for a in alerts3["alerts"]}
assert alert_by_code3["unmapped_devices"]["count"] == 1, alert_by_code3
print("Home alerts (one worker mapped -> unmapped count drops to 1): PASSED")

today = date.today().isoformat()
for worker_id in (w1["id"], w2["id"]):
    r = client.post("/attendance", headers=headers, json={"worker_id": worker_id, "date": today, "slot": "AM", "status": "present", "overtime_hours": 0})
    assert r.status_code == 200, r.text

alerts4 = client.get("/home/alerts", headers=headers).json()
alert_by_code4 = {a["code"]: a for a in alerts4["alerts"]}
assert "not_marked_today" not in alert_by_code4, alert_by_code4
print("Home alerts (both workers marked for today -> no not_marked_today alert): PASSED")

# ============================================================
# Cross-owner scoping: a second owner sees zero alerts and an empty
# month with no activity, never owner 1's data.
# ============================================================
signup_b = client.post(
    "/owners/signup",
    json={"name": "Owner B", "mobile": "9000009002", "password": "pass12345", "factory_name": "Factory B", "consent_given": True},
)
assert signup_b.status_code == 201, signup_b.text
headers_b = {"Authorization": f"Bearer {signup_b.json()['access_token']}"}

alerts_b = client.get("/home/alerts", headers=headers_b).json()
assert alerts_b["alerts"] == [], alerts_b

me_b = client.get("/month-end/2026/8", headers=headers_b).json()
steps_b = {s["key"]: s for s in me_b["steps"]}
assert steps_b["attendance"]["detail"] == "No active workers yet", steps_b["attendance"]
assert steps_b["forms"]["complete"] is False, steps_b["forms"]
print("Cross-owner scoping (owner B sees no alerts and an empty month): PASSED")

print("\nAll month-end / home-alerts checks PASSED")
