"""Portal Sync Worker: syncs Worker create/deactivate actions to the
partner Labour Portal via login-based browser automation (Playwright) --
the Portal has no official API. Runs against the Test Portal
(test-portal/) through Day 4; Day 5 swaps PORTAL_BASE_URL to the real
Portal, same code path, per the plan's "config change, same code path"
design.

Matching key for deactivation: full Aadhaar number (confirmed) -- not
name (real duplicate/instability risk: two workers can share a name, and
OCR/manual-correction can change spelling between registration and
deactivation) and not an external-reference field (only works if the
real Portal has an equivalent field, which is unknown; Aadhaar is
guaranteed to exist since the whole registration is keyed on it).

One browser session per owner, not per worker -- log in once, process
every pending item for that owner in the same session, then close it.
Login failures fail every pending item for that owner the same way
rather than retrying login per-item.
"""

import os
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright
from sqlalchemy.orm import Session

import models

PORTAL_BASE_URL = os.environ.get("PORTAL_BASE_URL", "http://127.0.0.1:8020")
MAX_SYNC_ATTEMPTS = 5


class PortalAutomation:
    def __init__(self, page):
        self.page = page

    def login(self, username: str, password: str) -> None:
        self.page.goto(f"{PORTAL_BASE_URL}/login")
        self.page.fill('input[name="username"]', username)
        self.page.fill('input[name="password"]', password)
        self.page.click('button[type="submit"]')
        self.page.wait_for_load_state("networkidle")
        if "/login" in self.page.url:
            raise RuntimeError("Portal login failed -- check credentials")

    def create_worker(self, name: str, aadhaar_number: str, factory_name: str, external_ref: str) -> None:
        self.page.goto(f"{PORTAL_BASE_URL}/workers/new")
        self.page.fill('input[name="name"]', name)
        self.page.fill('input[name="aadhaar_number"]', aadhaar_number)
        self.page.fill('input[name="factory_name"]', factory_name)
        self.page.fill('input[name="external_ref"]', external_ref)
        self.page.click('button[type="submit"]')
        self.page.wait_for_load_state("networkidle")

    def deactivate_worker(self, aadhaar_number: str) -> None:
        # page.request shares the browser context's cookies, so this
        # carries the session from login() above.
        resp = self.page.request.get(f"{PORTAL_BASE_URL}/workers/search?aadhaar={aadhaar_number}")
        matches = resp.json().get("matches", [])
        if len(matches) == 0:
            raise RuntimeError("No Portal entry found for this Aadhaar number -- nothing to deactivate")
        if len(matches) > 1:
            # Never guess which one -- fail loudly and visibly instead.
            # Real risk with last-4-only matching; much less likely with
            # full Aadhaar, but still not impossible to construct
            # (duplicate test data, a Portal bug), so handled regardless.
            raise RuntimeError(
                f"{len(matches)} Portal entries matched this Aadhaar number -- "
                "ambiguous, needs manual reconciliation, not automated guessing"
            )
        worker_portal_id = matches[0]["id"]
        self.page.goto(f"{PORTAL_BASE_URL}/workers")
        self.page.click(f'form[action="/workers/{worker_portal_id}/deactivate"] button')
        self.page.wait_for_load_state("networkidle")


def reconcile_owner(db: Session, owner: models.Owner) -> None:
    """Processes every pending/retriable sync_status row for one owner in
    a single Portal session."""
    credential = (
        db.query(models.PortalCredential)
        .filter(models.PortalCredential.owner_id == owner.id)
        .first()
    )
    if not credential:
        return  # no Portal login configured for this owner yet

    pending = (
        db.query(models.SyncStatus)
        .join(models.Worker, models.Worker.id == models.SyncStatus.worker_id)
        .filter(
            models.Worker.owner_id == owner.id,
            models.SyncStatus.state.in_(["pending", "failed"]),
            models.SyncStatus.attempts < MAX_SYNC_ATTEMPTS,
        )
        .all()
    )
    if not pending:
        return

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        automation = PortalAutomation(page)

        try:
            automation.login(credential.portal_username, credential.portal_password)
        except Exception as e:
            # Login itself failed -- every pending item fails the same
            # way; not worth attempting each one individually.
            for row in pending:
                row.attempts += 1
                row.state = "failed"
                row.last_error = str(e)
                row.last_attempted_at = datetime.now(timezone.utc)
            db.commit()
            browser.close()
            return

        for row in pending:
            worker = db.get(models.Worker, row.worker_id)
            row.attempts += 1
            row.last_attempted_at = datetime.now(timezone.utc)
            try:
                if row.action == "create":
                    automation.create_worker(
                        name=worker.name,
                        # aadhaar_encrypted decrypts transparently on
                        # read via the EncryptedString type -- this is
                        # the real full number, sent directly to the
                        # Portal's own form, never logged or displayed.
                        aadhaar_number=worker.aadhaar_encrypted,
                        factory_name=owner.factory_name,
                        external_ref=str(worker.id),
                    )
                elif row.action == "deactivate":
                    automation.deactivate_worker(worker.aadhaar_encrypted)
                row.state = "synced"
                row.last_error = None
            except Exception as e:
                row.state = "failed"
                row.last_error = str(e)
            db.commit()

        browser.close()


def reconcile_today(db: Session, owner_id: int) -> None:
    """Entry point for both the manual test-trigger endpoint (Day 3) and
    the future daily scheduled job -- scoped to one owner, matching the
    multi-tenant boundary used everywhere else in this app."""
    owner = db.get(models.Owner, owner_id)
    if owner:
        reconcile_owner(db, owner)
