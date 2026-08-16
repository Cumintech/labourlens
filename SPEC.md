# Labour Lens — spec (Day 1)

Mobile app (Android + iOS) for factory owners to register workers via
Aadhaar OCR, track daily attendance, and keep a partner Labour Portal in
sync. Built as a 5-day sprint — each day ships working, testable code, not
just design docs. See [BUILD_PLAN.md](BUILD_PLAN.md) for the day-by-day
plan and daily status log.

## Scope (from `labour-lens-spec-v2.pptx` + the confirming brief)

**Registration**
- Aadhaar scan, front & back — OCR fills known fields (name, DOB, gender,
  Aadhaar number)
- Owner adds remaining minimal data (mobile, state, etc.), then saves
- Manual-correction UI for OCR misreads before saving
- Max 50 workers per owner

**Attendance & reporting**
- Daily Present/Absent, by AM / PM / Evening
- Daily summary ("16 of 20 present")
- Search across workers by name/status
- 6-month attendance report, export (PDF/Excel) + email delivery

**Portal sync**
- New registration → entry auto-created on the partner Labour Portal
  (login-based automation — the Portal has no official API)
- Deactivation → entry removed/updated on the Portal
- Queued + retried on failure; the app's own state is never blocked on
  Portal success — a worker shows Synced / Pending / Failed independently

**Security**
- Owner login — multi-tenant, an owner sees only their own workers,
  enforced at the query/database level
- All PII (Aadhaar, bank, address) encrypted at rest; Aadhaar number
  masked in the UI (last 4 digits visible only)
- Deactivation (and other status changes) logged in a timestamped audit
  trail

## Confirmed context (from the brief, not independently verified by this
assistant — noted so it's traceable, not silently assumed)

- **Not a government system.** The Labour Portal is a partner system, not
  a government IT system — standard automation-fragility risk applies
  (the sync worker breaks if the Portal's UI changes), not special legal
  review.
- **No compliance gate on Aadhaar OCR in this context.** Scan and store
  masked, encrypt at rest, as standard security practice. Worth restating
  plainly since it matters: Aadhaar data is a genuinely regulated category
  in India (Aadhaar Act 2016, UIDAI rules, DPDP Act 2023) — this
  assistant is not positioned to independently confirm this brief's legal
  conclusion, and building this doesn't require re-litigating it, but if
  this app handles real workers' real Aadhaar data in production, that
  conclusion is worth a real legal sign-off before go-live, separate from
  the engineering work here.

## Discrepancy — resolved 2026-08-17

Day 1 flagged a contradiction: the confirming brief says **"no
verification round-trip... no read-back or 'check if already registered'
step,"** while slide 2 of the spec deck describes a Portal-side duplicate-
Aadhaar check ("shows existing record if found").

**Confirmed by the client: no verification round-trip.** The brief's
simplified model is correct — pure fire-and-forget create on
registration, remove/update on deactivation, no read-back, no
duplicate-Aadhaar check against the Portal. The deck's slide 2 is stale;
disregard it for the Sync Worker's design (Day 3). This is now locked in,
not still open.

## Stack (chosen Day 1, see [BUILD_PLAN.md](BUILD_PLAN.md) for why)

- **Mobile**: Expo (React Native + TypeScript) — targets Android and iOS
  from one codebase; testable on a real phone via Expo Go without a Mac or
  Android Studio; production builds compile in Expo's cloud (EAS Build).
- **Backend**: FastAPI + SQLAlchemy + Postgres (SQLite for local dev).
- **Test Portal**: a small separate FastAPI app simulating the real
  partner Portal (its own login, its own worker list) — the only thing
  the Sync Worker talks to through Day 4. The real Portal is never touched
  until Day 5's single supervised cutover test.
