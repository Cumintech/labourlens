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

## Biometric attendance sync layer (ZKTeco)

Integration layer for ZKTeco fingerprint devices, built and fully tested without physical hardware. The device-connection logic is isolated behind one interface (`biometric.BaseConnector`) so switching from mock data to a real device is a config change, not a code change.

**What's built:**
- Data model: `biometric_devices`, `device_user_mapping`, `biometric_punches`, `biometric_consents`; `workers.numeric_employee_code` (doubles as the device's User ID for the common case).
- `MockConnector` / `ZKTecoConnector`, selected via `BIOMETRIC_CONNECTOR` env var (`mock` default, or `zkteco`).
- Sync job (`biometric_sync.py`): resolves punches to workers (mapping, else direct employee-code match), dedups on `(device_id, raw_device_user_id, timestamp)`, writes attendance through the same shared `attendance_service.upsert_attendance` used by manual marking (never a parallel path), and never overwrites a manually-marked day.
- Enrollment: employee-code-as-device-ID (preferred) or manual mapping screen (fallback), with a post-enrollment verification punch and disambiguated worker display (name + employee code + status) everywhere a worker is picked in this flow.
- Health & visibility: per-device online/offline + `last_synced_at`, 30-minute stale threshold, unmapped-punch and pending-sync counts surfaced in the admin/mobile UI; every attendance record shows its source (`Biometric — device — timestamp` or `Manual override — supervisor — reason`), never a bare tick.
- DPDP consent: one-time, timestamped `BiometricConsent` record captured in Worker Details onboarding; enrollment (device mapping) is server-side blocked with a 422 if consent hasn't been captured yet — not just a UI checkbox.
- Test coverage: `backend/verify_biometric_sync.py` — normal sync, duplicate punch (no double-insert), unmapped device_user_id (flagged, not dropped, doesn't crash), backlogged/out-of-order timestamps landing on the correct date, manual-override protection, connection timeout / partial read / device-busy handling. All passing against `MockConnector`.

**Mocked vs. real:**
| Piece | Status |
|---|---|
| Data model, migrations | Real — same schema used for mock and real punches |
| Sync/mapping/dedup/attendance-writing logic | Real — identical code path for both connectors |
| `MockConnector` | Fully real, used for all current testing (`default_mock_batch()`: normal in/out pairs, one unmapped ID, one backlogged pair) |
| `ZKTecoConnector` | Structurally complete (`pyzk` connect → `disable_device()` → `get_attendance()` → `get_users()` reconcile → `enable_device()`/disconnect, TCP/UDP + comm password, timeout/busy/partial-read handling) but **never run against a real device** |
| `pyzk` dependency | Commented out in `backend/requirements.txt` (lazy-imported only if `ZKTecoConnector` is actually selected) |

**Checklist for the first real-device integration test:**
1. Uncomment `pyzk==0.9` in [`backend/requirements.txt`](backend/requirements.txt), `pip install`, set `BIOMETRIC_CONNECTOR=zkteco`.
2. Confirm networking prerequisites: device has a static IP or DHCP reservation, reachable from the backend host over LAN/VPN on TCP port 4370 (or UDP if `force_udp` is needed for that model).
3. Confirm the device's comm password format matches what `ZKTecoConnector` sends (int-cast) — mismatches fail silently on some firmware.
4. Verify `pyzk`'s actual `punch_type` codes for this specific device model match the assumed in/out mapping — ZKTeco firmware isn't fully consistent across models here.
5. Register one real worker with an employee code as the device's enrolled User ID, do a real fingerprint punch, run a sync cycle, and confirm: the punch lands as `source="device"`, resolves to the correct worker, and a verification punch round-trip confirms it's not a "wrong Ramesh" (id collision).
6. Confirm `disable_device()` / `enable_device()` and memory-clear-after-confirmed-write behave correctly on the real unit — this can only be verified against real firmware, not mocked.
7. Re-run `verify_biometric_sync.py`'s scenarios manually against the real device: unmapped ID, duplicate punch, connection drop mid-sync, backlogged punches from being briefly offline.
