"""Persistent local SMTP relay for manual/real-device dev testing.

verify_reports.py proves the email path works end-to-end by spinning up
its own aiosmtpd server for the duration of that one test run -- but
during real-device manual testing (owner taps "Email report" on their
phone), nothing was actually listening on SMTP_HOST/SMTP_PORT outside of
that test script, so send_report_email() had no server to talk to and
report email silently failed. This script is that same aiosmtpd server,
just run standalone and left running for the whole dev session.

Point the backend at it via .env:
    SMTP_HOST=127.0.0.1
    SMTP_PORT=1025
    SMTP_USE_TLS=false

Requires aiosmtpd: pip install -r requirements-dev.txt

    python dev_smtp_relay.py
"""

import email as email_lib
import time

from aiosmtpd.controller import Controller


class LoggingHandler:
    async def handle_DATA(self, server, session, envelope):
        parsed = email_lib.message_from_bytes(envelope.content)
        attachments = [p.get_filename() for p in parsed.walk() if p.get_filename()]
        print(
            f"[dev-smtp] from={envelope.mail_from} to={envelope.rcpt_tos} "
            f"subject={parsed.get('Subject')!r} attachments={attachments}"
        )
        return "250 Message accepted for delivery"


if __name__ == "__main__":
    controller = Controller(LoggingHandler(), hostname="127.0.0.1", port=1025)
    controller.start()
    print("dev SMTP relay listening on 127.0.0.1:1025 -- Ctrl+C to stop")
    try:
        # Not input()-based: this runs as an unattended background
        # process during dev sessions, with no interactive stdin attached
        # -- input() would hit EOF immediately and exit right after
        # printing the line above, silently leaving nothing listening.
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        controller.stop()
