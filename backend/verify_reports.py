"""Verifies report generation + email delivery for real: downloads a real
PDF file (not just checking the endpoint returns 200), confirms deactivated
workers within the period get their own section, and spins up a REAL local
SMTP server (aiosmtpd) to receive an actual SMTP session -- not a mocked
smtplib.SMTP. Also confirms an unreachable SMTP server surfaces as a real
error rather than silently "succeeding". Excel support was removed (PDF
only, per explicit request), so this no longer tests that path.

Requires aiosmtpd: pip install -r requirements-dev.txt

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_reports.py
"""

import email
import io
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from datetime import date

from aiosmtpd.controller import Controller
from fastapi.testclient import TestClient
from pypdf import PdfReader

from database import Base, SessionLocal, engine
import models
from main import app


def pdf_text(content: bytes) -> str:
    reader = PdfReader(io.BytesIO(content))
    return "\n".join(page.extract_text() for page in reader.pages)

Base.metadata.create_all(bind=engine)
client = TestClient(app)
TODAY = date(2026, 8, 18)
START = date(2026, 8, 1)


class CapturingHandler:
    def __init__(self):
        self.messages = []

    async def handle_DATA(self, server, session, envelope):
        self.messages.append(
            {"mail_from": envelope.mail_from, "rcpt_tos": envelope.rcpt_tos, "content": envelope.content}
        )
        return "250 Message accepted for delivery"


handler = CapturingHandler()
# Port 1026, not the dev-relay's usual 1025 -- this test's own SMTP
# server must never fight a real dev_smtp_relay.py that's already
# running for manual/real-device testing (a genuine port-bind conflict
# hit while running the full verify suite alongside a live dev session).
controller = Controller(handler, hostname="127.0.0.1", port=1026)
controller.start()
# Override every SMTP_* var explicitly rather than relying on whatever
# .env currently has configured (a real provider like Gmail, with TLS
# on) -- this test always talks to the local plain-SMTP controller above.
prior_smtp_env = {k: os.environ.get(k) for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USE_TLS", "SMTP_USER", "SMTP_PASSWORD")}
os.environ["SMTP_HOST"] = "127.0.0.1"
os.environ["SMTP_PORT"] = "1026"
os.environ["SMTP_USE_TLS"] = "false"
os.environ.pop("SMTP_USER", None)
os.environ.pop("SMTP_PASSWORD", None)

try:
    signup = client.post(
        "/owners/signup",
        json={"name": "Report Owner", "mobile": "9000000075", "password": "pass123", "factory_name": "Report Factory"},
    )
    assert signup.status_code == 201, signup.text
    token = signup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    w = client.post("/workers", headers=headers, json={"name": "Report Worker", "aadhaar_number": "999988887777"}).json()
    mark = client.post(
        "/attendance", headers=headers, json={"worker_id": w["id"], "date": str(TODAY), "slot": "AM", "status": "present"}
    )
    assert mark.status_code == 200, mark.text

    # A second worker, deactivated partway through the report period --
    # the report must call this out in its own section, not just silently
    # drop them from the attendance rows.
    w2 = client.post("/workers", headers=headers, json={"name": "Leaving Worker", "aadhaar_number": "999988886666"}).json()
    deactivate = client.patch(f"/workers/{w2['id']}/deactivate", headers=headers)
    assert deactivate.status_code == 200, deactivate.text
    # deactivate_worker() stamps deactivated_at with the real wall-clock
    # time, not this test's fictional August-2026 window -- back-date it
    # directly so it actually falls inside START..TODAY, the same way
    # other tests in this suite poke the DB directly for data no API
    # call can produce.
    db_direct = SessionLocal()
    db_direct.query(models.Worker).filter(models.Worker.id == w2["id"]).update({"deactivated_at": TODAY})
    db_direct.commit()
    db_direct.close()

    # --- Direct download: PDF -- real file, magic bytes + content checked ---
    resp = client.get("/reports/attendance", headers=headers, params={"start_date": str(START), "end_date": str(TODAY)})
    assert resp.status_code == 200, resp.text
    assert resp.content[:4] == b"%PDF", "response is not a real PDF"
    text = pdf_text(resp.content)
    assert "Report Worker" in text and "AM" in text, "attendance row missing from PDF report"
    assert "Leaving Worker" in text, "deactivated-worker section missing from PDF report"
    print("PDF report download: real PDF, attendance row and deactivated-worker section both present: PASSED")

    # --- Email delivery: real SMTP session against the real local server above ---
    resp = client.post(
        "/reports/attendance/email",
        headers=headers,
        json={"start_date": str(START), "end_date": str(TODAY), "recipient_email": "owner@example.com"},
    )
    assert resp.status_code == 202, resp.text
    assert len(handler.messages) == 1, f"expected exactly one email received by the real SMTP server: {handler.messages}"
    msg = handler.messages[0]
    assert msg["rcpt_tos"] == ["owner@example.com"], msg["rcpt_tos"]

    parsed = email.message_from_bytes(msg["content"])
    attachments = [p for p in parsed.walk() if p.get_filename()]
    assert len(attachments) == 1, f"expected exactly one attachment: {attachments}"
    attachment_bytes = attachments[0].get_payload(decode=True)
    assert attachment_bytes[:4] == b"%PDF", "email attachment is not a real PDF"
    assert "Report Worker" in pdf_text(attachment_bytes), "attachment content doesn't match the report"
    print("Email delivered over a real SMTP session, with a real PDF attachment: PASSED")

    # --- Genuine failure path: SMTP server unreachable ---
    os.environ["SMTP_PORT"] = "1099"  # nothing listening here
    client_no_raise = TestClient(app, raise_server_exceptions=False)
    client_no_raise.headers.update(headers)
    resp = client_no_raise.post(
        "/reports/attendance/email",
        json={"start_date": str(START), "end_date": str(TODAY), "recipient_email": "owner@example.com"},
    )
    assert resp.status_code == 500, f"unreachable SMTP server should surface as a real error, not silently succeed: {resp.status_code}"
    os.environ["SMTP_PORT"] = "1026"
    print("unreachable SMTP server surfaces as a real error, not silently swallowed: PASSED")

finally:
    for key, value in prior_smtp_env.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    controller.stop()

print("\nALL ASSERTIONS PASSED")
