"""Verifies the statutory minimum-wage logic: TN Rice/Flour/Dhall Mills seed
(33 classes), Basic and DA versioned separately, unit conversion, the
comparison API, class assignment and the wage-computation integration.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_minimum_wage.py
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient

import minimum_wage as mw
import models
from database import Base, SessionLocal, engine
from main import app

Base.metadata.create_all(bind=engine)
with SessionLocal() as db:
    mw.seed_reference_data(db)
    mw.seed_reference_data(db)  # idempotent
    assert db.query(models.MinimumWageClass).count() == 33
    assert db.query(models.MinimumWageBasicVersion).count() == 33
    assert db.query(models.MinimumWageDaVersion).count() == 1

# --- pure maths -----------------------------------------------------------
assert mw.minimum_for("daily", 270.50, 292.80) == 563.30
assert mw.minimum_for("monthly", 7632, 292.80) == 16416.00  # 7632 + 8784
assert mw.minimum_for("monthly", 7363, 292.80) == 16147.00
assert mw.convert_amount(16416, "monthly", "daily") == 16416 / 26
assert abs(mw.convert_amount(630.0, "daily", "monthly") - 16380.0) < 1e-9
assert mw.convert_amount(100, "daily", "daily") == 100

# --- whole table vs the Government Order's calculated minimums ------------
TODAY = date(2026, 11, 7)
with SessionLocal() as db:
    r = mw.MinimumWageResolver(db)
    by_name = {c.name: c for c in r.classes.values()}
    for _sl, name, rate_type, basic in mw.TN_RICE_FLOUR_DHALL_CLASSES:
        m = r.minimum_as_of(by_name[name].id, TODAY)
        want = round(basic + (292.80 if rate_type == "daily" else 8784), 2)
        assert m["minimum"] == want and m["rate_type"] == rate_type, (name, m, want)
    assert r.minimum_as_of(by_name["Hamalis (Bag Carriers)"].id, TODAY)["minimum"] == 563.30
    assert r.minimum_as_of(by_name["Engine Driver"].id, TODAY)["minimum"] == 571.80
    assert r.minimum_as_of(by_name["Clerk"].id, TODAY)["minimum"] == 16416
    assert r.minimum_as_of(by_name["Attenders"].id, TODAY)["minimum"] == 16147
    # before any DA version existed -> no minimum (never a guess)
    assert r.minimum_as_of(by_name["Clerk"].id, date(2026, 3, 31)) is None
    hamali = by_name["Hamalis (Bag Carriers)"].id
    clerk = by_name["Clerk"].id

    # Daily worker vs daily class (Basic + DA compared)
    c = r.check(hamali, "daily", 270.50, 292.80, TODAY)
    assert c["available"] and c["meets"] and c["shortfall"] == 0 and c["unit"] == "day"
    c = r.check(hamali, "daily", 270.50, 0, TODAY)  # forgot DA
    assert not c["meets"] and c["shortfall"] == 292.80, c
    # Monthly worker vs daily class: monthly / 26
    c = r.check(hamali, "monthly", 14638, 0, TODAY)  # 563.0/day
    assert not c["meets"] and c["proposed"] == 563.0 and c["shortfall"] == 0.3, c
    assert r.check(hamali, "monthly", 14664, 0, TODAY)["meets"]  # 564/day
    # Daily worker vs monthly class: daily x 26
    c = r.check(clerk, "daily", 631.38, 0, TODAY)  # 16415.88/month
    assert not c["meets"] and c["unit"] == "month" and c["minimum_per_day"] == 631.38, c
    assert r.check(clerk, "monthly", 16416, 0, TODAY)["meets"]
    assert r.check(None, "daily", 1, 0, TODAY)["available"] is False

# --- Basic and DA versioned separately: a DA revision never touches Basic ---
with SessionLocal() as db:
    emp = db.query(models.MinimumWageEmployment).one()
    db.add(models.MinimumWageDaVersion(employment_id=emp.id, da_value=300.0, effective_from=date(2027, 4, 1), verified=True, source="test"))
    db.commit()
    basics_before = db.query(models.MinimumWageBasicVersion).count()
    r = mw.MinimumWageResolver(db)
    hamali = db.query(models.MinimumWageClass).filter_by(name="Hamalis (Bag Carriers)").one().id
    assert r.minimum_as_of(hamali, date(2027, 3, 31))["minimum"] == 563.30  # history intact
    assert r.minimum_as_of(hamali, date(2027, 4, 1))["minimum"] == 570.50  # new DA, same Basic
    assert r.minimum_as_of(hamali, date(2027, 4, 1))["da_verified"] is True
    assert db.query(models.MinimumWageBasicVersion).count() == basics_before
    # remove the test version so later checks use today's rate only
    db.query(models.MinimumWageDaVersion).filter_by(source="test").delete()
    db.commit()

# --- API ---------------------------------------------------------------------
client = TestClient(app)
def signup(mobile, name):
    s = client.post("/owners/signup", json={"name": name, "mobile": mobile, "password": "pass12345", "factory_name": name, "consent_given": True})
    assert s.status_code == 201, s.text
    return {"Authorization": f"Bearer {s.json()['access_token']}"}
h = signup("9000000911", "MinWage A")
h2 = signup("9000000912", "MinWage B")
assert client.get("/minimum-wages/employments").status_code in (401, 403)

emps = client.get("/minimum-wages/employments", headers=h).json()
assert len(emps) == 1 and len(emps[0]["classes"]) == 33 and emps[0]["jurisdiction"] == "Tamil Nadu", emps
assert emps[0]["da_value"] == 292.80 and emps[0]["da_verified"] is False
emp_id = emps[0]["id"]
classes = {c["name"]: c for c in emps[0]["classes"]}
hamali_id, clerk_id = classes["Hamalis (Bag Carriers)"]["id"], classes["Clerk"]["id"]
assert classes["Hamalis (Bag Carriers)"]["minimum"] == 563.30 and classes["Clerk"]["minimum"] == 16416

chk = client.get("/minimum-wages/check", headers=h, params={"class_id": hamali_id, "rate_type": "daily", "basic": 500})
assert chk.status_code == 200 and chk.json()["meets"] is False and chk.json()["shortfall"] == 63.3, chk.text
assert client.get("/minimum-wages/check", headers=h, params={"class_id": hamali_id, "rate_type": "hourly", "basic": 5}).status_code == 422
assert client.get("/minimum-wages/check", headers=h, params={"class_id": hamali_id, "rate_type": "daily", "basic": -1}).status_code == 422
assert client.get("/minimum-wages/check", headers=h, params={"class_id": 9999, "rate_type": "daily", "basic": 1}).json()["available"] is False

w = client.post("/workers", headers=h, json={"name": "Min Wage Guy", "aadhaar_number": "555511112225"}).json()
assert "id" in w, w
wid = w["id"]
legacy = client.post(f"/workers/{wid}/wage-profile", headers=h, json={"rate_type": "daily", "basic": 400, "hra": 0, "da": 0, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-01-01"})
assert legacy.status_code == 201, legacy.text  # no class yet -> not checked
# class assignment needs the factory's employment first
assert client.put(f"/workers/{wid}/minimum-wage-class", headers=h, json={"class_id": hamali_id}).status_code == 422
o = client.put("/owners/me/minimum-wage-employment", headers=h, json={"employment_id": emp_id})
assert o.status_code == 200 and o.json()["min_wage_employment_id"] == emp_id, o.text
assert client.put("/owners/me/minimum-wage-employment", headers=h, json={"employment_id": 999}).status_code == 404
a = client.put(f"/workers/{wid}/minimum-wage-class", headers=h, json={"class_id": hamali_id})
assert a.status_code == 200 and a.json()["min_wage_class_id"] == hamali_id, a.text
# another owner cannot touch this worker
assert client.put(f"/workers/{wid}/minimum-wage-class", headers=h2, json={"class_id": hamali_id}).status_code == 404

# the legacy 400/day rate (saved before the class existed) now shows as below the minimum
g = client.get(f"/workers/{wid}/wage-computation", headers=h, params={"month": 11, "year": 2026}).json()
assert g["meets_min_wage"] is False and g["min_daily_wage"] == 563.3 and g["min_wage_class"] == "Hamalis (Bag Carriers)", g
assert g["min_wage_amount"] == 563.3 and g["min_wage_unit"] == "day" and g["min_wage_da_verified"] is False, g
def rate_raw(basic, da, rate_type="daily", eff="2026-01-01"):
    return client.post(f"/workers/{wid}/wage-profile", headers=h, json={"rate_type": rate_type, "basic": basic, "hra": 0, "da": da, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": eff})
def rate(basic, da, rate_type="daily", eff="2026-01-01"):
    r = rate_raw(basic, da, rate_type, eff)
    assert r.status_code in (200, 201), r.text

# A rate below the statutory minimum (Basic + DA) is refused once the worker has a class
bad = rate_raw(127, 0, eff="2026-11-01")
assert bad.status_code == 422 and "Below the minimum wage for Hamalis" in bad.json()["detail"] and "563.3" in bad.json()["detail"], bad.text
assert rate_raw(270.50, 0, eff="2026-11-01").status_code == 422          # forgot the DA: 270.5 < 563.3
assert rate_raw(14000, 0, "monthly", eff="2026-11-01").status_code == 422  # 14000/26 = 538.5/day
assert rate_raw(270.50, 292.80, eff="2026-11-01").status_code == 201       # exactly the minimum
assert rate_raw(127, 0, eff="2026-03-01").status_code == 201               # no DA in force that early: nothing to compare against
assert len(client.get(f"/workers/{wid}/wage-profile/history", headers=h).json()) == 3  # legacy + the two accepted; refused rates were not saved
# a worker with no class is not checked
nw = client.post("/workers", headers=h, json={"name": "No Class Worker", "aadhaar_number": "555511117003"}).json()
assert client.post(f"/workers/{nw['id']}/wage-profile", headers=h, json={"rate_type": "daily", "basic": 127, "hra": 0, "da": 0, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-11-01"}).status_code == 201
rate(270.50, 292.80, eff="2026-06-01")
g = client.get(f"/workers/{wid}/wage-computation", headers=h, params={"month": 11, "year": 2026}).json()
assert g["meets_min_wage"] is True and g["daily_equivalent_rate"] == 563.3, g
# a month before any DA existed: no comparison rather than a wrong one
g = client.get(f"/workers/{wid}/wage-computation", headers=h, params={"month": 2, "year": 2026}).json()
assert g["meets_min_wage"] is None and g["min_wage_class"] is None, g
s = client.get("/wage-summary", headers=h, params={"month": 11, "year": 2026}).json()
assert s["workers"][0]["meets_min_wage"] is True, s
# a worker with no class: no comparison
w2 = client.post("/workers", headers=h, json={"name": "No Class", "aadhaar_number": "555511114448"}).json()
client.post(f"/workers/{w2['id']}/wage-profile", headers=h, json={"rate_type": "daily", "basic": 1, "hra": 0, "da": 0, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-01-01"})
g2 = client.get(f"/workers/{w2['id']}/wage-computation", headers=h, params={"month": 11, "year": 2026}).json()
assert g2["meets_min_wage"] is None and g2["min_daily_wage"] == 0, g2
# changing the factory's employment clears now-foreign class assignments
client.put("/owners/me/minimum-wage-employment", headers=h, json={"employment_id": None})
assert client.get(f"/workers/{wid}", headers=h).json()["min_wage_class_id"] is None
print("verify_minimum_wage: OK")
