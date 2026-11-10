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

## Statutory minimum wage (2026-11-07, branch claude/labourlens-pre-deploy-review-nl7cff)
- Replaced the flat Rs500/day placeholder. backend/minimum_wage.py + 4 reference tables (employments, classes, Basic versions, DA versions -- Basic and DA versioned separately, append-only). Seeded: TN Rice/Flour/Dhall Mills, 33 classes, DA 292.80/day eff. 2026-04-01 (verified=false -- confirm officially; Basic effective date unknown, sentinel 2000-01-01).
- Rule: daily class = Basic+DA; monthly class = Basic + DA x 30; monthly->daily /26 (weekly /6, my assumption). Compares worker Basic+DA. No class/rate in force => no check (null), never a guess.
- Owner.min_wage_employment_id (Factory Profile) -> Worker.min_wage_class_id (Add Worker / Worker Profile). Migration e3b7a1c9d5f2: BACK UP, run `alembic upgrade head` manually. Test: verify_minimum_wage.py.
- Next DA revision: INSERT a minimum_wage_da_versions row (effective_from 1 April); no admin UI yet.

## OCR scan fix (2026-11-09, fix/ocr-formdata-sdk57)
- Aadhaar scan sent `{uri,name,type}` parts, which SDK 57's fetch rejects ("Unsupported FormDataPart") -> generic network-error popup, Continue stayed disabled. scanAadhaar now uses expo-file-system File like uploadWorkerPhoto. Not yet verified on device; if scan still fails, check Render memory (EasyOCR).

## OCR engine swap (2026-11-09, fix/ocr-lightweight-engine)
- Scan returned 502: EasyOCR (PyTorch, ~1GB) ran the 512MB Render instance out of memory. ocr.py now defaults to RapidOCR (ONNX, no torch; requirements.txt: rapidocr-onnxruntime). Real-server (uvicorn) peak 432MB at OCR_DET_LIMIT_SIDE=960 (default), 354MB at 640; idle 270MB. EasyOCR still works locally: pip install easyocr + OCR_ENGINE=easyocr.
- Engine failure -> 503 "enter manually" (not 502); cause is logged (no card data). Verified only on synthetic cards -- re-test with real cards on device. Render may need opencv-python-headless instead of opencv-python if the log shows libGL.so.1 missing.
- Test: verify_ocr_resilience.py (+ verify_registration / verify_ocr_refinements now run real OCR without torch).

## OCR accuracy: orientation, DOB, name (2026-11-09, fix/ocr-orientation-dob-name)
- Real-phone scan read only the Aadhaar number: card photographed sideways (tall text boxes), DOB took another printed date (issue date), name took garbled "Authority". ocr.py now: applies EXIF rotation; detects sideways pages from box shape and turns them upright, flips upside-down pages (lines come back reversed); DOB only from a DOB/Date-of-Birth line (never back-side/issue dates, must be a real date and age >= 10); name = line above the DOB line, with garbled-boilerplate prefixes excluded; Aadhaar number prefers a Verhoeff-valid number and skips the VID.
- Test: verify_ocr_orientation.py (synthetic cards: upright, rot90/270, upside-down, EXIF; real OCR). Real server: sideways 3000px pair ~2s, peak ~393MB. Still unverified on the owner's real cards.

## Aadhaar scan speed (2026-11-09, perf/aadhaar-scan-speed)
- App: each side is scanned as soon as it is captured (front is read while the back is photographed), photos are shrunk to 1280px/q0.8 before upload, and Add Worker pings POST /workers/ocr/warm to wake the host and load the engine. Server: sideways cards use a cheap detector-only probe + one full pass (was ~3), upside-down pages are fixed by reversing the line list (no second pass); POST /workers/ocr accepts front and/or back; scan time logged ("ocr scan: Ns", no card text).
- Measured on 1 CPU core, dense test card: sideways 2.4s -> 0.9s, upside-down 2.5s -> 0.8s, upright unchanged (~0.9s); peak ~369MB. Not measurable here: the phone's upload time and Render's real CPU. If still slow on Render, the free/starter CPU share is the limit -- check the "ocr scan" log lines.

## Scan slowness, compliance step, minimum-wage block (2026-11-09, fix/scan-threads-compliance-minwage)
- Scan: ONNX Runtime sized its thread pools from the HOST's cores, not the container quota. Measured under a real cgroup quota: 0.5 CPU 7.7s -> 3.0s, 1 CPU 3.1s -> 1.5s per two-sided scan. ocr._ThreadLimit reads the cgroup quota (or OCR_THREADS) and sets intra_op threads; engine load is single-flight; log "OCR engine ready: ..., cpu limit N". Per-scan cost on a 0.5 CPU instance is still ~1.5s/side (text recognition dominates) -- a full-CPU Render plan is the remaining lever.
- Add Worker compliance step: only Salary type and Father/Spouse name are required (red *); Nature of work, joining date, EPF/UAN, ESIC are optional.
- Minimum wage is now enforced: Add Worker step 3 blocks Continue when Basic+DA is below the class minimum (and requires a class when the factory has an employment set); POST /workers/{id}/wage-profile returns 422 for a below-minimum rate (class assigned, rate in force on the effective date). Workers without a class, or dates before any DA version, are not checked. Auto-created rates from a Worker Type default are not checked.

## Metro bundle trim (2026-11-10, fix/master-with-metro-trim)
- Replaces unmerged PR #12 (conflicted with master). Icons come from src/icons.ts (per-icon paths) and App.tsx imports only the 3 fonts used: dev bundle ~3,963 -> ~2,161 modules. Add new icons to src/icons.ts, never import from the lucide package root.

## New ID card format (2026-11-10, feat/id-card-new-format)
- forms.build_id_card_v2: two-page portrait CR80 card (front: factory header/address/registration no., photo, name, father's/husband's name, DOB, blood group, employee no., nature of employment, date of issue, issuing authority; back: permanent/present address, 4 conditions, holder signature). Tamil-safe; long names wrap to 2 lines, addresses to 3 ("..." only if still too long).
- POST /workers/{id}/id-card uses it for workers created on/after ID_CARD_NEW_FORMAT_FROM (env, default 2026-11-10); earlier workers keep the one-sided card; ?layout=new|classic forces either.
- New optional Worker.blood_group (migration f4c8b2d6a1e3: BACK UP, run `alembic upgrade head` manually) set in Add Worker step 2; blank line on the card if unset. No edit screen for it yet.

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
