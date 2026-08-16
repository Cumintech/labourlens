# Labour Lens — 5-day build plan

Build sprint — each day ships working, testable code. See
[SPEC.md](SPEC.md) for scope and [DATA_MODEL.md](DATA_MODEL.md) for the
schema.

## Day 1 — Spec, scaffolding, Test Portal
- Data model + quick spec (this doc + SPEC.md + DATA_MODEL.md)
- Scaffold mobile app (Expo) and backend API (FastAPI, auth, routing)
- Mock Test Portal — Days 2-5 test the Sync Worker against this, never
  the real Portal until Day 5
- DB set up with field-level encryption for PII columns

## Day 2 — Registration
- Aadhaar OCR: front & back scan, field extraction
- Manual-correction UI for OCR misreads before saving
- Owner login, multi-tenant scoping enforced at the query level
- Save flow: mask Aadhaar (last 4 visible), encrypt PII at rest
- 50-worker-per-owner limit

## Day 3 — Portal Sync Worker
- Sync worker: create on registration, remove/update on deactivation
  (login-based automation against the Test Portal)
- Queue + retry; per-worker Synced/Pending/Failed status, app state never
  blocked on Portal success
- Portal credentials in an encrypted vault, not code/config
- End-to-end test against the Day 1 Test Portal

## Day 4 — Attendance, dashboard, reporting
- Daily attendance: Present/Absent, AM/PM/Evening
- Daily dashboard: "X of Y present," per-slot breakdown
- Search across workers
- Worker list with Deactivate (wired to Day 3's sync worker)
- 6-month report: date range, PDF/Excel export, email delivery

## Day 5 — Testing, cutover, ship
- Full end-to-end pass: registration → Portal sync, attendance, reporting,
  deactivation → Portal removal
- Bug fixes
- Swap Sync Worker target from Test Portal to the real Portal (config
  change, same code path)
- One supervised real-Portal test (single registration + removal,
  manually verified) before considering it live
- Final review: encryption on all PII fields, audit log on every
  activate/deactivate

## Daily status log

### Day 1 — [in progress, see below once complete]
