# Labour Lens — Independent Architecture & Code Review

Reviewed at commit `69583ba` on `master` (branch `claude/labour-lens-arch-review-lf3yh4`), read-only.
Every claim below is tagged **VERIFIED** (read in code or produced by a command run during this review),
**INFERRED** (reasoned from what was read, not directly executed), or **NOT VERIFIABLE FROM REPO**
(infra, legal correctness, real-device behavior). No code, config, or dependency was modified.

The repo already contains `ONBOARDING.md`, a code-verified engineering reference written by an earlier
session. It is accurate everywhere this review spot-checked it (tenancy pattern, JWT shape, no-offline-sync,
no-Gupshup/Railway, no-RLS, migration count) and is cited below alongside direct evidence rather than
re-deriving facts it already got right. This review's job is the layer `ONBOARDING.md` doesn't do:
severity, risk, product fit, and what to do first.

---

## 1. Verdict

**Not ready for a first pilot as-is, but close — the blockers are mostly small and fast to fix, not
architectural.** Three things must be fixed before any real worker's data goes through this app: a debug
log line that prints full Aadhaar numbers and names to stdout on every scan (`ocr.py:325-326`), a Privacy
Policy that doesn't disclose the biometric, bank/IFSC, or third-party Portal data flows the app actually
has, and the 50-worker hard cap that will block onboarding the moment a real factory tries to register its
full floor. None of these need a redesign — they're a deleted line, a rewritten policy paragraph, and a
config constant. Behind those, the core (tenancy discipline, wage arithmetic, PDF pipeline, migration
hygiene) is more solid than a 5-day-sprint-turned-multi-phase project has any right to be, and the project's
own `verify_*.py` scripts (25 of 26 passed when run fresh in this review) back that up.

**Overall risk: MEDIUM.** The multi-tenant boundary — the one thing that would be catastrophic to get
wrong — is enforced consistently everywhere this review checked, by hand, with no second line of defense
(no Postgres RLS). That's a real structural risk for the future, not a bug found today. The active risk
right now is data-handling hygiene (PII in logs, an incomplete privacy disclosure, an unencrypted IFSC
column, vulnerable pinned dependencies) and product fit (the worker cap, zero offline handling for a
connectivity-unreliable user base, no sub-owner roles despite that being a stated architectural goal), not
a broken system.

---

## 2. Top 10 actions, ranked

1. **Delete the OCR debug log line that prints full names/DOB/Aadhaar/address to stdout.** `backend/ocr.py:325-326`. Severity: BLOCKER. Effort: S.
2. **Rewrite the Privacy Policy to disclose biometric/fingerprint data, bank/IFSC, and the Labour Portal data transmission** — currently silent on all three. `backend/privacy_policy.py`. Severity: BLOCKER. Effort: S.
3. **Raise or remove `MAX_WORKERS_PER_OWNER = 50`** before onboarding any real factory. `backend/main.py:66,331`. Severity: BLOCKER (product fit). Effort: S.
4. **Decide the fate of the Labour Portal sync feature** (`sync_worker.py`) — it silently sends every worker's full decrypted Aadhaar number to an external, undisclosed third-party system with no read-back/verification, and it's outside the v1 scope you described. Severity: HIGH. Effort: S (disable) / L (do it properly with consent + encryption in transit + disclosure).
5. **Encrypt `Worker.bank_ifsc`** — the one bank/PII field on `Worker` left as plaintext while every sibling field (`bank_account_number`, addresses, Aadhaar) is `EncryptedString`. `backend/models.py:112`. Severity: HIGH. Effort: S.
6. **Upgrade the 5 dependencies `pip-audit` flagged with known CVEs**, especially `cryptography` (backs your PII encryption) and `pyjwt` (backs your entire auth model). Severity: HIGH. Effort: S.
7. **Add login rate-limiting and tighten CORS off `allow_origins=["*"]`** before this is a public, App-Store-listed app. `backend/main.py:139-144`. Severity: MEDIUM-HIGH. Effort: S.
8. **Give supervisors real accounts, or explicitly accept "owner shares one login" as the v1 model and say so out loud** — the product brief states RBAC as an early architectural concern; the code has none inside a tenant. Severity: HIGH (product fit). Effort: M (real fix) / S (document the decision).
9. **Add a minimal offline write-buffer (or at least a "saved locally, will retry" state) for attendance marking**, or explicitly accept and communicate that a dead zone on the factory floor loses that mark. Severity: HIGH (product fit, given your stated "unreliable connectivity" user base). Effort: M-L.
10. **Wire up even a minimal CI gate** (run the 26 `verify_*.py` scripts + `tsc --noEmit` on every push) — right now every `git push` deploys straight to production with zero automated check. Severity: HIGH (solo-maintainer risk). Effort: S.

---

## 3. Plan vs reality

