"""Verifies weekly/monthly wage proration with Loss of Pay, the 'contract'
employment type, and weekly rate_type acceptance.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_wage_lop.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient

from database import Base, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)
s = client.post("/owners/signup", json={"name": "LOP Owner", "mobile": "9000000877", "password": "pass12345", "factory_name": "LOP Factory", "consent_given": True})
assert s.status_code == 201, s.text
h = {"Authorization": f"Bearer {s.json()['access_token']}"}

w = client.post("/workers", headers=h, json={"name": "Contract Guy", "aadhaar_number": "555511112225", "employment_type": "contract"})
assert w.status_code in (200, 201), w.text
assert w.json()["employment_type"] == "contract", w.json()
bad = client.post("/workers", headers=h, json={"name": "X Y", "aadhaar_number": "555511113332", "employment_type": "bogus"})
assert bad.status_code == 422

def wage(wid, rate_type, basic):
    r = client.post(f"/workers/{wid}/wage-profile", headers=h, json={"rate_type": rate_type, "basic": basic, "hra": 0, "da": 0, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-01-01"})
    assert r.status_code in (200, 201), r.text

wid = w.json()["id"]
wage(wid, "monthly", 30000)  # September: 30 days -> 1000/day
for day in ("2026-09-02", "2026-09-03"):
    r = client.post("/attendance", headers=h, json={"worker_id": wid, "date": day, "slot": "AM", "status": "absent", "overtime_hours": 0})
    assert r.status_code == 200, r.text
g = client.get(f"/workers/{wid}/wage-computation", headers=h, params={"month": 9, "year": 2026}).json()
assert abs(g["basic_wage"] - 28000) < 0.01, g  # 2 LOP days deducted

w2 = client.post("/workers", headers=h, json={"name": "Weekly Guy", "aadhaar_number": "555511114448"}).json()
wage(w2["id"], "weekly", 7000)  # 1000/day, no attendance marked -> no LOP
g2 = client.get(f"/workers/{w2['id']}/wage-computation", headers=h, params={"month": 9, "year": 2026}).json()
assert g2["rate_type"] == "weekly" and abs(g2["basic_wage"] - 30000) < 0.01, g2
assert g["meets_min_wage"] is True and g["min_daily_wage"] == 500, g  # 30000/30 = 1000/day
wage(w2["id"], "daily", 400)
g3 = client.get(f"/workers/{w2['id']}/wage-computation", headers=h, params={"month": 9, "year": 2026}).json()
assert g3["meets_min_wage"] is False, g3
print("verify_wage_lop: OK")
