"""Verifies Day 2's registration flow against a real (throwaway) backend
via FastAPI's TestClient -- not mocks. Covers: OCR extraction from a real
image, worker creation with encrypted PII (checked at the raw-DB level,
same rigor as Day 1's auth verification), multi-tenant scoping, and the
50-worker-per-owner limit.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_registration.py
"""

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from database import Base, SessionLocal, engine
import models
from main import app


def _make_test_aadhaar_image() -> bytes:
    """Synthetic image with Aadhaar-shaped text -- self-contained, no
    external fixture file to keep around or lose track of."""
    img = Image.new("RGB", (600, 300), color="white")
    draw = ImageDraw.Draw(img)
    draw.text((20, 40), "SURESH PRASAD", fill="black")
    draw.text((20, 100), "DOB: 14/03/1985", fill="black")
    draw.text((20, 160), "MALE", fill="black")
    draw.text((20, 220), "1234 5678 9012", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

Base.metadata.create_all(bind=engine)
client = TestClient(app)

# --- Owner A: the one we'll actually exercise ---
signup_resp = client.post(
    "/owners/signup",
    json={"name": "Owner A", "mobile": "9000000001", "password": "pass123", "factory_name": "Factory A"},
)
assert signup_resp.status_code == 201, signup_resp.text
token_a = signup_resp.json()["access_token"]
headers_a = {"Authorization": f"Bearer {token_a}"}
print("owner A signed up")

# --- Owner B: only used to prove multi-tenant scoping ---
signup_resp_b = client.post(
    "/owners/signup",
    json={"name": "Owner B", "mobile": "9000000002", "password": "pass123", "factory_name": "Factory B"},
)
assert signup_resp_b.status_code == 201, signup_resp_b.text
token_b = signup_resp_b.json()["access_token"]
headers_b = {"Authorization": f"Bearer {token_b}"}
print("owner B signed up")

# --- OCR against a real (synthetic but genuinely OCR'd) image ---
test_image_bytes = _make_test_aadhaar_image()
ocr_resp = client.post(
    "/workers/ocr",
    headers=headers_a,
    files={"front_image": ("front.png", io.BytesIO(test_image_bytes), "image/png")},
)
assert ocr_resp.status_code == 200, ocr_resp.text
ocr_fields = ocr_resp.json()
print("OCR extracted:", ocr_fields)
assert ocr_fields.get("name") == "SURESH PRASAD", ocr_fields
assert ocr_fields.get("aadhaar_number") == "123456789012", ocr_fields
assert ocr_fields.get("gender") == "Male", ocr_fields

# --- Create a worker for Owner A using the OCR fields + manual additions ---
create_resp = client.post(
    "/workers",
    headers=headers_a,
    json={
        "name": ocr_fields["name"],
        "gender": ocr_fields["gender"],
        "aadhaar_number": ocr_fields["aadhaar_number"],
        "mobile": "9876543210",
        "current_address": "42 MG Road, Bengaluru",
        "current_district": "Bengaluru Urban",
    },
)
assert create_resp.status_code == 201, create_resp.text
worker = create_resp.json()
print("worker created:", worker)
assert worker["aadhaar_last4"] == "9012", worker
assert "aadhaar_number" not in worker, "raw Aadhaar must never appear in API responses"
assert "aadhaar_encrypted" not in worker, "encrypted column must never appear in API responses"

# --- Confirm PII is genuinely encrypted at rest, not just via the ORM ---
import sqlite3
db_path = None
import os
db_url = os.environ["DATABASE_URL"]
assert db_url.startswith("sqlite:///"), "this raw-DB check assumes the sqlite dev DB"
db_path = db_url.replace("sqlite:///", "")
conn = sqlite3.connect(db_path)
row = conn.execute(
    "SELECT aadhaar_encrypted, current_address, aadhaar_last4 FROM workers WHERE id=?", (worker["id"],)
).fetchone()
raw_aadhaar_encrypted, raw_address_encrypted, raw_last4 = row
assert raw_aadhaar_encrypted != "123456789012", f"Aadhaar stored in plaintext! {raw_aadhaar_encrypted!r}"
assert raw_address_encrypted != "42 MG Road, Bengaluru", f"Address stored in plaintext! {raw_address_encrypted!r}"
assert raw_last4 == "9012"
print(f"raw DB confirms encryption: aadhaar_encrypted={raw_aadhaar_encrypted[:20]}..., "
      f"current_address={raw_address_encrypted[:20]}...")

# --- Multi-tenant scoping: Owner B must not see Owner A's worker ---
list_resp_b = client.get("/workers", headers=headers_b)
assert list_resp_b.status_code == 200
assert len(list_resp_b.json()) == 0, "Owner B should see zero workers -- Owner A's worker leaked across tenants"

get_resp_b = client.get(f"/workers/{worker['id']}", headers=headers_b)
assert get_resp_b.status_code == 404, "Owner B fetched Owner A's worker by ID -- multi-tenant scoping broken"

list_resp_a = client.get("/workers", headers=headers_a)
assert list_resp_a.status_code == 200
assert len(list_resp_a.json()) == 1
print("multi-tenant scoping confirmed: Owner B cannot see or fetch Owner A's worker")

# --- 50-worker-per-owner limit ---
for i in range(49):  # 1 already created above, need 49 more to hit 50
    resp = client.post(
        "/workers",
        headers=headers_a,
        json={"name": f"Bulk Worker {i}", "aadhaar_number": f"{100000000000 + i}"},
    )
    assert resp.status_code == 201, f"worker {i}: {resp.text}"

count_resp = client.get("/workers", headers=headers_a)
assert len(count_resp.json()) == 50, f"expected exactly 50 workers, got {len(count_resp.json())}"

over_limit_resp = client.post(
    "/workers",
    headers=headers_a,
    json={"name": "One Too Many", "aadhaar_number": "999999999999"},
)
assert over_limit_resp.status_code == 422, over_limit_resp.text
print("50-worker-per-owner limit confirmed: 51st worker rejected with 422")

print("\nALL ASSERTIONS PASSED")
