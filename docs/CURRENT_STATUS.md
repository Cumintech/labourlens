# Current status (updated 2026-10-06)

## Where I left off
- Branch `chore/home-ism-quicklink`: Home screen restored to the pre-classification Today card; Workforce card and filter chips removed; "ISM contractors (N)" quick link added (opens Workers filtered).
- Still in Expo Go testing; real EAS build not started.

## Test-report fixes (2026-10-28, uncommitted, branch not created)
- Done: contract worker type, weekly salary type, LOP proration (backend/forms.py compute_wage), Android save-to-folder for PDFs (mobile/src/pdfShare.ts), Reports regrouped, Add Worker scroll/keyboard fix, OCR 12-digit fallback. Test: backend/verify_wage_lop.py.
- Open: min-wage comparison, photo/logo ID layout (#6, needs clarification), NFH rules, device re-test of scroll + Downloads save.

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
