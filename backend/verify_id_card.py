"""Verifies the worker ID-card feature end to end: upload a photo,
confirm WorkerOut reflects it (photo_key set) without exposing the raw
key as anything but an opaque marker, generate the ID card PDF, and
confirm it's a real, small PDF. Also confirms the size guard rejects an
oversized upload, and that "ID Card" shows up in /form-templates
regardless of which state is selected (it isn't a per-state statutory
form the way everything else in that list is).

Uses PHOTO_STORAGE_ALLOW_LOCAL_FALLBACK=true -- this test has no real
Supabase credentials to exercise the actual production storage path
against; see photo_storage.py's own docstring for why local disk is
fine for this test but not for the real Render deployment.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> \
    PHOTO_STORAGE_ALLOW_LOCAL_FALLBACK=true PHOTO_STORAGE_DIR=./scratch_photos \
    python verify_id_card.py
"""
import io
import os
import random
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from PIL import Image

from database import Base, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def make_jpeg(width: int, height: int, quality: int = 65, noisy: bool = False) -> bytes:
    # A flat-color image compresses to almost nothing regardless of
    # requested quality, so a real oversized-photo test needs genuine
    # per-pixel noise (like a real photograph) to actually land above
    # the size limit being tested.
    if noisy:
        random.seed(0)
        pixels = bytes(random.randrange(256) for _ in range(width * height * 3))
        img = Image.frombytes("RGB", (width, height), pixels)
    else:
        img = Image.new("RGB", (width, height), color=(120, 130, 150))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


signup = client.post(
    "/owners/signup",
    json={
        "name": "ID Card Owner",
        "mobile": "9000001801",
        "password": "pass123",
        "factory_name": "Sunrise Textiles Private Limited",
        "factory_address": "42 Industrial Estate, Salem, Tamil Nadu 636001",
        "consent_given": True,
    },
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

worker = client.post("/workers", headers=headers, json={"name": "Kumar Selvam", "aadhaar_number": "222233334444"}).json()

# --- Before any photo: id-card generation must refuse clearly, not crash ---
no_photo = client.post(f"/workers/{worker['id']}/id-card", headers=headers)
assert no_photo.status_code == 400, no_photo.text
print("Generating a card before any photo is uploaded fails clearly (400), not a crash: PASSED")

# --- Oversized upload is rejected server-side even if a client forgot to compress ---
oversized = make_jpeg(1600, 2000, quality=95, noisy=True)
assert len(oversized) > 100 * 1024, f"test fixture wasn't actually oversized ({len(oversized)} bytes)"
oversized_resp = client.post(
    f"/workers/{worker['id']}/photo", headers=headers, files={"photo": ("photo.jpg", oversized, "image/jpeg")}
)
assert oversized_resp.status_code == 422, oversized_resp.text
print(f"Oversized photo ({len(oversized)} bytes) rejected server-side: PASSED")

# --- A properly client-compressed photo (matches the app's own 400x500 target) uploads fine ---
photo_bytes = make_jpeg(400, 500, quality=65)
print(f"Test photo size: {len(photo_bytes)} bytes")
upload = client.post(
    f"/workers/{worker['id']}/photo", headers=headers, files={"photo": ("photo.jpg", photo_bytes, "image/jpeg")}
)
assert upload.status_code == 200, upload.text
assert upload.json()["photo_key"], upload.json()
print("Compressed photo upload succeeds, WorkerOut.photo_key is set: PASSED")

detail = client.get(f"/workers/{worker['id']}", headers=headers)
assert detail.json()["photo_key"], detail.json()
print("GET /workers/{id} reflects the uploaded photo (photo_key present): PASSED")

# --- Card generation now succeeds and produces a real, small PDF ---
card = client.post(f"/workers/{worker['id']}/id-card", headers=headers)
assert card.status_code == 200, card.text
assert card.headers["content-type"] == "application/pdf", card.headers
pdf_bytes = card.content
assert pdf_bytes[:4] == b"%PDF", "response is not a real PDF"
print(f"Generated ID card PDF size: {len(pdf_bytes)} bytes")
assert len(pdf_bytes) < 100 * 1024, f"ID card PDF is larger than the ~100KB target: {len(pdf_bytes)} bytes"
print("ID card PDF generated: valid PDF, under the size target: PASSED")

# --- Replacing the photo overwrites in place, not a growing history ---
photo_dir = os.environ.get("PHOTO_STORAGE_DIR", "./worker_photos_dev")
files_before = set(os.listdir(photo_dir)) if os.path.isdir(photo_dir) else set()
second_photo = make_jpeg(400, 500, quality=70)
client.post(f"/workers/{worker['id']}/photo", headers=headers, files={"photo": ("photo2.jpg", second_photo, "image/jpeg")})
files_after = set(os.listdir(photo_dir))
assert files_before == files_after, f"expected the same file to be overwritten, got {files_before} -> {files_after}"
print("Re-uploading a photo overwrites the same storage key, no history accumulates: PASSED")

# --- ID Card shows up in /form-templates for any state, not just seeded ones ---
tn_templates = client.get("/form-templates?state=Tamil Nadu", headers=headers).json()
assert any(t["form_code"] == "id_card" for t in tn_templates), tn_templates
ka_templates = client.get("/form-templates?state=Karnataka", headers=headers).json()
assert any(t["form_code"] == "id_card" for t in ka_templates), ka_templates
made_up_templates = client.get("/form-templates?state=Some Other State", headers=headers).json()
assert any(t["form_code"] == "id_card" for t in made_up_templates), made_up_templates
print("ID Card appears in /form-templates for every state, not seeded per-state: PASSED")

print("\nALL ASSERTIONS PASSED")

# Clean up the local-fallback photo directory this test created.
if os.path.isdir(photo_dir):
    shutil.rmtree(photo_dir)
