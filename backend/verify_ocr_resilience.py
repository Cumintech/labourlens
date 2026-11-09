"""Verifies the OCR endpoint degrades gracefully: an unavailable or
out-of-memory engine answers 503 with an "enter manually" message (never a
crash/502), and a joined address has no doubled commas.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_ocr_resilience.py
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient
from PIL import Image

import ocr
from database import Base, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)
s = client.post("/owners/signup", json={"name": "Ocr Owner", "mobile": "9000000931", "password": "pass12345", "factory_name": "Ocr Factory", "consent_given": True})
assert s.status_code == 201, s.text
h = {"Authorization": f"Bearer {s.json()['access_token']}"}

buf = io.BytesIO()
Image.new("RGB", (400, 250), "white").save(buf, format="JPEG")
files = lambda: {"front_image": ("f.jpg", buf.getvalue(), "image/jpeg")}

def raise_(exc):
    def _f(*a, **k):
        raise exc
    return _f

orig = ocr._get_engine
try:
    ocr._get_engine = raise_(ocr.OcrUnavailable("ImportError"))
    r = client.post("/workers/ocr", headers=h, files=files())
    assert r.status_code == 503 and "manually" in r.json()["detail"], r.text
    ocr._get_engine = raise_(MemoryError())
    r = client.post("/workers/ocr", headers=h, files=files())
    assert r.status_code == 503 and "manually" in r.json()["detail"], r.text
finally:
    ocr._get_engine = orig

# A blank card is a valid scan that finds nothing -- 200 with no fields, not an error.
r = client.post("/workers/ocr", headers=h, files=files())
assert r.status_code == 200, r.text
assert not any(r.json().get(k) for k in ("name", "aadhaar_number", "dob")), r.json()

# Either side can be scanned alone (the app scans the front while the back is photographed)
only_back = client.post("/workers/ocr", headers=h, files={"back_image": ("b.jpg", buf.getvalue(), "image/jpeg")})
assert only_back.status_code == 200, only_back.text
none = client.post("/workers/ocr", headers=h)
assert none.status_code == 422, none.text

# Warm-up call: 204 when signed in, refused when not, and never an error if the engine can't load
assert client.post("/workers/ocr/warm", headers=h).status_code == 204
assert client.post("/workers/ocr/warm").status_code in (401, 403)
try:
    ocr._get_engine = raise_(ocr.OcrUnavailable("ImportError"))
    assert client.post("/workers/ocr/warm", headers=h).status_code == 204
finally:
    ocr._get_engine = orig

# Lines ending in commas must not produce ",," when joined
addr = ocr._guess_address(["Address:", "S/O Muthu, 12, Gandhi Street,", "Anna Nagar, Madurai,", "Tamil Nadu - 625020"])
assert addr and ",," not in addr.replace(" ", "") and addr.endswith("625020"), addr
print("verify_ocr_resilience: OK")
