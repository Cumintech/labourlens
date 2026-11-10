"""Accounts created before usernames existed use their mobile number as the username
(it starts with a digit). That is valid to log in with, but not as a NEW username. The app
must therefore only send a username it is changing: saving the factory profile or adding
an email for such an account has to work without one.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_legacy_username.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient

import models
from database import Base, SessionLocal, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)
s = client.post("/owners/signup", json={"name": "Legacy Owner", "mobile": "9941851295", "password": "pass12345", "factory_name": "Salem Factory", "consent_given": True})
assert s.status_code == 201, s.text
# make this a legacy account: the mobile number is the username
with SessionLocal() as db:
    owner = db.query(models.Owner).filter_by(mobile="9941851295").one()
    owner.username = "9941851295"
    db.commit()
h = {"Authorization": f"Bearer {s.json()['access_token']}"}

# can still log in with the numeric username
login = client.post("/owners/login", json={"username": "9941851295", "password": "pass12345"})
assert login.status_code == 200, login.text
assert client.get("/owners/me", headers=h).json()["username"] == "9941851295"

# saving the factory profile never involves the username
fp = client.put("/owners/me/factory-profile", headers=h, json={"factory_name": "Salem Factory", "state": "Tamil Nadu", "industry": "rice_mill"})
assert fp.status_code == 200 and fp.json()["username"] == "9941851295", fp.text

# adding an email without sending the username works, and the username is kept
em = client.put("/owners/me/account", headers=h, json={"email": "owner@example.com"})
assert em.status_code == 200 and em.json()["email"] == "owner@example.com" and em.json()["username"] == "9941851295", em.text

# a NEW username still has to start with a letter (the rule the app applies to changed usernames only)
assert client.put("/owners/me/account", headers=h, json={"username": "9876543210"}).status_code == 422
assert client.put("/owners/me/account", headers=h, json={"username": "salem.owner"}).json()["username"] == "salem.owner"
print("verify_legacy_username: OK")
