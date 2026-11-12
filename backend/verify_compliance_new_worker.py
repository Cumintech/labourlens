"""A worker who joined this month must not be flagged for last month's wages / attendance, and the
dashboard only asks for what is actually required (bank is optional; biometric consent only with a device).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_compliance_new_worker.py
"""
import sys
from datetime import date, timedelta
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
s = client.post("/owners/signup", json={"name": "New Owner", "mobile": "9000000971", "password": "pass12345", "factory_name": "New Factory", "consent_given": True, "industry": "rice_mill"})
assert s.status_code == 201, s.text
h = {"Authorization": f"Bearer {s.json()['access_token']}"}
today = date.today()
last_month_end = today.replace(day=1) - timedelta(days=1)

def make(name, aadhaar, joined):
    w = client.post("/workers", headers=h, json={"name": name, "aadhaar_number": aadhaar, "dob": "1990-01-01", "gender": "Male", "employment_type": "permanent",
                    "current_address": "45 Mill Road", "native_address": "12 Gandhi Street"}).json()
    client.post(f"/workers/{w['id']}/compliance", headers=h, json={"father_or_spouse_name": "Muthu", "designation_or_nature_of_work": "Bag carrier", "date_of_joining": joined.isoformat()})
    types = {t["name"]: t for t in client.get("/worker-types", headers=h).json()}
    client.put(f"/workers/{w['id']}/worker-type", headers=h, json={"worker_type_id": types["Hamalis (Bag Carriers)"]["id"]})
    return w

def ids(check):
    return {i["key"]: i for i in check["items"]}

# joined today, all required info given: nothing about last month, no bank / consent items
make("Fresh Worker", "555511112225", today)
c = client.get("/compliance/check", headers=h).json()
got = ids(c)
for gone in ("last_month_unpaid", "attendance_unmarked_last_month", "no_bank_details", "no_biometric_consent", "form12_incomplete"):
    assert gone not in got or got[gone]["passed"], (gone, got.get(gone))

# a worker who was already there last month and has nothing recorded IS flagged
make("Old Worker", "555511114448", last_month_end - timedelta(days=40))
got = ids(client.get("/compliance/check", headers=h).json())
assert got["last_month_unpaid"]["affected"] == 1 and got["attendance_unmarked_last_month"]["affected"] == 1, got
print("ok")
