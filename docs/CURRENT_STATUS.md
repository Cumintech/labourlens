# Current status (updated 2026-10-06)

## Where I left off
- Branch `chore/home-ism-quicklink`: Home screen restored to the pre-classification Today card; Workforce card and filter chips removed; "ISM contractors (N)" quick link added (opens Workers filtered).
- Still in Expo Go testing; real EAS build not started.

## Done (recent, from git log)
- Worker employment classification (Permanent/Contractor/ISM) — 3257715
- Click-to-WhatsApp support; gated create_all() to dev; test runner — 74d6088, 7af2618
- Ask Labour Lens chips; Plans page + upgrade requests — a069e74, 75fa2ef
- Compliance check + polish; worker compliance deep links — e300d85, 9545f0e, 32c239e
- UI restyles (Today, Reports, Workers, Wages, Attendance) — 5b6ff0c..73fab75

## Next
- Finish Expo Go testing, then real EAS build.
- Resolve DECISION-NEEDED / OPEN items below before any real factory.

## Open pilot blockers (vs ARCHITECTURE_REVIEW §2)
1. OCR debug print of Aadhaar/name — fixed in this branch (backend/ocr.py:333-334 removed)
2. Privacy policy discloses biometric + bank/IFSC — FIXED (backend/privacy_policy.py:39,50)
3. MAX_WORKERS_PER_OWNER=50 — DECISION-NEEDED (backend/main.py:87,539)
4. Labour Portal sync sends full Aadhaar — DECISION-NEEDED (backend/sync_worker.py; wired at main.py:1978)
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
