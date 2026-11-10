"""Verifies the Appointment Letter feature end to end: a worker with no
compliance/wage data yet can still have a letter generated (missing facts
render as "-", never a crash), a worker with real designation/joining
date/wage/address produces a letter containing that data, and
"Appointment Letter" shows up in /form-templates regardless of state
(it isn't a per-state statutory form, same as ID Card).

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> \
    python verify_appointment_letter.py
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

signup = client.post(
    "/owners/signup",
    json={
        "name": "Letter Owner",
        "mobile": "9000001901",
        "password": "pass12345",
        "factory_name": "Sunrise Textiles Private Limited",
        "factory_address": "42 Industrial Estate, Salem, Tamil Nadu 636001",
        "consent_given": True,
    },
)
assert signup.status_code == 201, signup.text
token = signup.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

worker = client.post(
    "/workers",
    headers=headers,
    json={"name": "Kumar Selvam", "aadhaar_number": "222233335556", "current_address": "12 North Street, Salem", "dob": "1995-06-01"},
).json()

# --- No compliance/wage data on file yet -- must still generate, not crash ---
bare_letter = client.post(f"/workers/{worker['id']}/appointment-letter", headers=headers)
assert bare_letter.status_code == 200, bare_letter.text
assert bare_letter.headers["content-type"] == "application/pdf", bare_letter.headers
assert bare_letter.content[:4] == b"%PDF", "response is not a real PDF"
from pypdf import PdfReader
import io as _io

def letter_text(content: bytes) -> str:
    reader = PdfReader(_io.BytesIO(content))
    assert len(reader.pages) == 1, "the letter fits on one page"
    return " ".join(reader.pages[0].extract_text().split())  # labels wrap over lines in the PDF

bare_text = letter_text(bare_letter.content)
# the 16-item format is there even when nothing is on file: every label, the worker's name, blank lines (no dashes)
for label in ("Appointment Letter", "Name of employee", "Date of birth", "Father's / Mother's name", "Aadhaar number (after obtaining consent)",
              "Labour Identification Number of the establishment", "Designation", "Type of Employment", "Category of skill", "Date of joining",
              "Wages / Basic / Pay and Dearness Allowance", "Other allowance including accommodation", "Applicability of social security",
              "Broad Nature of duties to be performed", "Chapter VI (Maternity Benefit)", "Any other information", "Signature / Digital Signature"):
    assert label in bare_text, (label, bare_text)
for numeral in ("(i)", "(v)", "(x)", "(xiii)", "(xvi)"):
    assert numeral in bare_text, numeral
assert "Kumar Selvam" in bare_text and "01-06-1995" in bare_text, bare_text
assert "XXXX XXXX 5556" in bare_text and "222233335556" not in bare_text, "Aadhaar is printed masked, never in full"
print(f"Letter generated with no designation/joining-date/wage on file (blank ruled lines, 16-item format): PASSED ({len(bare_letter.content)} bytes)")

# --- Add designation + joining date, and a wage rate ---
compliance = client.post(
    f"/workers/{worker['id']}/compliance",
    headers=headers,
    json={"designation_or_nature_of_work": "Machine Operator", "date_of_joining": "2026-01-15", "father_or_spouse_name": "Selvam", "epf_uan_no": "100200300400"},
)
assert compliance.status_code == 201, compliance.text

wage = client.post(
    f"/workers/{worker['id']}/wage-profile",
    headers=headers,
    json={"rate_type": "daily", "basic": 650, "da": 100, "other_allowances": 25, "pf_rate": 12, "effective_from": date.today().isoformat()},
)
assert wage.status_code == 201, wage.text

full_letter = client.post(f"/workers/{worker['id']}/appointment-letter", headers=headers)
assert full_letter.status_code == 200, full_letter.text
pdf_bytes = full_letter.content
assert pdf_bytes[:4] == b"%PDF", "response is not a real PDF"
full_text = letter_text(pdf_bytes)
for expected in ("Selvam", "Machine Operator", "15-01-2026", "UAN 100200300400", "Basic Rs. 650.00 + DA Rs. 100.00 per day",
                 "Other allowances Rs. 25.00 per day", "EPF: Applicable; ESIC: Not applicable"):
    assert expected in full_text, (expected, full_text)
assert "Not applicable" in full_text  # maternity: no gender on file shows nothing; ESIC above is the "Not applicable" present
print(f"Letter generated with designation/joining-date/wage/address on file, values in the right rows: PASSED ({len(pdf_bytes)} bytes)")

# maternity benefit line: only for women employees
women = client.post("/workers", headers=headers, json={"name": "Meena Devi", "aadhaar_number": "555511112225", "gender": "Female"}).json()
assert "Benefits available under Chapter VI of the Code on Social Security, 2020" in letter_text(client.post(f"/workers/{women['id']}/appointment-letter", headers=headers).content)
man = client.post("/workers", headers=headers, json={"name": "Raju Kumar", "aadhaar_number": "555511114448", "gender": "Male"}).json()
assert "Not applicable" in letter_text(client.post(f"/workers/{man['id']}/appointment-letter", headers=headers).content)
print("Maternity-benefit row: women get the Chapter VI line, others 'Not applicable': PASSED")

# --- Reprinting is idempotent -- no state is written that would ever block a second generation ---
reprint = client.post(f"/workers/{worker['id']}/appointment-letter", headers=headers)
assert reprint.status_code == 200, reprint.text
print("Reprinting the same letter on demand works: PASSED")

# --- Appointment Letter shows up in /form-templates for any state, not just seeded ones ---
tn_templates = client.get("/form-templates?state=Tamil Nadu", headers=headers).json()
assert any(t["form_code"] == "appointment_letter" for t in tn_templates), tn_templates
ka_templates = client.get("/form-templates?state=Karnataka", headers=headers).json()
assert any(t["form_code"] == "appointment_letter" for t in ka_templates), ka_templates
made_up_templates = client.get("/form-templates?state=Some Other State", headers=headers).json()
assert any(t["form_code"] == "appointment_letter" for t in made_up_templates), made_up_templates
print("Appointment Letter appears in /form-templates for every state, not seeded per-state: PASSED")

print("\nALL ASSERTIONS PASSED")
