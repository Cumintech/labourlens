"""Report email delivery via smtplib (stdlib, no extra dependency).

SMTP is configured entirely through env vars -- no credentials in code.
Not yet pointed at a real mail provider (no SMTP account exists yet);
SMTP_HOST defaults to a local address so this fails loudly and specifically
rather than silently if nobody has configured it. verify_reports.py points
it at a real local SMTP server (aiosmtpd) to prove the send path actually
works end-to-end, not just that build_report() produces bytes.
"""

import os
import smtplib
from email.message import EmailMessage

SUBTYPE_BY_FORMAT = {
    "excel": "vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "pdf",
}


def send_report_email(
    to_email: str,
    subject: str,
    body_text: str,
    attachment_bytes: bytes,
    attachment_filename: str,
    format: str,
) -> None:
    host = os.environ.get("SMTP_HOST")
    if not host:
        raise RuntimeError(
            "SMTP_HOST is not set -- email delivery has no mail server configured. "
            "Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD in .env."
        )
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASSWORD")
    from_addr = os.environ.get("SMTP_FROM", user or "labourlens@localhost")
    use_tls = os.environ.get("SMTP_USE_TLS", "true").lower() == "true"

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text)
    msg.add_attachment(
        attachment_bytes,
        maintype="application",
        subtype=SUBTYPE_BY_FORMAT[format],
        filename=attachment_filename,
    )

    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if use_tls:
            smtp.starttls()
        if user and password:
            smtp.login(user, password)
        smtp.send_message(msg)
