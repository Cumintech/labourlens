# Labour Lens — 5-day build plan

Build sprint — each day ships working, testable code. See
[SPEC.md](SPEC.md) for scope and [DATA_MODEL.md](DATA_MODEL.md) for the
schema. Anything beyond this 5-day scope (consultant multi-client
support, license/deadline management, broader statutory compliance) is
tracked in [PHASE2_BACKLOG.md](PHASE2_BACKLOG.md) — designed where useful,
explicitly not being built during this sprint.

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

## Day 3 — Portal Sync Worker + OCR refinements from real-device testing

**OCR/registration fixes** (added 2026-08-17, from real-card test results
— name/DOB/Aadhaar/address all tested against an actual card, not just
the synthetic test image):
- **Address**: add OCR extraction — was previously owner-entered only
  (matching the original mockup's "Owner adds" column), but confirmed
  real-card testing shows this should now be pulled from the scan too.
  Back-of-card text is denser and multi-line, so this needs its own
  parsing logic, not a copy of the name/DOB/Aadhaar regexes.
- **Name**: real-card test showed the wrong line getting picked — likely
  a regional-language line, since Aadhaar cards print the name in both
  English and a regional script and the current heuristic doesn't
  distinguish between them at all. Fix: filter candidate name lines to
  ones that are predominantly Latin-script (English), not just "first
  non-boilerplate line with enough letters."
- **Gender**: extraction already exists (`GENDER_KEYWORDS` in
  `backend/ocr.py`) but wasn't confirmed working on the real card the
  same test covered — verify it's actually firing reliably, harden if
  not (same class of issue as name: real-card OCR noise the synthetic
  test image never exercised).
- Re-run `backend/verify_registration.py` after these changes, and
  re-test on the real device — synthetic-image tests alone already
  proved insufficient once, don't repeat that mistake for these fixes.

**Portal Sync Worker** (original Day 3 scope):
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

### Day 2 — done, including real-device verification

**Achieved**
- Aadhaar OCR (`backend/ocr.py`): server-side, EasyOCR — see the file's
  docstring for why server-side (not on-device: plain Expo Go can't load
  native OCR modules without switching away from the simple "scan a QR
  code" flow) and why EasyOCR over Tesseract (no package manager on this
  dev machine, official Tesseract installer blocks non-browser
  downloads). Extracts name/DOB/gender/Aadhaar number via regex over the
  raw OCR text — genuinely imperfect on purpose, which is exactly why the
  manual-correction UI exists.
- `POST /workers/ocr`, `POST /workers` (encrypts PII via Day 1's crypto
  layer, enforces the 50-per-owner limit), `GET /workers`, `GET
  /workers/{id}` — all scoped to the authenticated owner.
- Verified via `backend/verify_registration.py` (self-contained, no
  external fixture file): real OCR extraction, PII confirmed encrypted at
  rest via raw SQLite bytes (not just the ORM's own decrypt path), API
  responses never leak the raw/encrypted Aadhaar number, a second owner
  can neither list nor fetch Owner A's worker (multi-tenant scoping), and
  the 50-worker limit rejects a 51st worker with 422. All pass.
- Mobile: real camera-capture scan screen, a real manual-correction
  screen (fields OCR missed are visibly flagged, not just silently
  blank), and a real worker list wired to the backend (replacing Day 1's
  placeholder — needed some way to see that Save actually persisted).
  `tsc --noEmit` clean; Metro bundle forced and verified (1003 modules,
  no errors).
- Backend (bound to `0.0.0.0:8010`, not just `127.0.0.1`) and the Expo
  dev server are both running now and confirmed reachable on this
  machine's LAN IP (`192.168.1.6`) — ready for the real-device step
  below.

**Real-device verification — done, by the user (I have no physical
device access)**
- Two real bugs found and fixed only because this actually happened on a
  phone, not just in my own verification: SDK 57 vs. the store's SDK
  54-pinned Expo Go ("project is incompatible with this version of Expo
  Go"), and the login password field auto-capitalizing its first
  character (`autoCapitalize="none"` was missing) — silently turning
  "ganesh" into "Ganesh" before it was ever sent. Confirmed via the
  backend's own access log that requests were reaching the server fine
  and getting genuine 401s, which is what pointed at something mangling
  the password client-side rather than a connectivity problem.
- **Real Aadhaar card scan results**: DOB and Aadhaar number extracted
  correctly — confirms the regex-based extraction genuinely works on a
  real card, not just the synthetic test image. Name extraction picked
  the wrong line (see Day 3's OCR refinements above — likely grabbed a
  regional-language line instead of the English one). Address wasn't
  extracted, which is correct as-built — the original mockup only ever
  scoped Name/DOB/Aadhaar to OCR, with address under "Owner adds" — now
  being expanded into OCR scope per the user's Day 3 addition above.

### Day 3 — done

**Achieved**
- **Real mockup colors applied app-wide.** The deck's earlier text-only
  extraction never captured shape fill/font colors — pulled them properly
  this time via python-pptx's color APIs (navy #1B2340, teal #1F9D82,
  amber #E2A63D, danger #D9534F, plus the light background tints) and
  applied them to every screen and the navigation header. `mobile/src/theme.ts`
  is the single source of these values now.
- **OCR refinements from real-card testing**: found and fixed a real bug
  (gender matching checked "MALE" before "FEMALE" via substring `in`
  checks — "MALE" is literally a substring of "FEMALE", so a female
  card's OCR text would have incorrectly matched "Male" first; fixed with
  word-boundary regex). Name extraction now filters to predominantly-
  Latin-script lines, preferring the English line over a regional-script
  one. Address extraction added (new capability, not a fix — it never
  existed before, matching last week's mockup's original "owner adds"
  scoping). All three verified via `backend/verify_ocr_refinements.py`,
  plus a full re-run of `verify_registration.py` to confirm nothing
  broke.
- **Portal Sync Worker**, real Playwright browser automation against the
  real Test Portal (not mocks): login, create-worker, deactivate-worker.
  One browser session per owner, not per worker. Matching key for
  deactivation is the **full Aadhaar number** (confirmed by the user —
  not name, which risks duplicates/instability, and not an external-
  reference field, which only works if the real Portal has an equivalent
  one, unknown). Portal credentials stored per-owner (confirmed: each
  factory owner has their own separate Portal login), encrypted the same
  way as Worker PII.
- Verified via `backend/verify_sync_worker.py` against the actually-
  running Test Portal: registration → pending sync_status → real
  automated Portal creation → confirmed present via the Portal's own
  search endpoint (a separate authenticated session, not just trusting
  our own database) → deactivation → confirmed inactive on the Portal
  side too. Also tested a genuine failure path (wrong Portal password)
  end to end — confirmed it fails loudly with a real recorded error, not
  silently.
- Manual `/sync/run` trigger added so testing doesn't wait for a real
  daily schedule — production cadence (once-daily, confirmed earlier) is
  still not wired to an actual scheduler; that's a real gap, not
  forgotten, see below.

**Not done / open**
- **No actual daily scheduler exists yet.** `/sync/run` is manual-trigger
  only. Where this runs in production (in-process vs. separate service)
  was explicitly left open in an earlier conversation — still open, and
  now slightly more concrete since the code exists to hang a scheduler
  off of, but nothing schedules it automatically yet.
- **Real-device verification of the Day 3 changes (theme colors, OCR
  fixes) has not happened yet** — the user said they'd check on their
  phone later. Everything above was verified at the API/browser-
  automation level, which is real, but not the same as confirming it
  looks and works right on an actual device — same caveat as every prior
  day whenever this gap exists.
- Whether the *real* Portal has a searchable-by-Aadhaar interface (the
  thing `/workers/search` on the Test Portal stands in for) is still
  unconfirmed — same category of open question as Day 5's eventual
  cutover risk list.
