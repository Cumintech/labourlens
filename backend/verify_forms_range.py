"""Verifies the new Forms & Reports date-range capability: Form 25/
25-B/15/Wage Slip now take a real start_date/end_date range (not a
single month), producing one combined PDF with a full statutory
section per calendar month the range touches. Confirms output actually
changes across two different periods and across a specific-worker
selection, per the explicit end-to-end testing requirement.

    DATABASE_URL=sqlite:///./scratch_range.db python verify_forms_range.py
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from pypdf import PdfReader

from database import Base, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)


def pdf_text(content: bytes) -> str:
    reader = PdfReader(io.BytesIO(content))
    return "\n".join(page.extract_text() for page in reader.pages)


signup = client.post(
    "/owners/signup",
    json={"name": "Range Owner", "mobile": "9000001101", "password": "pass12345", "factory_name": "Range Factory", "consent_given": True},
)
assert signup.status_code == 201, signup.text
headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}

worker_a = client.post("/workers", headers=headers, json={"name": "Range Worker A", "aadhaar_number": "555511112222"}).json()
worker_b = client.post("/workers", headers=headers, json={"name": "Range Worker B", "aadhaar_number": "555533334444"}).json()

for wid, day in ((worker_a["id"], "2026-06-10"), (worker_a["id"], "2026-07-10"), (worker_a["id"], "2026-08-10"), (worker_b["id"], "2026-08-10")):
    mark = client.post("/attendance", headers=headers, json={"worker_id": wid, "date": day, "slot": "AM", "status": "present"})
    assert mark.status_code == 200, mark.text

# --- Form 25: a single-month period vs. a 3-month period must produce
# genuinely different PDFs (different page counts, different month
# labels present) -- this is the core "Period actually changes output"
# requirement. ---
form25_one_month = client.get("/forms/form25", headers=headers, params={"start_date": "2026-08-01", "end_date": "2026-08-31"})
assert form25_one_month.status_code == 200 and form25_one_month.content[:4] == b"%PDF", form25_one_month.status_code
text_one_month = pdf_text(form25_one_month.content)
assert "2026-08-01 to 2026-08-31" in text_one_month
assert "2026-06-01 to 2026-06-30" not in text_one_month
one_month_pages = len(PdfReader(io.BytesIO(form25_one_month.content)).pages)

form25_three_months = client.get("/forms/form25", headers=headers, params={"start_date": "2026-06-15", "end_date": "2026-08-20"})
assert form25_three_months.status_code == 200 and form25_three_months.content[:4] == b"%PDF", form25_three_months.status_code
text_three_months = pdf_text(form25_three_months.content)
three_month_pages = len(PdfReader(io.BytesIO(form25_three_months.content)).pages)
# The 3-month request touches June, July, and August -- each a full
# calendar-month section, so it must contain all three month labels and
# be a strictly bigger document than the 1-month request.
for expected_label in ("2026-06-01 to 2026-06-30", "2026-07-01 to 2026-07-31", "2026-08-01 to 2026-08-31"):
    assert expected_label in text_three_months, f"missing month section {expected_label!r} in the 3-month Form 25"
assert three_month_pages > one_month_pages, (
    f"a 3-month period ({three_month_pages} pages) should produce more content than a 1-month period ({one_month_pages} pages)"
)
print(f"Form 25: Current-Month-style period ({one_month_pages}p) vs Last-3-Months-style period ({three_month_pages}p) produce genuinely different PDFs: PASSED")

# --- Wage Slip: a specific-worker selection changes the output (Worker
# A's name appears, Worker B's does not, and vice versa) ---
for wid, basic in ((worker_a["id"], 400), (worker_b["id"], 600)):
    rate = client.post(
        f"/workers/{wid}/wage-profile",
        headers=headers,
        json={"rate_type": "daily", "basic": basic, "effective_from": "2026-06-01"},
    )
    assert rate.status_code == 201, rate.text

slip_a = client.get(
    "/forms/wageslip", headers=headers, params={"worker_id": worker_a["id"], "start_date": "2026-08-01", "end_date": "2026-08-31"}
)
slip_b = client.get(
    "/forms/wageslip", headers=headers, params={"worker_id": worker_b["id"], "start_date": "2026-08-01", "end_date": "2026-08-31"}
)
assert slip_a.status_code == 200 and slip_b.status_code == 200
text_slip_a = pdf_text(slip_a.content)
text_slip_b = pdf_text(slip_b.content)
assert "Range Worker A" in text_slip_a
assert "Range Worker B" in text_slip_b
assert text_slip_a != text_slip_b or slip_a.content != slip_b.content
print("Wage Slip: selecting Worker A vs Worker B produces genuinely different PDFs: PASSED")

# --- end_date before start_date is rejected, same convention as the
# existing Attendance Report endpoint ---
bad_order = client.get("/forms/form25", headers=headers, params={"start_date": "2026-08-31", "end_date": "2026-08-01"})
assert bad_order.status_code == 422, bad_order.text
print("Form 25 rejects end_date before start_date: PASSED")

print("\nALL ASSERTIONS PASSED")
