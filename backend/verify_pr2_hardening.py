"""Verifies /health checks the database, and /workers/ocr rejects oversized
or non-image uploads cleanly (400/413, not a 500).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_pr2_hardening.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient

from database import Base, engine
from main import app, get_db

Base.metadata.create_all(bind=engine)
client = TestClient(app)

r = client.get("/health")
assert r.status_code == 200 and r.json()["status"] == "ok", r.text


class _BrokenDb:
    def execute(self, *a, **k):
        raise RuntimeError("db down")


app.dependency_overrides[get_db] = lambda: _BrokenDb()
r = client.get("/health")
assert r.status_code == 503, r.text
app.dependency_overrides.clear()

s = client.post("/owners/signup", json={"name": "Hard Owner", "mobile": "9000000866", "password": "pass12345", "factory_name": "Hard Factory", "consent_given": True})
assert s.status_code == 201, s.text
h = {"Authorization": f"Bearer {s.json()['access_token']}"}

big = client.post("/workers/ocr", headers=h, files={"front_image": ("a.jpg", b"0" * (8 * 1024 * 1024 + 10), "image/jpeg")})
assert big.status_code == 413, big.text
bad = client.post("/workers/ocr", headers=h, files={"front_image": ("a.jpg", b"not an image", "image/jpeg")})
assert bad.status_code == 400, bad.text
print("verify_pr2_hardening: OK")
