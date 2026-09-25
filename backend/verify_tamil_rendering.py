"""Regression test for a real bug: a worker's own name/address/
designation entered in Tamil script rendered as solid black boxes in
every generated PDF (Form 12, Form 15, Form 25, Form 25-B, Wage Slip,
ID Card, Appointment Letter) -- confirmed by actually registering a
worker with a Tamil name and reading the rendered PDFs back, including
Form 25, whose own bilingual title rendered correctly on the same page
as the broken name, proving the Tamil-safe rasterizer worked fine and
the gap was that dynamic, owner-entered text never routed through it.

Covers both the unit-level helpers (forms.py's _contains_tamil,
_wrap_row, _cell_or_tamil_image, _safe_paragraph_text) and an
end-to-end generation pass for each of the four distinct rendering
mechanisms this fix touches: Platypus table cells (_wrap_row -- Form
12/15/25/25-B), a directly-built Table (Wage Slip), Paragraph markup
embedded in prose (Appointment Letter), and a raw Canvas (ID Card).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> \
    PHOTO_STORAGE_ALLOW_LOCAL_FALLBACK=true PHOTO_STORAGE_DIR=./scratch_photos \
    python verify_tamil_rendering.py
"""
import io
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from PIL import Image
from reportlab.platypus import Paragraph

import forms
from database import Base, engine
from main import app

TAMIL_NAME = "முருகன் செல்வம்"  # Murugan Selvam
ENGLISH_NAME = "Murugan Selvam"

# --- Unit-level: the four helpers this fix added/changed ---
assert forms._contains_tamil(TAMIL_NAME) is True
assert forms._contains_tamil(ENGLISH_NAME) is False
print("_contains_tamil() distinguishes Tamil from English: PASSED")

cells = forms._wrap_row([TAMIL_NAME, ENGLISH_NAME])
assert not isinstance(cells[0], Paragraph), "Tamil cell should render as an Image, not a plain Paragraph"
assert isinstance(cells[1], Paragraph), "English cell should stay a plain Paragraph, unchanged"
print("_wrap_row() routes Tamil to an Image flowable, leaves English untouched: PASSED")

assert not isinstance(forms._cell_or_tamil_image(TAMIL_NAME), str)
assert forms._cell_or_tamil_image(ENGLISH_NAME) == ENGLISH_NAME
print("_cell_or_tamil_image() same behavior for direct-Table cells: PASSED")

safe = forms._safe_paragraph_text(TAMIL_NAME, 10)
assert safe != TAMIL_NAME and "<img" in safe, "Tamil text should become an inline <img> tag"
assert forms._safe_paragraph_text(ENGLISH_NAME, 10) == ENGLISH_NAME
print("_safe_paragraph_text() same behavior for inline sentence text: PASSED")

# --- End-to-end: all four rendering mechanisms actually produce a PDF ---
Base.metadata.create_all(bind=engine)
client = TestClient(app)

signup = client.post(
    "/owners/signup",
    json={"name": "Tamil Test Owner", "mobile": "9000002101", "password": "pass12345", "factory_name": "Tamil Test Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

worker = client.post(
    "/workers", headers=headers, json={"name": TAMIL_NAME, "aadhaar_number": "900099998888", "dob": "1995-06-01"}
).json()
wid = worker["id"]
assert client.post(f"/workers/{wid}/compliance", headers=headers, json={"designation_or_nature_of_work": "Machine Operator"}).status_code == 201
assert client.post(
    f"/workers/{wid}/wage-profile", headers=headers, json={"rate_type": "daily", "basic": 500, "effective_from": "2026-08-01"}
).status_code == 201
assert client.post("/attendance", headers=headers, json={"worker_id": wid, "date": "2026-08-01", "slot": "AM", "status": "present"}).status_code == 200

# Form 12 -- Platypus table cell (_wrap_row)
form12 = client.get(f"/forms/form12/{wid}", headers=headers)
assert form12.status_code == 200 and form12.content[:4] == b"%PDF"
print(f"Form 12 (Tamil name via _wrap_row) generates: PASSED ({len(form12.content)} bytes)")

# Wage Slip -- directly-built Table (_cell_or_tamil_image)
wageslip = client.get("/forms/wageslip", headers=headers, params={"worker_id": wid, "start_date": "2026-08-01", "end_date": "2026-08-31"})
assert wageslip.status_code == 200 and wageslip.content[:4] == b"%PDF"
print(f"Wage Slip (Tamil name via _cell_or_tamil_image) generates: PASSED ({len(wageslip.content)} bytes)")

# Appointment Letter -- Paragraph markup embedded in prose (_safe_paragraph_text)
letter = client.post(f"/workers/{wid}/appointment-letter", headers=headers)
assert letter.status_code == 200 and letter.content[:4] == b"%PDF"
print(f"Appointment Letter (Tamil name inline in prose) generates: PASSED ({len(letter.content)} bytes)")

# ID Card -- raw Canvas drawing (draw_line/draw_centred)
photo_buf = io.BytesIO()
Image.new("RGB", (400, 500), color=(120, 130, 150)).save(photo_buf, format="JPEG")
photo_buf.seek(0)
assert client.post(f"/workers/{wid}/photo", headers=headers, files={"photo": ("p.jpg", photo_buf, "image/jpeg")}).status_code == 200
idcard = client.post(f"/workers/{wid}/id-card", headers=headers)
assert idcard.status_code == 200 and idcard.content[:4] == b"%PDF"
print(f"ID Card (Tamil name via raw Canvas draw_line) generates: PASSED ({len(idcard.content)} bytes)")

# Sanity: an English-only worker must still render exactly as before (no regression)
worker_en = client.post("/workers", headers=headers, json={"name": ENGLISH_NAME, "aadhaar_number": "900077776666"}).json()
form12_en = client.get(f"/forms/form12/{worker_en['id']}", headers=headers)
assert form12_en.status_code == 200 and form12_en.content[:4] == b"%PDF"
print(f"Form 12 (English name, unaffected) still generates: PASSED ({len(form12_en.content)} bytes)")

photo_dir = os.environ.get("PHOTO_STORAGE_DIR", "./worker_photos_dev")
if os.path.isdir(photo_dir):
    shutil.rmtree(photo_dir)
# _safe_paragraph_text (Appointment Letter) writes one cached PNG per
# unique dynamic string via _tamil_inline_image_tag's on-disk cache --
# that cache is designed for a small, fixed set of this module's own
# labels (see its docstring), not per-worker names, so clean up what
# this run added rather than let it accumulate one file per test name.
if os.path.isdir(forms._TAMIL_IMG_CACHE_DIR):
    shutil.rmtree(forms._TAMIL_IMG_CACHE_DIR)
    os.makedirs(forms._TAMIL_IMG_CACHE_DIR, exist_ok=True)

print("\nALL ASSERTIONS PASSED")
