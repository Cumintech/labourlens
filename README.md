# Labour Lens

A Tamil Nadu Factories Act compliance app for factory owners — worker attendance, statutory compliance forms, wage rate management, and payroll.

- **Frontend:** Expo/React Native + TypeScript (`mobile/`)
- **Backend:** FastAPI + SQLAlchemy + Postgres (`backend/`)

See [`SPEC.md`](SPEC.md), [`BUILD_PLAN.md`](BUILD_PLAN.md), [`DATA_MODEL.md`](DATA_MODEL.md), [`PHASE2_BACKLOG.md`](PHASE2_BACKLOG.md), and [`PHASE3_STATUTORY_FORMS_PLAN.md`](PHASE3_STATUTORY_FORMS_PLAN.md) for feature-level design history.

## Production readiness push (Day 1 / Day 2 / Day 3)

Store submission is deliberately deferred to Day 3 so Days 1–2 can focus on fully building, wiring, and testing everything else.

### Day 1 — Infrastructure, security, compliance groundwork

**Done:**
- [x] Postgres (Supabase) provisioned; Alembic initial migration applied
- [x] Full backend regression suite (16 scripts) passes against real Postgres, not just SQLite
- [x] Backend deployed to Render (`https://labourlens-backend.onrender.com`), HTTPS confirmed valid, real signup → login → mark-attendance round trip confirmed against the live deployment
- [x] Fresh production `JWT_SECRET`/`ENCRYPTION_KEY` generated and loaded into Render's env vars (never committed)
- [x] AuditLog extended to cover compliance-record edits and wage-rate changes (previously only activate/deactivate)
- [x] DPDP consent gate: signup is hard-blocked server-side without consent, not just a decorative checkbox; Privacy Policy gained a data-retention section

**Still open — reminder to pick this up during Day 2:**
- [ ] **Supabase backups + restore test.** Check what backup options are actually available on the free tier (Settings → Database → Backups), enable daily backups, then do a real restore into a scratch database to confirm it actually works — "we have backups" that were never restored isn't tested, it's a guess.

**Known deploy gotchas (already fixed, documented here in case they recur elsewhere):**
- Render's default Python image was 3.14, which has no prebuilt wheel yet for `pydantic-core` — pinned via a `PYTHON_VERSION=3.12.7` env var.
- The backend eagerly downloaded EasyOCR's PyTorch model at startup, which OOMs a 512MB free-tier instance before the app can even boot — made skippable via `OCR_WARM_UP=false`. The Aadhaar-scan feature itself may still be memory-tight on the free tier when actually invoked; revisit if that becomes a real blocker.

### Day 2 — Observability, support, billing groundwork, localization, push, test coverage

**Block 1 — Observability:**
1. Create free Sentry and PostHog accounts.
2. Wire `sentry-sdk` (backend) + `@sentry/react-native` (mobile); instrument key events in PostHog (worker registered, attendance marked, form downloaded/emailed, wage rate set).
3. Test: trigger a real backend exception and mobile crash, confirm both land in Sentry within a minute; fire each instrumented event, confirm it appears in PostHog's live stream.
4. Point a real support email or free-tier helpdesk somewhere monitored; swap the placeholder in Help & Support.
5. Test: send a real message through the in-app support path, confirm it arrives.

**Block 2 — Billing groundwork + localization:**
6. Start Razorpay merchant signup (2–4 business day KYC — the longest external clock on the whole list).
7. Integrate Razorpay SDK in sandbox/test mode; build the subscription-tier selection UI.
8. Test: full test-mode transaction with Razorpay's test card, confirm webhook fires and subscription status updates in the DB. *Pending after Day 2: real KYC approval.*
9. Stand up `react-i18next`; translate Home, Login, Dashboard into Tamil.
10. Test: device locale set to Tamil, walk those 3 screens, confirm no English fallback / no clipping. *Pending after Day 2: remaining ~15 screens (deliberately not machine-translated without native-speaker review).*

**Block 3 — Push notifications, production build, automated tests:**
11. Wire Expo push notification infrastructure (device token registration, test-push path).
12. Test: real push to a real device via `expo push:send`, confirm receipt backgrounded and killed.
13. Run the first production EAS build (binary only — store submission stays Day 3).
14. Test: install the production build (not Expo Go) on a real device, walk the full golden path (login, mark attendance, download a form, set a wage rate).
15. Set up Maestro with 4 smoke flows: login, mark attendance, download a form, add a worker.
16. Test: Maestro suite passes against the production build; confirm it fails loudly on a deliberately broken flow.

### Day 3

App Store / Play Store submission only.
