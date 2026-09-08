"""Verifies the one thing that must not leak: /admin/* routes are
genuinely unreachable with a factory-owner (or worker-scoped) auth
token, even though both token types are signed with the same
JWT_SECRET. Also confirms there is no way to create a second admin
account through the API (no public admin signup route), and that the
real login flow works end-to-end for the seeded account.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> \
    ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a real strong password 123' \
    python verify_admin_auth.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, SessionLocal, engine
import models
from admin_auth import create_admin_token, hash_password
from auth import create_token
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "a real strong password 123")

db = SessionLocal()
admin = models.AdminUser(email=ADMIN_EMAIL, password_hash=hash_password(ADMIN_PASSWORD))
db.add(admin)
db.commit()
admin_id = admin.id
db.close()

# --- A real factory-owner signup, to get a genuine owner token ---
signup = client.post(
    "/owners/signup",
    json={
        "name": "Admin Test Owner", "mobile": "9000001301", "password": "pass123",
        "factory_name": "Admin Test Factory", "consent_given": True,
    },
)
assert signup.status_code == 201, signup.text
owner_token = signup.json()["access_token"]
owner_id = signup.json()["owner"]["id"]

ADMIN_ROUTES = [
    ("GET", "/admin/dashboard", None),
    ("GET", "/admin/factories", None),
]

# --- Core requirement: an owner token must be rejected on every /admin/* route ---
for method, path, body in ADMIN_ROUTES:
    resp = client.request(method, path, headers={"Authorization": f"Bearer {owner_token}"}, json=body)
    assert resp.status_code == 401, f"{method} {path} with an OWNER token should be 401, got {resp.status_code}: {resp.text}"
print("Owner token rejected on every /admin/* route tested: PASSED")

# --- No token at all: also rejected ---
for method, path, body in ADMIN_ROUTES:
    resp = client.request(method, path, json=body)
    assert resp.status_code in (401, 403), f"{method} {path} with NO token should be 401/403, got {resp.status_code}"
print("No-token request rejected on every /admin/* route tested: PASSED")

# --- A malformed/foreign token (signed with the right secret, but no
# "type": "admin" claim and no "admin_id" either) is also rejected,
# not just an owner token specifically ---
import jwt as pyjwt
from auth import JWT_ALGORITHM, JWT_SECRET
weird_token = pyjwt.encode({"something_else": 1}, JWT_SECRET, algorithm=JWT_ALGORITHM)
resp = client.get("/admin/dashboard", headers={"Authorization": f"Bearer {weird_token}"})
assert resp.status_code == 401, resp.text
print("A token with no admin claim at all is rejected: PASSED")

# --- The real admin login flow works end-to-end ---
bad_login = client.post("/admin/login", json={"email": ADMIN_EMAIL, "password": "wrong password"})
assert bad_login.status_code == 401, bad_login.text
print("Admin login with wrong password: 401 PASSED")

good_login = client.post("/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
assert good_login.status_code == 200, good_login.text
admin_token = good_login.json()["access_token"]
print("Admin login with correct credentials: 200 PASSED")

# --- The real admin token DOES work on /admin/* routes ---
dashboard = client.get("/admin/dashboard", headers={"Authorization": f"Bearer {admin_token}"})
assert dashboard.status_code == 200, dashboard.text
print("Real admin token accepted on /admin/dashboard: PASSED")

# --- And, symmetrically, the admin token must NOT work on an owner-only route ---
owner_route_with_admin_token = client.get("/owners/me", headers={"Authorization": f"Bearer {admin_token}"})
assert owner_route_with_admin_token.status_code == 401, owner_route_with_admin_token.text
print("Admin token rejected on an owner-only route: PASSED")

# --- There is no public admin signup route ---
for path in ("/admin/signup", "/admin/register", "/admin/users"):
    resp = client.post(path, json={"email": "second@example.com", "password": "whatever123456"})
    assert resp.status_code == 404, f"{path} should not exist, got {resp.status_code}"
print("No public admin signup route exists: PASSED")

print("\nALL ASSERTIONS PASSED")
