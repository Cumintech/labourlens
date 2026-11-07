"""Verifies compute_wage_bulk / compute_daily_wage_bulk return exactly the
same figures as the per-worker functions (daily, weekly, monthly, OT, paid
leave, absent/LOP, no-rate, paid), and that the bulk path uses a fixed
number of queries regardless of worker count.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_wage_bulk.py
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient
from sqlalchemy import event

import forms
from database import Base, SessionLocal, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)
s = client.post("/owners/signup", json={"name": "Bulk Owner", "mobile": "9000000855", "password": "pass12345", "factory_name": "Bulk Factory", "consent_given": True})
assert s.status_code == 201, s.text
h = {"Authorization": f"Bearer {s.json()['access_token']}"}
owner_id = s.json()["owner"]["id"]

AADHAARS = ["555500015838", "555500166299", "555500182137", "555500348436", "555500586006"]
ids = []
for i, a in enumerate(AADHAARS):
    r = client.post("/workers", headers=h, json={"name": f"Bulk Worker {i}", "aadhaar_number": a})
    assert r.status_code == 201, r.text
    w = r.json()
    ids.append(w["id"])

def wage(wid, rate_type, basic, pf=0.0):
    r = client.post(f"/workers/{wid}/wage-profile", headers=h, json={"rate_type": rate_type, "basic": basic, "hra": 100, "da": 50, "other_allowances": 0, "pf_rate": pf, "esi_rate": 0, "lwf_amount": 5, "effective_from": "2026-01-01"})
    assert r.status_code in (200, 201), r.text

wage(ids[0], "daily", 500, pf=12)
wage(ids[1], "monthly", 30000)
wage(ids[2], "weekly", 7000)
# ids[3] has no rate
wage(ids[4], "daily", 400)
for day, ot in (("2026-09-01", 0), ("2026-09-02", 3)):
    assert client.post("/attendance", headers=h, json={"worker_id": ids[0], "date": day, "slot": "AM", "status": "present", "overtime_hours": ot}).status_code == 200
for day in ("2026-09-02", "2026-09-03"):
    assert client.post("/attendance", headers=h, json={"worker_id": ids[1], "date": day, "slot": "AM", "status": "absent", "overtime_hours": 0}).status_code == 200
lv = client.post(f"/workers/{ids[4]}/leave", headers=h, json={"leave_type": "earned", "date_from": "2026-09-10", "date_to": "2026-09-11", "days": 2, "wages_paid": 800})
assert lv.status_code in (200, 201), lv.text

db = SessionLocal()
statements = []
event.listen(engine, "before_cursor_execute", lambda *a: statements.append(1))
bulk = forms.compute_wage_bulk(db, owner_id, ids, 9, 2026)
n_bulk = len(statements)
for wid in ids:
    single = forms.compute_wage(db, owner_id, wid, 9, 2026)
    b = bulk[wid]
    if single is None:
        assert b is None, wid
        continue
    for k in ("basic_wage", "ot_wages", "leave_wages", "gross", "pf", "esi", "lwf", "total_deductions", "net"):
        assert abs(single[k] - b[k]) < 1e-9, (wid, k, single[k], b[k])
    assert single["summary"] == b["summary"], wid
    assert (single["payment"] is None) == (b["payment"] is None)
assert n_bulk <= 6, n_bulk  # fixed query count, not per worker

d = date(2026, 9, 2)
dbulk = forms.compute_daily_wage_bulk(db, ids, d)
for wid in ids:
    assert dbulk[wid] == forms.compute_daily_wage(db, wid, d), (wid, dbulk[wid])
assert dbulk[ids[0]]["present"] is True and dbulk[ids[3]]["has_rate"] is False
# the HTTP summaries still work through the bulk path
ws = client.get("/wage-summary", headers=h, params={"month": 9, "year": 2026}).json()
assert ws["total_workers"] == 5 and len(ws["workers"]) == 5
assert client.get("/wage-summary/daily", headers=h, params={"date": "2026-09-02"}).status_code == 200
print(f"verify_wage_bulk: OK ({n_bulk} queries for {len(ids)} workers)")
