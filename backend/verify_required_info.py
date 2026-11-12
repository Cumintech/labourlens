"""Verifies what is still missing for a worker (compliance gaps) and the confirm-to-save rule for a wage
below the statutory minimum.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_required_info.py
"""
import sys
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
client = TestClient(app)
s = client.post("/owners/signup", json={"name": "Req Owner", "mobile": "9000000961", "password": "pass12345", "factory_name": "Req Factory", "consent_given": True, "industry": "rice_mill"})
assert s.status_code == 201, s.text
h = {"Authorization": f"Bearer {s.json()['access_token']}"}

keys = lambda items: {i["key"] for i in items}
# A worker added with only a name and Aadhaar: every required item is flagged, optional ones listed separately
w = client.post("/workers", headers=h, json={"name": "Bare Worker", "aadhaar_number": "555511112225"}).json()
g = client.get(f"/workers/{w['id']}/compliance-gaps", headers=h).json()
assert keys(g["required"]) == {"dob", "gender", "present_address", "permanent_address", "father_or_spouse_name", "nature_of_work", "date_of_joining", "employment_type", "wage"}, g
assert keys(g["optional"]) == {"epf_uan_no", "esic_no", "blood_group", "mobile", "bank_account_number"}, g
assert g["wage_below_minimum"] is None

# Everything asked at creation, EPF/ESIC/bank/blood group/mobile left out: nothing required is missing
full = client.post("/workers", headers=h, json={
    "name": "Full Worker", "aadhaar_number": "555511114448", "dob": "1990-01-01", "gender": "Male", "employment_type": "permanent",
    "current_address": "45 Mill Road", "native_address": "12 Gandhi Street"}).json()
client.post(f"/workers/{full['id']}/compliance", headers=h, json={"father_or_spouse_name": "Muthu", "designation_or_nature_of_work": "Bag carrier", "date_of_joining": "2026-11-01"})
types = {t["name"]: t for t in client.get("/worker-types", headers=h).json()}
client.put(f"/workers/{full['id']}/worker-type", headers=h, json={"worker_type_id": types["Hamalis (Bag Carriers)"]["id"]})  # also creates the wage at the minimum
g = client.get(f"/workers/{full['id']}/compliance-gaps", headers=h).json()
assert g["required"] == [] and g["wage_below_minimum"] is None, g
assert keys(g["optional"]) == {"epf_uan_no", "esic_no", "blood_group", "mobile", "bank_account_number"}, g
# a temporary worker is not covered by EPF / ESIC: those are not even listed
tmp = client.post("/workers", headers=h, json={"name": "Temp Worker", "aadhaar_number": "555511117003", "employment_type": "temporary"}).json()
assert not ({"epf_uan_no", "esic_no"} & keys(client.get(f"/workers/{tmp['id']}/compliance-gaps", headers=h).json()["optional"]))

# Below the minimum: refused without confirmation, saved with it, audit-logged and flagged
def rate(basic, ack=None):
    body = {"rate_type": "daily", "basic": basic, "hra": 0, "da": 0, "other_allowances": 0, "pf_rate": 0, "esi_rate": 0, "lwf_amount": 0, "effective_from": "2026-11-12"}
    if ack is not None:
        body["acknowledge_below_minimum"] = ack
    return client.post(f"/workers/{full['id']}/wage-profile", headers=h, json=body)
assert rate(300).status_code == 422
assert rate(300, False).status_code == 422
ok = rate(300, True)
assert ok.status_code == 201 and ok.json()["basic"] == 300, ok.text
g = client.get(f"/workers/{full['id']}/compliance-gaps", headers=h).json()
b = g["wage_below_minimum"]
assert b and b["offered"] == 300 and b["minimum"] == 563.3 and b["shortfall"] == 263.3 and b["unit"] == "day", g
with SessionLocal() as db:
    log = db.query(models.AuditLog).filter_by(worker_id=full["id"], action="wage_below_minimum_confirmed").all()
    assert len(log) == 1 and "short by Rs 263.3" in log[0].reason, [l.reason for l in log]
# raising it clears the flag; an at-minimum rate needs no confirmation and logs nothing more
assert rate(563.30).status_code == 201
assert client.get(f"/workers/{full['id']}/compliance-gaps", headers=h).json()["wage_below_minimum"] is None
with SessionLocal() as db:
    assert db.query(models.AuditLog).filter_by(worker_id=full["id"], action="wage_below_minimum_confirmed").count() == 1
# another owner cannot read this worker's gaps
h2 = {"Authorization": "Bearer " + client.post("/owners/signup", json={"name": "Other", "mobile": "9000000962", "password": "pass12345", "factory_name": "Other", "consent_given": True}).json()["access_token"]}
assert client.get(f"/workers/{full['id']}/compliance-gaps", headers=h2).status_code == 404
print("verify_required_info: OK")