| Claim (product context / planning docs) | What the code actually does | Gap |
|---|---|---|
| Stack: Railway (backend), Gupshup (WhatsApp) | Backend runs on **Render**; zero WhatsApp/Gupshup code exists anywhere (`ONBOARDING.md:60-66`, confirmed by this review's own repo-wide grep — WhatsApp appears only in `PHASE2_BACKLOG.md:88` as an unconfirmed idea) | Full mismatch — if a pilot conversation assumes WhatsApp delivery of forms, it doesn't exist |
| "Role-based access as an early structural concern" | Exactly two, non-overlapping login types (`Owner`, `AdminUser`); zero roles *within* a tenant — no supervisor/manager concept, no permission table (`auth.py`, `admin_auth.py`, `models.py`) | A stated architecture decision that was never built. One owner login per factory, full stop. |
| "Punch source tagging and offline sync support" | Punch source tagging: real (`Attendance.source`, `models.py:152`). Offline sync: **does not exist** — confirmed by this review's own grep of `mobile/src` for `offline`/`NetInfo`/`queue`/`pending` (zero relevant matches, no `@react-native-community/netinfo` dependency) | Half the claim is true, half doesn't exist at all |
| "form_templates table keyed by (state, form_code) with JSON field mappings for multi-state expansion" | Table exists, keyed correctly (`models.py:526-545`), but has **no JSON mapping column** — it's `state`, `form_code`, `label`, `is_available` only. Field mapping lives in hardcoded Python (`forms.py`'s `build_form25`, `build_form12`, etc.) | Adding Karnataka's real forms later means writing new Python functions, not adding data rows — the "data-driven multi-state" design wasn't actually implemented, only the availability flag was |
| "Biometric path via ZKTeco... with a mock-first layer" | Accurate. `pyzk` is deliberately uninstalled, `ZKTecoConnector` is code-complete but never run against real hardware (`biometric.py:1-14`, `requirements.txt:50-57`) | No gap — this one was described honestly as unbuilt-against-hardware from the start |
| "Manual trial-to-paid flow" | `Factory.status` (trial/active/payment_overdue/suspended/churned) is admin-editable, but **nothing anywhere checks it** — `get_current_owner` only checks `deleted_at`. A "suspended" factory keeps full API access forever (`main.py:158-172`, confirmed by grep: `factory.status` is read only for display) | The status field is informational only; there is no actual lock/unlock mechanism despite the name |
| PHASE3_STATUTORY_FORMS_PLAN.md header: "Not yet started" | Every form in it is fully built and shipping (`ONBOARDING.md §9`, confirmed: `forms.py` has all 5 `build_*` functions, `verify_forms.py` passes) | Doc rot, not a real gap — but anyone reading this file cold would wrongly conclude the phase hasn't started |
| DATA_MODEL.md: 5 tables (Day 1 scope) | 22 tables (`models.py`, confirmed by counting `^class ` definitions) | Doc is 17 tables stale; don't use it for anything beyond history |

---

## 4. Findings by area

### 4.1 Overall architecture

- **ARCH-01** / LOW / VERIFIED. All 78 endpoints live in 3 flat files (`main.py` 1594 lines, `biometric_api.py`, `admin.py`) with no package structure, no `relationship()` declarations anywhere (every join is a manual `db.query().join()`). This is a deliberate, consistent style, not accidental sprawl — it's genuinely easy to grep and reason about at this size. It will get harder to navigate past a few thousand more lines; not urgent now.
- **ARCH-02** / LOW / VERIFIED. `sync_worker.py` (Playwright-driven Labour Portal automation) is architecturally and functionally disconnected from everything else Phase 3 built — it's a separate subsystem from an earlier scope that nothing in the statutory-forms/biometric work depends on or references. See FORM/SEC findings below for why this is more than a tidiness issue.
- **ARCH-03** / LOW / VERIFIED. No dead code of consequence found beyond `photo_storage.delete_worker_photo` (`photo_storage.py:109-125`), which is unused but harmless and explicitly documented as intentionally kept.

### 4.2 Multi-tenancy (highest-stakes area)

- **TEN-01** / MEDIUM / VERIFIED. There is no database-level tenant isolation — no Postgres Row-Level Security, no tenant-scoped connection. Isolation is a hand-applied `.filter(Model.owner_id == owner.id)` convention, stated explicitly as the rule in `auth.py:46-48`. This review read every route in `main.py`, `biometric_api.py`, and `admin.py` and found the filter consistently applied — **no live cross-tenant leak was found**. But there is zero defense in depth: one missed filter in a future PR is invisible until a customer notices another factory's workers. Recommend either Postgres RLS (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` keyed on a session-local `owner_id`) or, cheaper, a lightweight query-audit test that fails CI if a new model/route lacks the pattern.
- **TEN-02** / LOW / VERIFIED. `delete_worker_type` (`main.py:826`) does `db.query(models.Worker).filter(models.Worker.worker_type_id == worker_type_id).update(...)` with no `owner_id` filter in that specific query — safe today only because `worker_type_id` was already confirmed to belong to the caller's own `WorkerType` two lines earlier, so no other owner's worker could reference it. Still worth adding the redundant filter, since it's the one query in the file that relies on an FK-chain argument instead of its own explicit scope.
- **TEN-03** / LOW / VERIFIED. `form_templates` and `admin_user` are correctly *not* tenant-scoped (reference data / separate login system respectively) — confirmed intentional and documented, not an oversight.

### 4.3 Authentication, authorization, RBAC

