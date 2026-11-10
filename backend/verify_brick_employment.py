"""Verifies the Brick and Tiles Manufacturing employment and the per-factory worker types:
all 73 classes with the notification's Basic rates, the minimum (Basic + DA) for daily and
monthly classes, piece-rate classes left unchecked, the DA past its published period flagged,
rice-mill DA history, worker types created when a factory picks its employment (also from the
industry at signup), picking a type giving the worker its class and rate, and the minimum-wage
error when a rate is below it.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_brick_employment.py
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
    brick = db.query(models.MinimumWageEmployment).filter_by(code=mw.BRICK_TILES).one()
    assert db.query(models.MinimumWageClass).filter_by(employment_id=brick.id).count() == 73
    r = mw.MinimumWageResolver(db)
    by_name = {c.name: c for c in r.classes.values() if c.employment_id == brick.id}
    TODAY = date(2026, 11, 10)

    def minimum(name, on=TODAY):
        m = r.minimum_as_of(by_name[name].id, on)
        return m["minimum"] if m else None

    # monthly classes: Basic + 236.60 x 30 (= 7,098)
    assert minimum("Blacksmiths") == 13509 and minimum("Fitters") == 13599 and minimum("Die Makers") == 13599
    assert minimum("Foreman") == 14524 and minimum("Technical Supervisor") == 14162 and minimum("Office boy") == 13145
    assert minimum("Maistry with more than 12 years of service as Maistry") == 13857
    # daily classes: Basic + 236.60
    assert minimum("Mould Helpers") == 461.60 and minimum("Kiln burners") == 461.60
    assert minimum("Helpers") == 451.60 and minimum("Other workers not specified in Groups I, II and IV") == 451.60
    assert minimum("Tile makers (Mosaic)") == 495.60 and minimum("Mixer (Mosaic)") == 461.60
    assert minimum("Fireman, kiln") == 479.60
    # group sizes as in the notification
    from collections import Counter
    sizes = Counter(c.group_name for c in by_name.values())
    assert sizes == {"Group I - Skilled": 10, "Group II - Grade I": 13, "Group III - Grade II": 25, "Group IV - Staff": 9,
                     "Mosaic Tiles Manufacturing": 5, "Brick Manufacturing (piece rate / special)": 11}, sizes
    # piece-rate classes: published per quantity, so no automatic minimum
    chamber = by_name["Chamber bricks"]
    assert chamber.rate_type == "piece" and chamber.unit == "1,000 bricks" and minimum("Chamber bricks") is None
    chk = r.check(chamber.id, "daily", 1000, 0, TODAY)
    assert chk["available"] is False and chk["piece_rate"] is True, chk
    # the published DA ended 31 Mar 2026: still used, but flagged until a revision is added
    assert r.minimum_as_of(by_name["Helpers"].id, date(2026, 3, 31))["da_stale"] is False
    assert r.minimum_as_of(by_name["Helpers"].id, TODAY)["da_stale"] is True
    assert r.minimum_as_of(by_name["Helpers"].id, date(2025, 3, 31)) is None  # before any DA existed
    # rice mills: 2025-26 DA 291.20, then 292.80
    rice = db.query(models.MinimumWageEmployment).filter_by(code=mw.TN_RICE_FLOUR_DHALL).one()
    hamali = next(c for c in r.classes.values() if c.employment_id == rice.id and c.name == "Hamalis (Bag Carriers)")
    assert r.minimum_as_of(hamali.id, date(2025, 10, 1))["minimum"] == 270.50 + 291.20
    assert r.minimum_as_of(hamali.id, TODAY)["minimum"] == 563.30 and r.minimum_as_of(hamali.id, TODAY)["da_stale"] is False

client = TestClient(app)
def signup(mobile, name, industry=None):
    body = {"name": name, "mobile": mobile, "password": "pass12345", "factory_name": name, "consent_given": True}
    if industry:
        body["industry"] = industry
    s = client.post("/owners/signup", json=body)
    assert s.status_code == 201, s.text
    return {"Authorization": f"Bearer {s.json()['access_token']}"}

# A factory that signs up as a brick-and-tiles factory gets the employment and ALL its classes as worker types
hb = signup("9000000951", "Brick Factory", "brick_tiles")
me = client.get("/owners/me", headers=hb).json()
assert me["min_wage_employment_id"] is not None, me
types = client.get("/worker-types", headers=hb).json()
assert len(types) == 73, len(types)
by_type = {t["name"]: t for t in types}
assert "Plumber" not in by_type  # the generic starter types are not created for a scheduled employment
fire = by_type["Fireman, kiln"]
assert fire["min_wage_class_id"] and fire["default_rate_type"] == "daily" and fire["default_rate"] == 479.60 and fire["default_basic"] == 243 and fire["default_da"] == 236.60, fire
clerk = by_type["Clerk"]
assert clerk["default_rate_type"] == "monthly" and clerk["default_rate"] == 13694 and clerk["default_basic"] == 6596 and clerk["default_da"] == 7098, clerk
piece = by_type["Country bricks"]
assert piece["piece_rate"] is True and piece["default_rate"] == 0 and piece["unit"] == "1,000 bricks", piece

# picking a type gives the worker its class and a rate of Basic + DA (never below the minimum)
w = client.post("/workers", headers=hb, json={"name": "Kiln Fireman", "aadhaar_number": "555511112225"}).json()
a = client.put(f"/workers/{w['id']}/worker-type", headers=hb, json={"worker_type_id": fire["id"]})
assert a.status_code == 200 and a.json()["min_wage_class_id"] == fire["min_wage_class_id"], a.text
wp = client.get(f"/workers/{w['id']}/wage-profile", headers=hb).json()
assert wp["basic"] == 243 and wp["da"] == 236.60 and wp["rate_type"] == "daily", wp
# a piece-rate type gives the class but creates no wage profile (paid per quantity)
w2 = client.post("/workers", headers=hb, json={"name": "Brick Maker", "aadhaar_number": "555511114448"}).json()
assert client.put(f"/workers/{w2['id']}/worker-type", headers=hb, json={"worker_type_id": piece["id"]}).json()["min_wage_class_id"] == piece["min_wage_class_id"]
assert client.get(f"/workers/{w2['id']}/wage-profile", headers=hb).status_code == 404
# ...and the minimum-wage error: below Basic + DA is refused, exactly the minimum is accepted
def rate(wid, basic, da, rate_type="daily"):
    return client.post(f"/workers/{wid}/wage-profile", headers=hb, json={"rate_type": rate_type, "basic": basic, "hra": 0, "da": da, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-11-10"})
bad = rate(w["id"], 200, 0)
assert bad.status_code == 422 and "Below the minimum wage for Fireman, kiln" in bad.json()["detail"], bad.text
assert rate(w["id"], 243, 236.60).status_code == 201
# a piece-rate worker has no automatic minimum to fall under
assert rate(w2["id"], 100, 0).status_code == 201
# monthly staff: 6,596 + 7,098 = 13,694
w3 = client.post("/workers", headers=hb, json={"name": "Office Clerk", "aadhaar_number": "555511117003"}).json()
client.put(f"/workers/{w3['id']}/worker-type", headers=hb, json={"worker_type_id": clerk["id"]})
assert rate(w3["id"], 13000, 0, "monthly").status_code in (201, 422)  # profile already auto-created at 13,694 by the type
assert rate(w3["id"], 6596, 0, "monthly").status_code == 422
# employments list: both, piece-rate flagged, DA stale flagged
emps = client.get("/minimum-wages/employments", headers=hb).json()
b = next(e for e in emps if e["code"] == "tn_brick_tiles")
assert len(b["classes"]) == 73 and b["da_value"] == 236.60 and b["da_stale"] is True and b["da_valid_to"] == "2026-03-31", b
pc = next(c for c in b["classes"] if c["name"] == "Chamber bricks")
assert pc["piece_rate"] is True and pc["minimum"] is None and pc["basic"] == 610.39 and pc["group_name"].startswith("Brick Manufacturing"), pc

# Picking the employment by hand creates the types too, and is idempotent
hr = signup("9000000952", "Hand Pick Factory")
assert len(client.get("/worker-types", headers=hr).json()) == 3  # the generic starter types
rice_id = next(e for e in emps if e["code"] == "tn_rice_flour_dhall_mills")["id"]
assert client.put("/owners/me/minimum-wage-employment", headers=hr, json={"employment_id": rice_id}).status_code == 200
rt = client.get("/worker-types", headers=hr).json()
# the starter type "Electrician" has the same name as a rice-mill class: it is linked to it, not duplicated
assert len(rt) == 3 + 33 - 1, len(rt)
assert next(t for t in rt if t["name"] == "Electrician")["min_wage_class_id"] is not None
assert client.put("/owners/me/minimum-wage-employment", headers=hr, json={"employment_id": rice_id}).status_code == 200
assert len(client.get("/worker-types", headers=hr).json()) == 3 + 33 - 1  # no duplicates
ham = next(t for t in rt if t["name"] == "Hamalis (Bag Carriers)")
assert ham["default_rate"] == 563.30 and ham["default_basic"] == 270.50 and ham["default_da"] == 292.80, ham
# a rice-mill factory choosing its industry in Factory Profile gets the employment (only when none is chosen yet)
hp = signup("9000000953", "Rice Industry Factory")
fp = {"factory_name": "Rice Industry Factory", "industry": "rice_mill"}
assert client.put("/owners/me/factory-profile", headers=hp, json=fp).json()["min_wage_employment_id"] == rice_id
# tenancy: another factory's types are untouched
assert len(client.get("/worker-types", headers=hb).json()) == 73
print("verify_brick_employment: OK")
