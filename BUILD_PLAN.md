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
- **Real-device verification via Expo Go** — Day 1's login screen and
  navigation shell were only verified at the API/bundler level (no
  emulator available in this environment). Day 2 is the first day there's
  a camera-dependent feature (Aadhaar scan), which can't be meaningfully
  tested any other way — so this is where actual on-phone testing starts,
  not something to keep deferring. Covers: Day 1's login flow tapped for
  real, plus every Day 2 screen (scan, manual-correction, save) on an
  actual device.

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

### Day 1 — done

**Achieved**
- SPEC.md + DATA_MODEL.md written from the deck + confirming brief.
- Backend: owner signup/login/me (bcrypt + JWT), field-level PII
  encryption verified genuinely at rest (not just via the ORM's own
  decrypt path — checked the raw SQLite bytes directly).
- Test Portal: separate mock app, HTML-form-based (matching the real
  Portal's no-API reality), full login/create/deactivate flow verified
  via curl.
- Mobile: Expo scaffold, working login screen wired to the real backend,
  navigation shell with placeholders for the other screens. `tsc --noEmit`
  clean; Metro bundler forced to actually bundle (996 modules, no errors).
- Repo created at github.com/Cumintech/labourlens (**private** — this
  project handles PII-adjacent code and will eventually hold real Portal
  automation logic, so private was the default choice, not asked about;
  flag if it should be public instead) and pushed.

**Blockers / open items for Day 2+**
- **Scope discrepancy, needs your confirmation before Day 3**: the spec
  deck (slide 2) describes a Portal-side duplicate-Aadhaar check
  ("shows existing record if found"), which contradicts the brief's
  explicit "no verification round-trip" sync model. Built nothing
  Portal-sync-related yet, so no rework has happened either way — but
  Day 3's Sync Worker design depends on which model is correct.
- **Not verified on an actual physical device.** No Android emulator or
  iOS simulator is available in this environment (no Mac, no Android
  Studio installed) — verification today was: backend endpoints via curl,
  encryption via raw DB inspection, and the mobile bundle via Metro's own
  bundler (996 modules, no errors), but nobody has tapped the actual
  Login button on a real screen yet. See `mobile/README.md` for how to
  run it on your own phone via Expo Go — that's the next real check.
- Aadhaar OCR itself: not started (Day 2). No compliance review performed
  by this assistant — see SPEC.md's note on why that's out of scope for
  an engineering assistant to confirm, restated once, not repeatedly.
