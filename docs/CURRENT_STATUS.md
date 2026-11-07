# Current status (updated 2026-10-06)

## Where I left off
- Branch `chore/home-ism-quicklink`: Home screen restored to the pre-classification Today card; Workforce card and filter chips removed; "ISM contractors (N)" quick link added (opens Workers filtered).
- Still in Expo Go testing; real EAS build not started.

## Test-report fixes (2026-10-28, uncommitted, branch not created)
- Done: contract worker type, weekly salary type, LOP proration (backend/forms.py compute_wage), Android save-to-folder for PDFs (mobile/src/pdfShare.ts), Reports regrouped, Add Worker scroll/keyboard fix, OCR 12-digit fallback. Test: backend/verify_wage_lop.py.
- Open: min-wage comparison, photo/logo ID layout (#6, needs clarification), NFH rules, device re-test of scroll + Downloads save.

## Test-report 2 (2026-10-28, PR fix/test-report-2)
- Salary type dropdown; joining-date chips default today; Add Worker gates Continue on 5/5 (3/3 temporary) via complianceProgress; Save/Share choice for PDFs; Workers filters All/Permanent/Temporary/Contractor + Worker type report (pie charts, also on Today); details-missing/no-wage/inactive moved into compliance card.

## Done (recent, from git log)
- Worker employment classification (Permanent/Contractor/ISM) — 3257715
- Click-to-WhatsApp support; gated create_all() to dev; test runner — 74d6088, 7af2618
- Ask Labour Lens chips; Plans page + upgrade requests — a069e74, 75fa2ef
- Compliance check + polish; worker compliance deep links — e300d85, 9545f0e, 32c239e
- UI restyles (Today, Reports, Workers, Wages, Attendance) — 5b6ff0c..73fab75

## Next
- Finish Expo Go testing, then real EAS build.
- Resolve DECISION-NEEDED / OPEN items below before any real factory.

## Portal Sync removed (2026-10-30, PR chore/remove-portal-sync)
- Deleted sync_worker.py, test-portal/, playwright dep, /portal-credentials, /sync/*, SyncStatus/PortalCredential models. Migration c1d8e4f7a2b9 drops the tables -- BACK UP the DB, then run `alembic upgrade head` manually (Render does not). Older docs (BUILD_PLAN, ARCHITECTURE_REVIEW, ONBOARDING §9) still describe it historically.

## PR2 hardening (2026-10-30, chore/pr2-hardening)
- DB pool settings, /health checks the DB (503 if down), OCR runs off the event loop with 8MB cap, *.db gitignored, unused RECORD_AUDIO permission removed, EAS projectId committed. Index migration d2e9f5a8b3c1 is OPTIONAL (not applied unless `alembic upgrade head` is run; also drops sync tables via c1d8e4f7a2b9).

## PR3 bulk wages (2026-10-30, perf/bulk-wage)
- forms.compute_wage_bulk / compute_daily_wage_bulk: fixed ~5 queries for any worker count (was ~6-8 per worker). Used by /wage-summary, /wage-summary/daily, month-end checklist, Form 15. Shared pure maths in _compute_wage_core; verify_wage_bulk.py asserts bulk == per-worker.

## PR5 router split (2026-10-30, refactor/routers)
- main.py (2.4k lines) -> main.py (app setup, health, privacy) + common.py (shared imports/constants/helpers) + routers/{owners,workers,attendance,wages,forms,insights}.py. Moved verbatim; OpenAPI schema identical (89 routes). Add new routes to the matching router, shared helpers to common.py. Start command stays `main:app`.

## Open pilot blockers (vs ARCHITECTURE_REVIEW §2)
1. OCR debug print of Aadhaar/name — FIXED (was already opt-in gated; dead block removed, backend/ocr.py:322)
2. Privacy policy discloses biometric + bank/IFSC — FIXED (backend/privacy_policy.py:39,50)
3. MAX_WORKERS_PER_OWNER raised to 200 — FIXED (backend/main.py:87)
4. Portal sync Aadhaar send — FIXED (off by default via SEND_AADHAAR_EXTERNAL, sync_worker.py:36,134)
5. bank_ifsc encrypted — FIXED (backend/models.py:132)
6. Dependency CVEs — OPEN, unverified (pip-audit not re-run; cryptography==44.0.0, pyjwt==2.10.1 in requirements.txt:6-7)
7. CORS tightened + rate limits — FIXED (backend/main.py:211-234, 307, 375, 400)
8. Supervisor accounts / RBAC — DECISION-NEEDED (backend/main.py:438 "no roles table")
9. Offline attendance write-buffer — OPEN (none found in mobile/src)
10. CI gate — OPEN (no .github/ directory)
- Crash reporter: none (no Sentry/Bugsnag/Crashlytics in mobile/package.json or backend/requirements.txt).
- Also see memory: real-Portal creds, Aadhaar-search, real-device verification.

## Run & verify commands
- Types: `cd mobile && npx tsc --noEmit`
- Backend suite: `cd backend && python run_verify_suite.py`
- Single check: `cd backend && python verify_<name>.py`
