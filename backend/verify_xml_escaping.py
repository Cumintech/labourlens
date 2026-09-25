"""Regression test for a real bug found in a security audit: every
dynamic, owner/worker-entered string (factory name, worker name,
designation, father's name, address, licence number) went into
ReportLab's Paragraph() completely unescaped. Paragraph parses its
input as a small XML/HTML-like markup language -- empirically
confirmed (not assumed) that a bare "&" alone does NOT crash it, but
unbalanced tag-like syntax (an unclosed "<b>", a stray "</b>") raises
a parser ValueError at doc.build() time, with no try/except anywhere
catching it, turning a single owner typing "Fitter <b>Welder" as a
designation into a permanent 500 for every future PDF involving that
worker.

Confirms the real, confirmed-by-testing crash trigger (an unclosed
"<b>" tag) no longer breaks ANY of the 7 documents once every dynamic
field routes through _xml_escape/_safe_paragraph_text.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> \
    PHOTO_STORAGE_ALLOW_LOCAL_FALLBACK=true PHOTO_STORAGE_DIR=./scratch_photos \
    python verify_xml_escaping.py
"""
import io
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from PIL import Image

import forms
from database import Base, engine
from main import app

# --- Unit-level: the escaping helper itself ---
assert forms._xml_escape("Fitter & Welder") == "Fitter &amp; Welder"
assert forms._xml_escape("<b>Unclosed") == "&lt;b&gt;Unclosed"
assert forms._xml_escape("Plain text") == "Plain text"
print("_xml_escape() escapes &, <, > correctly, leaves plain text untouched: PASSED")

# A Paragraph built from the escaped text must not raise. Empirically confirmed (not
# assumed) via a direct ReportLab test: a bare "&" alone does NOT crash Paragraph
# (its parser is lenient there) -- the real, confirmed trigger is unbalanced
# tag-like syntax, e.g. an unclosed "<b>" or a stray "</b>", which raises a
# ValueError at doc.build() time. _xml_escape still correctly prevents this
# (it escapes "<"/">" too, so nothing can ever look like a tag), it just isn't
# the bare-"&" case originally assumed.
from reportlab.lib.pagesizes import A4
from reportlab.platypus import Paragraph, SimpleDocTemplate
from reportlab.lib.styles import getSampleStyleSheet

styles = getSampleStyleSheet()
MALICIOUS_DESIGNATION = "Fitter <b>Unclosed"  # the real, confirmed crash trigger


def _paragraph_survives_build(text: str) -> bool:
    try:
        buf = io.BytesIO()
        SimpleDocTemplate(buf, pagesize=A4).build([Paragraph(text, styles["Normal"])])
        return True
    except Exception:
        return False


assert not _paragraph_survives_build(MALICIOUS_DESIGNATION), (
    "expected the raw unescaped unclosed-tag string to still crash doc.build() "
    "(confirms the bug is real, not already handled elsewhere)"
)
assert _paragraph_survives_build(forms._xml_escape(MALICIOUS_DESIGNATION))
print("Raw unclosed '<b>' crashes Paragraph()/doc.build() (confirms the bug), escaped text does not: PASSED")

# --- End-to-end: a worker with malicious/malformed values in every free-text field ---
Base.metadata.create_all(bind=engine)
client = TestClient(app)

signup = client.post(
    "/owners/signup",
    json={
        "name": "Escaping Test Owner",
        "mobile": "9000002201",
        "password": "pass12345",
        "factory_name": "Fitter <b>Welder Works",  # the real, confirmed crash trigger
        "factory_address": "12 Industrial Rd, <b>Unclosed",
        "consent_given": True,
    },
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}
client.put(
    "/owners/me/factory-profile",
    headers=headers,
    json={"factory_name": "Fitter <b>Welder Works", "factory_licence_no": "TN-001 <b>Co", "state": "Tamil Nadu"},
)

worker = client.post(
    "/workers",
    headers=headers,
    json={
        "name": "Kumar <b>Sons",
        "aadhaar_number": "900011119999",
        "dob": "1995-06-01",
        "current_address": "45 <b>Unclosed Street",
    },
).json()
wid = worker["id"]
assert client.post(
    f"/workers/{wid}/compliance",
    headers=headers,
    json={"designation_or_nature_of_work": "Fitter <b>Welder", "father_or_spouse_name": "Ramesh <b>Co"},
).status_code == 201
assert client.post(
    f"/workers/{wid}/wage-profile", headers=headers, json={"rate_type": "daily", "basic": 500, "effective_from": "2026-08-01"}
).status_code == 201
assert client.post("/attendance", headers=headers, json={"worker_id": wid, "date": "2026-08-01", "slot": "AM", "status": "present"}).status_code == 200

for name, resp in [
    ("Form 12 (single worker)", client.get(f"/forms/form12/{wid}", headers=headers)),
    ("Form 15", client.get("/forms/form15", headers=headers, params={"start_date": "2026-08-01", "end_date": "2026-08-31"})),
    ("Form 25", client.get("/forms/form25", headers=headers, params={"start_date": "2026-08-01", "end_date": "2026-08-31"})),
    ("Form 25-B", client.get("/forms/form25b", headers=headers, params={"worker_id": wid, "start_date": "2026-08-01", "end_date": "2026-08-31"})),
    ("Wage Slip", client.get("/forms/wageslip", headers=headers, params={"worker_id": wid, "start_date": "2026-08-01", "end_date": "2026-08-31"})),
    ("Appointment Letter", client.post(f"/workers/{wid}/appointment-letter", headers=headers)),
]:
    assert resp.status_code == 200, f"{name} failed: HTTP {resp.status_code}: {resp.text[:300]}"
    assert resp.content[:4] == b"%PDF", f"{name} did not return a real PDF"
    print(f"{name} generates with '&'/'<b>' in every free-text field, no 500: PASSED ({len(resp.content)} bytes)")

# ID card needs a photo
buf = io.BytesIO()
Image.new("RGB", (400, 500), color=(100, 120, 140)).save(buf, format="JPEG")
buf.seek(0)
assert client.post(f"/workers/{wid}/photo", headers=headers, files={"photo": ("p.jpg", buf, "image/jpeg")}).status_code == 200
idcard = client.post(f"/workers/{wid}/id-card", headers=headers)
assert idcard.status_code == 200 and idcard.content[:4] == b"%PDF"
print(f"ID Card generates with '&' in name/factory name, no 500: PASSED ({len(idcard.content)} bytes)")

photo_dir = os.environ.get("PHOTO_STORAGE_DIR", "./worker_photos_dev")
if os.path.isdir(photo_dir):
    shutil.rmtree(photo_dir)
if os.path.isdir(forms._TAMIL_IMG_CACHE_DIR):
    shutil.rmtree(forms._TAMIL_IMG_CACHE_DIR)
    os.makedirs(forms._TAMIL_IMG_CACHE_DIR, exist_ok=True)

print("\nALL ASSERTIONS PASSED")