- **AUTH-01** / HIGH / VERIFIED. No rate limiting anywhere in the backend (confirmed by grep: no `slowapi`, no rate-limit middleware, no attempt counter on `/owners/login` or `/admin/login`, `main.py:251-260`, `admin.py:81-86`). A single-admin account with full visibility into every factory's data has no brute-force protection at all.
- **AUTH-02** / HIGH / VERIFIED. Product context states RBAC as "an early structural concern." The actual code has exactly two non-overlapping login types (`Owner`, `AdminUser`) and zero roles inside a tenant — no manager/supervisor, no permissions table (`auth.py`, `admin_auth.py`, confirmed no roles table in `models.py`'s 22 tables). Every factory floor supervisor who needs to mark attendance must be handed the owner's own mobile number and password, or the owner must do every mark personally. This is a real first-week friction point for a factory with more than one person who touches the app.
- **AUTH-03** / MEDIUM / VERIFIED. JWT is flat 7-day expiry, no refresh flow, no server-side revocation beyond the `deleted_at` check (`auth.py:18-20,42-69`). A leaked/stolen token is valid for up to a week with no way to kill it short of deleting the account. Acceptable for a pre-pilot single-device-per-owner assumption; won't scale to "owner's phone is lost/stolen" without a manual DB intervention.
- **AUTH-04** / MEDIUM / VERIFIED. CORS is wide open (`allow_origins=["*"]`, `main.py:139-144`), explicitly flagged in its own comment as a Day-1 shortcut never revisited. Low risk today (Bearer-token auth, no cookies, so CSRF isn't in play), but it means literally any website can call this API from a browser on behalf of a user who has a token in local storage/JS reach.
- **AUTH-05** / LOW / VERIFIED. Admin/Owner token separation is done correctly — a shared `JWT_SECRET` but a `type` claim that makes the two token shapes mutually rejecting (`admin_auth.py:1-8,35-53`, confirmed by reading `get_current_owner`/`get_current_admin` side by side). No cross-privilege-escalation path found.
- **AUTH-06** / LOW / VERIFIED. Mobile stores the JWT in plain `AsyncStorage`, not `expo-secure-store` (`AuthContext.tsx:1,5-6,41-42`), even though `expo-secure-store` is an installed dependency and is used for the App Lock PIN. Inconsistent, and on a rooted/jailbroken or backed-up device the token is more exposed than it needs to be. Low severity because the token is short-lived-ish (7 days) and scoped to one tenant's data.

### 4.4 Data model and database

- **DATA-01** / HIGH / VERIFIED. Every money field (`WageProfile.basic/hra/da/other_allowances`, `WagePayment`, `FactoryPayment.amount`, everything in `WorkerWageOut`) is `float`, not `Decimal`/fixed-point (`models.py:271-277`, `schemas.py` throughout). Floating-point rounding on wage/PF/ESI arithmetic that ends up on a legally-retained statutory register and a worker's payslip is a real, if usually small, correctness risk — and a "the numbers on the wage slip don't quite add up" complaint is exactly the kind of thing that erodes trust with a first pilot customer's accountant.
- **DATA-02** / MEDIUM / VERIFIED. No explicit secondary indexes anywhere in `models.py` beyond what unique constraints create implicitly (confirmed: zero `index=True` / `Index()` in the file). `Attendance` is filtered by `worker_id`+date range and joined via `Worker.owner_id` on nearly every hot path (dashboard, forms, reports); fine at 50 workers/owner, will matter the moment the worker cap (Top Action #3) is lifted.
- **DATA-03** / MEDIUM / VERIFIED. `Worker.bank_ifsc` is a plain `String`, the one bank/PII field not wrapped in `EncryptedString` while `bank_account_number`, all four address fields, and the Aadhaar number are (`models.py:107-112`). Looks like a genuine oversight, not a documented decision — no comment explains the asymmetry.
- **DATA-04** / LOW / VERIFIED. Timestamps are stored as `DateTime(timezone=True)`, but SQLite silently drops timezone-awareness on round-trip (unlike Postgres) — the code compensates for this in at least three separate places with the same manual `if tzinfo is None: replace(tzinfo=utc)` patch (`main.py:164-169`, `biometric_api.py:62-68`, `biometric_sync.py:29-36`). Correct as written, but it's the same fix copy-pasted three times rather than centralized, and it's a footgun for local dev (SQLite) vs. production (Postgres) parity if a fourth call site is added without remembering the pattern.
- **DATA-05** / LOW / VERIFIED. All calendar dates (`Attendance.date`, shift `start_time`/`end_time` as free-text `"HH:MM"`) are naive, no explicit IST anchor. `_shift_duration_hours` (`forms.py:323-343`) does handle an overnight shift wrapping past midnight correctly. No evidence of a UTC/IST mismatch bug, but there's also no test that a shift crossing midnight is attributed to the correct calendar day for wage purposes — worth a targeted `verify_*` addition before relying on it for a real night-shift factory.
- **DATA-06** / LOW / VERIFIED. Soft-delete is used consistently and correctly where it matters (`Owner.deleted_at`, `Worker.status`/`deactivated_at`) with an explicit, documented legal justification (Tamil Nadu Factories Act retention) — this is one of the better-reasoned parts of the schema.
- **DATA-07** / LOW / VERIFIED. Migration hygiene is good: 7 linear migrations, no branches, ran cleanly against a fresh SQLite DB in this review (`alembic upgrade head` — see §8), and the schema matches `models.py` with no drift found.

### 4.5 Attendance engine

- **ATT-01** / HIGH / VERIFIED (design), NOT VERIFIABLE FROM REPO (real-world impact). There is no offline write buffer at all. `markAttendance()` is a direct `fetch` POST (`mobile/src/api/client.ts`); a failed request just fails, with a manual-retry error state and no local persistence. Confirmed no `NetInfo`, no queue, no `AbortController`/timeout anywhere in the 989-line API client (grep, this review). Given the stated user base (low-to-mid Android phones, unreliable factory-floor connectivity), a dead zone silently loses that mark unless the owner notices and retries. This is the single biggest gap between the stated product context ("offline sync support") and the code.
- **ATT-02** / LOW / VERIFIED. Upsert-on-`(worker_id, date, slot)` is the single shared write path for both manual and biometric marking (`attendance_service.py`), which is the right design — one place, one behavior, backed by the DB's own unique constraint. No idempotency-key scheme exists beyond that constraint, which is sufficient for the current single-writer-per-request pattern but would need real idempotency keys if concurrent writers (app + biometric sync racing) become common.
- **ATT-03** / LOW / VERIFIED. A manual correction is protected from being silently overwritten by a later biometric sync (`biometric_sync.py:138-141`, `if existing_attendance and existing_attendance.source == "manual": continue`) — a real, deliberate conflict-resolution rule, and the right one (a human's explicit correction should win).
- **ATT-04** / MEDIUM / VERIFIED. "Hours worked" is the shift's *configured* duration whenever present, not a real clock-in/out time (`forms.py:323-343`, confirmed as a deliberate, disclosed v1 tradeoff in `PHASE3_STATUTORY_FORMS_PLAN.md`). This means the generated Form 25/25-B "hours worked" columns are not backed by actual clocked time — a labour inspector who asks "how do you know he actually worked 8 hours" has no clocked-time answer, only "the shift says 8 hours and he was marked present." NEEDS LEGAL/DOMAIN VERIFICATION whether this is acceptable for a statutory register in practice; it should at minimum be stated plainly on the generated PDF, not just in an internal planning doc.

### 4.6 Biometric integration

- **BIO-01** / BLOCKER-for-that-feature / VERIFIED. No physical ZKTeco device has ever been connected; `pyzk` is commented out of `requirements.txt`; `ZKTecoConnector` is code-complete but has zero real-world runtime (`biometric.py:137-240`, `requirements.txt:50-57`). Nothing here is hidden — the code says this about itself in multiple docstrings — but it means the biometric feature is demo-only today.
- **BIO-02** / HIGH / VERIFIED + INFERRED. The network topology problem is real and unsolved: a cloud-hosted backend (Render) cannot reach a ZKTeco terminal sitting behind a factory's own router on port 4370 without a VPN, reverse tunnel, or on-site bridge/agent of some kind — the code's own comment says exactly this (`mobile/src/hooks/useAutoBiometricSync.ts:16-22`). The current design (`POST /biometric/devices/{id}/sync` triggered from the *phone app*, which then has the backend try to reach the device directly) only works if the phone and the device are far enough into the same network path that the backend's outbound call can complete — which it generally can't from a phone's mobile data connection reaching into a factory LAN either, unless the phone itself is on the factory Wi-Fi and something makes the device routable from the internet. **This part of the design does not obviously work as drawn and needs a real device + real network test before being presented to a pilot customer as a feature.** Recommend evaluating an on-premise polling agent (a small process on a factory PC/router that pushes punches to your API) instead of the current cloud-pulls-from-LAN model.
- **BIO-03** / LOW / VERIFIED. `MockConnector`'s fidelity is reasonable for what it claims to be: realistic in/out pairs, one deliberately-unmapped punch, and a backlog batch simulating a device reconnecting after downtime (`biometric.py:113-134`). It cannot and does not simulate real firmware quirks (the punch/status code table `ZKTecoConnector` guesses at, `biometric.py:198-203`, is explicitly flagged as needing confirmation against a real unit).
- **BIO-04** / LOW / VERIFIED. Device-user mapping failure mode is handled well: an unresolvable punch is stored with `worker_id = NULL` rather than dropped, surfaced via a dedicated "Unmapped Punches" endpoint, and backfilled retroactively once mapped (`biometric_api.py:209-229`). This is a thoughtful design for a real operational failure mode.
- **BIO-05** / MEDIUM / VERIFIED. Biometric consent is a real, gated record (`biometric_api.py:182-191`, `BiometricConsent` model) — enrollment is blocked without it. But `notice_text` is free text the owner types per worker (`models.py:508-524`), not a fixed, legally-reviewed disclosure — so consent quality depends entirely on what each owner happens to type. NEEDS LEGAL/DOMAIN VERIFICATION whether free-text consent satisfies DPDP's "informed consent" bar for biometric data specifically (a stricter category than ordinary PII).

### 4.7 Statutory forms and wage logic

- **FORM-01** / MEDIUM / VERIFIED. Wage/OT/PF/ESI arithmetic (`forms.py:525-580`) is internally consistent and matches the confirmed formulas in `PHASE3_STATUTORY_FORMS_PLAN.md` (PF on Basic+DA, ESI on Gross, OT at a 2× multiplier, both rate percentages and LWF amount owner-entered rather than hardcoded). The constants `STANDARD_DAILY_HOURS = 8` and `OT_MULTIPLIER = 2` (`forms.py:283-284`) are explicitly flagged in their own comment as unconfirmed against the current notified rules — correctly marked **NEEDS LEGAL/DOMAIN VERIFICATION**, not asserted as correct.
- **FORM-02** / LOW / VERIFIED. The `form_templates` design (state+form_code, `is_available` flag) is sound and appropriately minimal for where the product is — not over-engineered. What's missing is the "JSON field mappings for multi-state expansion" the product context describes; see Plan vs Reality above. Adding Karnataka's real forms is a code change, not a data change, contrary to what the design was meant to enable.
- **FORM-03** / MEDIUM / VERIFIED. Factory-wide forms (Form 25, Form 15) loop every active worker and run several per-worker queries each (`_monthly_attendance_rows`, `_paid_leave_dates`, `compute_wage` — `forms.py:367-408,511-580`) — an N+1-shaped pattern. At the current 50-worker cap this is fine (roughly 100-200 queries per generation); it will need batching (e.g., one query for the whole month's attendance across all workers, grouped in Python) before the worker cap is lifted, or a large muster roll generation will get visibly slow.
- **FORM-04** / LOW / VERIFIED. The custom Tamil text-shaping pipeline (HarfBuzz + FreeType rasterization to sidestep a confirmed ReportLab glyph bug, `forms.py:41-276`) is a genuinely well-diagnosed and well-executed piece of engineering — but it is a large amount of custom, hard-to-debug machinery (font shaping, PNG rasterization, disk-based glyph caching) for two bilingual labels on two forms, maintained by one person. Flagged under Over-engineering below, not as a defect.
- **FORM-05** / LOW / VERIFIED. Every form generation and email is logged (`FormGenerationLog`, written on every successful call in `main.py`'s `_log_form_generation`) — a genuinely useful, low-cost audit trail that several other SaaS products at this stage skip.
- **FORM-06** / NEEDS LEGAL/DOMAIN VERIFICATION. This review cannot confirm the generated Form 12/15/25/25-B field layouts are byte-for-byte correct against the current Tamil Nadu Factories Rules as amended by SRO A-9/2021, nor that the OT multiplier/PF-ESI wage-base rules match the four new Labour Codes once their central rules are notified (May 2026). The code's own comments correctly flag this as unconfirmed in several places rather than asserting correctness — that self-awareness is good practice, but it doesn't substitute for an actual labour-law sign-off before a real factory files these with an inspector.

### 4.8 Security and privacy of personal data

- **SEC-01** / BLOCKER / VERIFIED. `ocr.py:325-326` prints every scanned Aadhaar card's full extracted text — name, DOB, full Aadhaar number, address — to stdout on every registration scan, marked `# Temporary` but still present and unconditional. On Render, stdout becomes the application log, typically retained and often forwarded to log-aggregation tooling. This is the single most concrete DPDP-relevant defect found in this review: real, current, unconditional, and inexpensive to fix (delete two lines).
- **SEC-02** / HIGH / VERIFIED. `sync_worker.py:120-137` sends every worker's real name and **full decrypted Aadhaar number** to an external "Labour Portal" automatically, for every pending create/deactivate action, over Playwright browser automation with no read-back/verification step (`ONBOARDING.md`'s own tech-debt note, confirmed directly by reading `reconcile_owner`/`PortalAutomation.create_worker`). This is a real, active data flow that transmits the single most sensitive field in the whole schema to a third party with the least amount of engineering scrutiny of any code path in the project. Combined with SEC-03 (not disclosed in the privacy policy) and this feature's absence from your stated v1 scope, this needs an explicit decision, not silent continuation.
- **SEC-03** / BLOCKER / VERIFIED. The Privacy Policy (`privacy_policy.py:17-76`) discloses Aadhaar (masked) and worker photos, but a full-text check for "biometric," "fingerprint," "Portal," and "bank"/"IFSC" returns zero matches. The app collects bank account/IFSC details, runs a fully-built biometric-punch subsystem, and (per SEC-02) transmits full Aadhaar numbers to a third party — none of which the one canonical policy document mentions. This is both a legal exposure and an App Store/Play Store Data Safety accuracy problem, since that policy is the one both stores point to.
- **SEC-04** / HIGH / VERIFIED. `bank_ifsc` plaintext — see DATA-03.
- **SEC-05** / MEDIUM / VERIFIED (findings), NOT VERIFIABLE FROM REPO (deployment reality). `pip-audit -r requirements.txt` found known CVEs in 5 pinned dependencies, including `cryptography==44.0.0` (the library backing every `EncryptedString` PII column) and `pyjwt==2.10.1` (the entire auth token system) — see §8 for the full list. There is no CI/dependency-scanning gate anywhere (confirmed: no `.github/workflows/` in the project's own code), so nothing would catch this today short of a manual audit like this one.
- **SEC-06** / LOW / VERIFIED. Field-level encryption (`crypto.py`) uses a single static Fernet key from an environment variable, with no rotation mechanism and no per-tenant key separation — standard for a project this size, but worth naming: losing that one key permanently loses every encrypted field for every tenant at once, and there is no documented key-rotation runbook.
- **SEC-07** / LOW / VERIFIED. Worker ID-card photos in Supabase Storage are keyed by bare `{worker_id}.jpg` (`photo_storage.py:66-71`), a sequential integer with no owner prefix. Not currently exploitable (every read goes through an owner-scoped backend endpoint, confirmed by tracing `generate_id_card`/`upload_worker_photo`), but namespacing by `{owner_id}/{worker_id}.jpg` would be a cheap defense-in-depth improvement and would make a future "export/delete all of this tenant's files" operation trivial instead of requiring a DB join first.
- **SEC-08** / LOW / VERIFIED. No security headers (HSTS, CSP, X-Frame-Options) are set anywhere in the FastAPI app (grep, this review) — low priority for a pure JSON API with no served HTML except the two public privacy-policy pages, but worth a five-minute `Secure` middleware pass before wider distribution.

### 4.9 Mobile app (Expo/React Native)

- **MOB-01** / HIGH / VERIFIED. See ATT-01 — no offline handling of any kind.
- **MOB-02** / MEDIUM / VERIFIED. No request timeout or retry logic anywhere in the 989-line `client.ts` (grep for `timeout`/`AbortController`/`retry`: zero matches). On a flaky factory-floor connection, a request can hang indefinitely with no user-facing timeout, rather than failing fast into the app's own documented error-state pattern.
- **MOB-03** / LOW / VERIFIED. `tsc --noEmit` is clean (0 errors) against the current `tsconfig.json` — see §8. This is a genuinely good sign for a project with no CI enforcing it.
- **MOB-04** / LOW / VERIFIED. Token storage in plain `AsyncStorage` rather than `expo-secure-store` — see AUTH-06.
- **MOB-05** / LOW / VERIFIED. A single global top-level `ErrorBoundary` exists (per recent commit history) to prevent a hard crash from one screen taking down the whole app — a reasonable, low-cost safety net.
- **MOB-06** / LOW / NOT VERIFIABLE FROM REPO. This review did not have a physical device or emulator to test on; low-end Android performance, camera/OCR responsiveness, and permission-flow correctness could not be verified beyond reading the code's own stated real-device findings (multiple commits reference bugs "caught on real-device testing," which is a good practice but means this reviewer is relying on the team's own prior device passes, not independent verification).

### 4.10 Backend API quality

- **API-01** / MEDIUM / VERIFIED. See FORM-03 (N+1 pattern on factory-wide report/form endpoints).
- **API-02** / LOW / VERIFIED. No pagination anywhere (`GET /workers`, `GET /wage-summary`, etc. always return the full list) — a non-issue at the 50-worker cap, will need addressing at the same time as DATA-02/FORM-03 if the cap is lifted.
- **API-03** / LOW / VERIFIED. Validation is consistent and mostly server-enforced (e.g., `date_to < date_from` on leave entries, HH:MM regex on shift times, `Literal` types on enums in `schemas.py`) — no obvious gaps found in the endpoints read.
- **API-04** / LOW / VERIFIED. No API versioning scheme exists (`/owners/signup`, not `/v1/owners/signup`). With three EAS build profiles all pointing at the same backend and no separate staging environment (`ONBOARDING.md §8`), a breaking backend change has no way to avoid breaking an older installed app in the field except careful backward-compatible field additions. Not urgent pre-pilot (one customer, one app version in the wild), but worth deciding on a convention before a second pilot customer is on an older app build during a backend upgrade.
- **API-05** / LOW / VERIFIED. Sync/async usage is consistent — every route is a plain `def`, correctly relying on FastAPI's threadpool rather than mixing `async def` with blocking DB calls (a common real bug class in FastAPI apps; not present here).

### 4.11 Infrastructure and operations

- **INFRA-01** / HIGH / VERIFIED. No CI/CD exists at all (confirmed: no `.github/workflows/` anywhere in the project's own tree). Every deploy is `git push` triggering an automatic Render rebuild with zero test/lint/build gate in between (`ONBOARDING.md §8`, independently confirmed by the absence of workflow files). For a solo maintainer this is the single highest-leverage process fix available: the 26 `verify_*.py` scripts already exist and already mostly pass — they're just never run automatically.
- **INFRA-02** / MEDIUM / VERIFIED (process), NOT VERIFIABLE FROM REPO (whether it's caused an incident beyond what's documented). Render does not auto-run Alembic migrations on deploy; they're run manually against production (`ONBOARDING.md §8`, which also states this has already caused a real outage once). This is a process risk that will recur on every future schema change until it's automated (e.g., a release-phase/predeploy hook).
- **INFRA-03** / NOT VERIFIABLE FROM REPO. Backup/restore testing, monitoring, alerting, and actual production secrets handling on Render/Supabase are outside what a repo can show. Nothing in the repo indicates a backup-restore has ever been tested.
- **INFRA-04** / LOW / VERIFIED. Environment separation is minimal by design (no separate staging backend; all three EAS profiles point at the same Render instance, `ONBOARDING.md §8`) — a reasonable, explicit tradeoff for a pre-pilot single-developer project, not an oversight.
- **INFRA-05** / LOW / NOT VERIFIABLE FROM REPO. Cost surprises (Render/Supabase/EAS tier limits under real pilot load) cannot be assessed from the repo.

### 4.12 Integrations and billing

- **BILL-01** / MEDIUM-HIGH / VERIFIED. `Factory.status` (trial/active/payment_overdue/suspended/churned) is purely informational — confirmed by grep that nothing outside `_owner_out`'s display logic ever reads it, and `get_current_owner` only checks `deleted_at`. Marking a factory "suspended" in the admin portal has **zero effect on that owner's actual app access.** If the intended manual trial-to-paid flow is meant to gate access at some point, that gate doesn't exist yet.
- **BILL-02** / LOW / VERIFIED. `TRIAL_DAYS = 3` is explicitly commented as "informational only... no gate" (`main.py:149-153`) — consistent with BILL-01, at least honestly labeled in the code itself.
- **BILL-03** / N/A. Gupshup/WhatsApp: confirmed not implemented anywhere (see Plan vs Reality). No findings possible for a feature that doesn't exist; flagging only that the product context describing it as part of the stack is currently inaccurate.

### 4.13 Testing and quality

- **TEST-01** / LOW / VERIFIED (positive). 26 `verify_*.py` integration scripts exist, each spinning up a real `TestClient` against a throwaway SQLite DB and asserting on real behavior (decrypted DB values, real PDF text extraction via `pypdf`, real SMTP delivery via `aiosmtpd`) rather than mocking everything. This review ran all 26 fresh: **25 passed**; the 26th (`verify_sync_worker.py`) requires the separate `test-portal/` Flask/FastAPI app running on port 8020, which this review did not start — not a code failure, an environment-setup step. This is meaningfully more rigorous testing discipline than most projects at this stage have.
- **TEST-02** / HIGH / VERIFIED. The test suite's own dependency (`httpx`, required by `fastapi.testclient.TestClient`) is **not listed in `requirements.txt` or `requirements-dev.txt`.** A clean `pip install -r requirements.txt -r requirements-dev.txt` — the documented setup path — cannot run any of the 25 `TestClient`-based scripts; this review had to `pip install httpx` manually to get past an immediate `ImportError`. Add it to `requirements-dev.txt`.
- **TEST-03** / MEDIUM / VERIFIED. There is no `pytest` runner, no single command to run "the test suite" — each `verify_*.py` is invoked individually with hand-set environment variables. Fine for one developer who remembers the incantation; a real onboarding/CI blocker otherwise. A thin `pytest` wrapper (or even a `Makefile`/shell script looping the 26 files) would cost under an hour and directly unblocks INFRA-01's CI recommendation.
- **TEST-04** / LOW / VERIFIED. No coverage of the offline-sync path exists because the feature doesn't exist (see ATT-01) — nothing to test yet.
- **TEST-05** / LOW / VERIFIED. `tsc --noEmit` on the mobile app is clean; `npm audit` on both `mobile` (15 moderate, all in Expo/React-Navigation build tooling and transitive `uuid`/`xcode` chains, not runtime app-data-handling code) and `admin-portal` (0 vulnerabilities) — see §8 for full output.

### 4.14 Scalability

- **SCALE-01** / concrete numbers, INFERRED from verified code paths. At **10 factories**: nothing breaks — 50 workers × 10 owners is trivial load for the current query patterns, and the single Render instance / single Supabase Postgres handle this without change. At **100 factories** (up to 5,000 workers if every owner hits the cap): the N+1 query pattern in factory-wide form generation (FORM-03) starts to matter per-request but not systemically, since forms are generated on-demand by one owner at a time, not in aggregate; the real pressure point is the **50-worker cap itself** blocking onboarding well before any technical limit is reached — a single mid-size Tamil Nadu garment or textile factory routinely exceeds 50 workers, so this ceiling is hit at the *first* real pilot, not at scale. At **1,000 factories**: the lack of indexes (DATA-02), no pagination (API-02), and no connection pooling configuration visible in `database.py` (a bare `create_engine(DATABASE_URL)` with SQLAlchemy defaults, `database.py:11`) would need attention; the admin dashboard's `admin_dashboard()` endpoint (`admin.py:89-104`) loops every factory and runs a separate `COUNT` query per factory for active employees — that's a real O(n) query-count pattern that becomes visibly slow well before 1,000 rows.
- **SCALE-02** / LOW / VERIFIED. The Playwright-based Portal sync (`sync_worker.py`) launches a full Chromium browser per owner-sync-run (`reconcile_owner`, `sync_worker.py:101-102`) — fine for a handful of factories triggering this occasionally, would become a real resource/cost problem if this were ever run as a scheduled job across hundreds of tenants simultaneously (no evidence it's scheduled anywhere yet — see BIO's "no scheduler wired up" note, same is true here).

### 4.15 Scope discipline

- **SCOPE-01 (over-built)**: The admin portal's billing/payment-tracking surface (`Factory`, `FactoryPayment`, `FactoryEmployeeSnapshot`, monthly snapshot cron script) is a small but complete internal SaaS-ops tool built before there is a single paying pilot customer. Not wrong to have built it — it's small — but a spreadsheet would have covered "manage billing status for 1-3 pilot factories" just as well for now, and every line here is another thing to maintain.
- **SCOPE-02 (over-built)**: The Tamil bilingual text-shaping pipeline (FORM-04) is disproportionate engineering effort (custom HarfBuzz/FreeType rasterization, on-disk PNG caching) relative to pre-pilot value, even though it correctly fixes a real ReportLab bug. Worth revisiting only if it becomes a maintenance burden — not urgent to unwind now that it works and is tested.
- **SCOPE-03 (missing, will be hit week 1)**: The 50-worker cap (Top Action #3).
- **SCOPE-04 (missing, will be hit week 1)**: Any handling of a factory floor with more than one person operating the app (AUTH-02) — a pilot factory's supervisor will very likely need to mark attendance without the owner's personal credentials.
- **SCOPE-05 (missing, will be hit week 1)**: Offline handling (ATT-01/MOB-01) on the exact user base described (unreliable connectivity).
- **SCOPE-06 (correctly deferred, no action needed)**: Karnataka forms, advances/damages ledgers, photo/signature capture on Form 12, owner-configurable weekly-off day — all explicitly and appropriately scoped out in `PHASE3_STATUTORY_FORMS_PLAN.md`'s Non-goals, and the code matches that plan (blank cells, not fabricated data). This is good discipline, not a gap.

### 4.16 Maintainability for a solo developer

- **MAINT-01** / MEDIUM / VERIFIED. `DATA_MODEL.md`, `SPEC.md`, and `PHASE3_STATUTORY_FORMS_PLAN.md` are all significantly stale (5, 5, and 17-tables-behind respectively) while still being the first files a new reader (or a future you, months later) would open. `ONBOARDING.md` is accurate and should be the canonical entry point; the others should either be updated or explicitly marked historical/superseded in their own headers so nobody re-trusts them by accident.
- **MAINT-02** / LOW / VERIFIED. Dependency risk is generally low and well-reasoned (each unusual dependency choice — EasyOCR over Tesseract, HarfBuzz+FreeType over ReportLab native text, Supabase Storage over raw S3 — has an explicit, sound comment explaining why). The heaviest dependency (EasyOCR, which pulls in PyTorch) is explicitly given an opt-out (`OCR_WARM_UP=false`) for memory-constrained hosts — thoughtful.
- **MAINT-03** / LOW / VERIFIED. No linter/formatter/type-checker config exists for the backend (no `ruff`, `flake8`, `mypy`, or `pyproject.toml` found). Not urgent for one developer with a consistent personal style (which this codebase has), but the lack of a shared config means any future collaborator has nothing to conform to automatically.
- **MAINT-04** / LOW / VERIFIED. Comment discipline throughout the backend is unusually good — nearly every non-obvious decision (why a field is nullable, why a query is ordered a particular way, why a dependency was chosen) is explained inline with real reasoning rather than left implicit. This meaningfully reduces the "future you gets stuck" risk this review area is asking about.

---

## 5. Decisions I should reconsider

- **The 50-worker-per-owner cap.** This was a reasonable Day-1 sprint guardrail; carrying it unchanged into a real Tamil Nadu factory pilot will visibly fail on day one for any factory with a normal-sized floor. Raise it (to something like 500, revisited once real data volume is known) or remove it and rely on UI/UX pacing instead.
- **Continuing to run `sync_worker.py`'s Portal automation in its current form.** It sends every worker's full Aadhaar number to an external system automatically, undisclosed in your privacy policy, for a feature that isn't part of the v1 scope you described to me (TN statutory forms, attendance, wage slips, dashboard). The cheaper, safer alternative for now: feature-flag it off (stop calling `reconcile_owner`) until you've decided whether the Labour Portal relationship is still real, and if it is, get an explicit data-sharing basis and disclose it before re-enabling.
- **No roles within a tenant.** You listed RBAC as an early architectural concern, but the code has none. If the real v1 plan is "one owner login per factory, full stop," that's a defensible simplification for a first pilot — but it should be a stated decision, not a silent gap, because it directly shapes how a factory with multiple supervisors will actually use (or fail to use) the app.
- **Storing the JWT in plain `AsyncStorage` instead of `expo-secure-store`**, when the latter is already a dependency used for the App Lock PIN. Cheap to fix, no reason not to, given the tooling is already in the app.
- **A single static Fernet key with no rotation plan for all tenants' PII.** Fine for pre-pilot; worth a documented key-rotation runbook (even a manual one) before this holds real Aadhaar/bank data for paying customers, since losing that key is unrecoverable and rotating it later means re-encrypting every row live.

---

## 6. Over-engineering and deferrals

- **Cut or defer**: the admin portal's payment/billing tracking (`FactoryPayment`, monthly snapshots) — keep it, but don't invest further here until there's a second paying factory; a spreadsheet remains a legitimate alternative for 1-3 factories.
- **Defer, don't unwind**: the Tamil bilingual PDF rendering pipeline. It works and is tested; just be aware it's the single largest chunk of custom, hard-to-debug machinery in the codebase for a solo maintainer, and budget real time if it ever needs a fix (e.g., a new font, a HarfBuzz version bump).
- **Defer**: ID Card and Appointment Letter generation are polish beyond the core v1 scope you named (forms + wage slips + dashboard). They're small and already built, so not worth reverting — just don't let them set a precedent for adding more "nice to have" document types before the core forms have survived a real pilot.
- **Don't build yet**: the Consultant multi-tenant layer from `PHASE2_BACKLOG.md` — correctly still just a design note, not started. Leave it there until Phase 2 is real.

---

## 7. What is solid

Multi-tenant `owner_id` scoping is applied consistently across all 78 endpoints this review read, with no live leak found. The wage/PF/ESI/OT arithmetic matches its own documented formulas exactly (`forms.py:525-580`), and every unconfirmed statutory constant is honestly flagged as such rather than asserted. Migrations are linear, clean, and match the models with zero drift (verified by running `alembic upgrade head` fresh). The 26 `verify_*.py` integration tests genuinely exercise real behavior (decrypted DB rows, real generated PDF text, real SMTP) and 25/26 passed unmodified in this review. `tsc --noEmit` is clean. Manual attendance corrections are protected from being overwritten by a later biometric sync. Comment discipline throughout the backend is genuinely above average for a solo project.

---

## 8. Commands run and results

| Command | Result |
|---|---|
| `git status`, `git log` | Clean working tree, branch `claude/labour-lens-arch-review-lf3yh4` off `master` at `69583ba` |
| `cd mobile && npm install && npx tsc --noEmit` | **Clean, 0 errors** after `npm install` (initial run failed only because `node_modules` wasn't installed yet) |
| `cd mobile && npm audit --omit=dev` | **15 moderate** — all in Expo/React-Navigation build tooling (`@expo/config-plugins`, `xcode`, transitive `uuid`) and `@react-navigation/core`'s `query-string` dependency; none in runtime data-handling code paths |
| `cd admin-portal && npm install && npx tsc --noEmit` | **Clean, 0 errors** |
| `cd admin-portal && npm audit --omit=dev` | **0 vulnerabilities** |
| `python3 -m venv` + `pip install -r requirements.txt` (backend) | Installed cleanly, no errors, including EasyOCR/PyTorch, Playwright, ReportLab, HarfBuzz/FreeType |
| `alembic upgrade head` against a fresh SQLite DB | **All 7 migrations applied cleanly**, no errors |
| `pip install httpx` (undeclared test dependency, see TEST-02) + all 26 `verify_*.py` scripts, run individually against a fresh SQLite DB each | **25 passed** (`ALL ASSERTIONS PASSED`). `verify_sync_worker.py` failed with a connection-refused error because it requires the separate `test-portal/` app running on `127.0.0.1:8020`, which this review did not start — an environment-setup gap (TEST-03), not a code defect |
| `pip-audit -r requirements.txt` | **52 known vulnerabilities across 5 packages**: `cryptography==44.0.0` (multiple CVEs, fixed in 44.0.1+), `pyjwt==2.10.1` (multiple CVEs, fixed in 2.12.0+/2.13.0), `python-multipart==0.0.20` (multiple CVEs, fixed in 0.0.22+), `starlette==0.41.3` (multiple CVEs, fixed in 0.47.2+), `python-dotenv==1.0.1` (fixed in 1.2.2) |
| `grep` sweeps for RLS constructs, rate-limit libraries, CI workflow files, offline/NetInfo/queue references, Gupshup/WhatsApp/Railway references, security headers, `index=True`/`Index()` in models | All zero-result, feeding the findings above directly |
| Did not run / could not run | Real-device mobile testing (no device/emulator in this environment); production migration against real Postgres/Supabase (would touch real infrastructure — out of scope for a read-only review); `verify_sync_worker.py`'s Test Portal dependency (would require standing up `test-portal/` separately, deferred as low-value for this review's purpose) |

---

## 9. Open questions for me

- Is the Labour Portal integration (`sync_worker.py`) still a real, active business relationship, or is it leftover scope from before the pivot to TN statutory forms/biometric? This materially changes whether SEC-02 is "fix the disclosure and add safeguards" or "just turn it off."
- Is "one login per factory, supervisors share the owner's credentials" the accepted v1 model, or was real RBAC assumed to already exist? This changes whether AUTH-02 is a pre-pilot blocker or a documented tradeoff.
- What is the actual expected worker count for the first pilot factory? This determines how urgently DATA-02/FORM-03/API-02 (indexes, N+1, pagination) need to move up the priority list alongside raising the worker cap.
- Has a Postgres/Supabase backup ever actually been restored, even once, in a drill? Nothing in the repo can answer this, and it's the kind of thing that's only discovered to be untested at the worst possible moment.
- Is there a target date for the four new Labour Codes' central rules (expected May 2026) to be reflected in the generated forms, or is Tamil Nadu Factories Rules 1950 (as currently implemented) expected to remain the operative basis through the pilot?
