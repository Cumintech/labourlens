# PHASE 3 — Statutory Forms (Form 25 / 25B / 12 / 15 / Wage Slip)

Implementation plan for Claude Code, written against the actual repo at
`github.com/Cumintech/labourlens` (Expo + FastAPI/SQLAlchemy/Postgres).
Read `SPEC.md`, `DATA_MODEL.md`, `BUILD_PLAN.md`, `backend/models.py`, and
`backend/reports.py` before starting — this plan extends those, it
doesn't replace them.

Not exceeding 4 days. Each day should ship working, verified code, same
discipline as Days 1–4 in `BUILD_PLAN.md`.

> **Not yet started.** Revised 2026-09-02 after a design review against
> the actual repo and the five real government form PDFs. All decisions
> below are confirmed — see "Decisions confirmed before Day 1" at the
> bottom for the reasoning and what to flag on go-live. Ready to start
> Day 1.

## Jurisdiction

**Tamil Nadu Factories Rules, 1950** — confirmed. All five reference
forms on file are printed under these rules (Form 25-B cites "Rule 103-B
of the Tamilnadu Factories Rules 1950" explicitly; the sample factory
address on it is Madurai). Field names and rule citations below assume
this layout.

## Ground rules (carried over from the existing codebase — don't deviate)

- Multi-tenant scoping at the query level. Every new table with an
  `owner_id` (directly or via `worker_id → owner_id`) must be filtered by
  the authenticated owner in every query. This is tested explicitly in
  every existing `verify_*.py` — do the same for new tables.
- No cached rollup tables. `DATA_MODEL.md` states report data is
  generated on-demand from source tables, not stored. Form 25B and Form
  15 follow the same rule — computed at request time from `Attendance` /
  `LeaveEntry` / `WageProfile`, nothing new is written to represent "the
  rollup." (`WagePayment`, added in Day 2, is the one exception — it
  records a fact that happened, not a derived rollup; see 2c.)
- PII encryption: only Aadhaar, address, and bank fields use
  `EncryptedString` today (see `backend/crypto.py`). None of the new
  fields below (compliance, wage, leave) are that sensitivity class —
  keep them plain columns unless told otherwise.
- Verification means parsing the real artifact. `verify_reports.py`
  downloads the generated PDF/Excel and checks real content (openpyxl
  read, PDF text/byte checks), not just an HTTP 200. Every new
  `verify_*.py` in this plan must do the same.
- Flag decisions made without being asked, the way `BUILD_PLAN.md`'s
  daily status log already does — don't silently guess and move on.
- Real-device check before calling any mobile-visible work done. Every
  prior day in this sprint found real bugs only at that step
  (autoCapitalize bug, SDK mismatch, OCR line-picking). Budget for it.

## Day 1 — Factory profile, shift configurability, Form 12 registration

### 1a. Factory profile (extends `Owner`)

Every one of the five forms' headers needs a licence number and address,
and `Owner` has neither today (only `name`, `mobile`, `factory_name`).
Add:

```python
# Owner gains:
factory_address: Mapped[str | None] = mapped_column(String, nullable=True)
factory_licence_no: Mapped[str | None] = mapped_column(String, nullable=True)
```

Endpoint: `PUT /owners/me/factory-profile` — `{factory_address,
factory_licence_no}`. No dedicated screen needed yet — surface as two
extra fields on whatever the simplest reachable settings/profile surface
is (see 1c).

### 1b. `ShiftConfig`

Add to `backend/models.py`:

```python
class ShiftConfig(Base):
    __tablename__ = "shift_configs"
    __table_args__ = (
        UniqueConstraint("owner_id", "slot_key", name="uq_shift_owner_slot"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    slot_key: Mapped[str] = mapped_column(String, nullable=False)   # matches Attendance.slot
    label: Mapped[str] = mapped_column(String, nullable=False)      # e.g. "Shift A"
    start_time: Mapped[str | None] = mapped_column(String, nullable=True)  # "HH:MM"
    end_time: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
```

Migration (`backend/migrate_seed_shift_config.py`, one-off script, not a
permanent code path): for every existing `Owner`, insert 3 `ShiftConfig`
rows — `slot_key`/`label` = "AM"/"PM"/"Evening", `sort_order` 0/1/2. Run
once against the real DB; confirm via query that every owner has exactly
3 rows afterward.

`Attendance.slot` needs no schema change — it's still a `String`. There
are **two** places today that hardcode the `("AM", "PM", "Evening")`
tuple, not one — `main.py:275` (the `POST /attendance` slot validation)
and `main.py:360` (the dashboard-summary loop that builds the per-slot
breakdown). Both must switch to reading the calling owner's
`ShiftConfig.slot_key` values; missing the second one leaves the
dashboard silently stuck on the old fixed 3 slots even after an owner
customizes their shifts.

**Attendance hours — confirmed approach**: real arrival/departure-time
capture per attendance mark is *not* being built this phase (too much
data-entry burden for the value in v1). Instead:

```python
# Attendance gains:
overtime_hours: Mapped[float] = mapped_column(default=0, nullable=False)
```

Form 25/25-B's daily-hours columns are computed as: `ShiftConfig`'s
`(end_time - start_time)` duration whenever that slot is marked
`present` that day, plus `overtime_hours` if the owner entered any (a
single optional number field added next to the existing present/absent
toggle — not a new screen). This is a real simplification: "hours
worked" becomes "the shift's standard duration," not an actually-clocked
figure. Flag this plainly in the generated PDF or in `BUILD_PLAN.md`'s
status log — it's a legitimate v1 tradeoff, not something to present as
more precise than it is.

Endpoints (all scoped to authenticated owner):

- `GET /shift-configs` — list, ordered by `sort_order`
- `POST /shift-configs` — `{slot_key, label, start_time, end_time}`
- `PUT /shift-configs/{id}` — edit label/times
- `DELETE /shift-configs/{id}` — reject with 409 if any `Attendance` row
  for this owner references that `slot_key` (don't orphan attendance
  history)

Mobile:

- New `ShiftSettingsScreen.tsx` — list/add/edit shifts, plus the two
  factory-profile fields from 1a on the same screen (no separate
  Settings surface exists today — confirmed by checking
  `RootNavigator.tsx`, which has only Dashboard/NewWorkerScan/
  NewWorkerDetails/Report — so this screen doubles as the app's first
  Settings entry point)
- Add a navigation entry point off the Dashboard header
- `DashboardScreen.tsx`: replace the hardcoded `['AM','PM','Evening']`
  slot array with a fetch from `GET /shift-configs`; add the optional OT
  hours input next to each present/absent toggle

### 1c. `WorkerCompliance` (Form 12)

```python
class WorkerCompliance(Base):
    __tablename__ = "worker_compliance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False, unique=True)
    worker_code: Mapped[str | None] = mapped_column(String, nullable=True)          # Working ID / Token No.
    father_or_spouse_name: Mapped[str | None] = mapped_column(String, nullable=True)
    epf_uan_no: Mapped[str | None] = mapped_column(String, nullable=True)
    esic_no: Mapped[str | None] = mapped_column(String, nullable=True)
    # "adult" | "young_person"
    category: Mapped[str] = mapped_column(String, nullable=False)
    fitness_cert_no: Mapped[str | None] = mapped_column(String, nullable=True)
    fitness_cert_valid_till: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_of_joining: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_made_permanent: Mapped[date | None] = mapped_column(Date, nullable=True)
    suspension_period: Mapped[str | None] = mapped_column(String, nullable=True)
    registered_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

Notes on fields that were reconsidered from the original draft:

- `guardian_name` was dropped as a separate field — Form 12 has one
  "Father/Spouse Name" column used for every worker, not a distinct
  guardian field for young persons. `father_or_spouse_name` covers it.
- `date_of_joining` is new and deliberately separate from `Worker`'s own
  `created_at` — the date a worker actually joined the factory and the
  date they were entered into Labour Lens are not the same thing for a
  backfilled worker. "Date on which completion of 480 days of Service"
  is **computed** at PDF-generation time as `date_of_joining + 480
  days`, never stored.
- `date_made_permanent` and `suspension_period` are captured later, not
  at registration — see the worker-edit screen note below.
- Bank name (as opposed to IFSC, which `Worker` already has) and a photo
  / signature-thumb capture are **not** in this phase — see Non-goals.
  Those two cells print blank on the generated Form 12 for now.

**Category & age-threshold rule (confirmed, warn-only)**: category is
computed server-side from `Worker.dob` as of the registration date —
under 18 → `young_person`, else `adult`. Separately, if the computed age
is **under 14** (the Factories Act's actual minimum working age — a
stricter floor than the young-person/certificate threshold), the API
returns a `warning` field in the response and the mobile Compliance step
shows a non-blocking banner ("this worker is under the legal minimum
working age — verify the date of birth"). **Registration is never
blocked on this** — confirmed as warn-only, not a hard stop, since that
judgment call belongs to the owner, not this app.

Endpoints:

- `POST /workers/{worker_id}/compliance` — category (+ under-14 warning,
  if applicable) auto-computed server-side; request body carries the
  rest of the fields above
- `GET /workers/{worker_id}/compliance`
- `PUT /workers/{worker_id}/compliance` — for certificate renewal,
  `date_made_permanent`, `suspension_period`, etc. added after
  registration
- `GET /workers/missing-compliance` — workers for this owner with no
  `WorkerCompliance` row, for the backfill banner

Mobile:

- Insert a Compliance step into the existing registration flow: Scan →
  Manual-correction → Compliance (new) → Save
- Compliance step: show the computed category as a read-only badge (plus
  the under-14 warning banner if it fires); if young_person, show
  `fitness_cert_no` + `fitness_cert_valid_till` inputs; always show
  `worker_code`, `father_or_spouse_name`, `epf_uan_no`, `esic_no`
- **New**: a worker-edit screen (doesn't exist today — confirmed by
  checking `mobile/src/screens/`, which has no view/edit screen for an
  existing worker, only the one-time creation flow). This is where
  `date_made_permanent`, `suspension_period`, and later EPF/ESIC entry
  happen — genuinely new scope versus the original 4-day estimate, kept
  in Day 1 since Day 2 and Day 3's per-worker screens (wage profile,
  leave entry) need the same entry point anyway
- `DashboardScreen.tsx`: banner "N workers need Form 12 details" → the
  compliance step, reused for backfill

### Day 1 verification

- `verify_shift_config.py`: seed migration correctness; multi-shift
  attendance marking still works after slot becomes owner-scoped;
  deleting a shift with attendance history returns 409; cross-owner
  scoping (owner B can't see/edit owner A's shifts); dashboard summary
  reflects a customized shift set, not just the seeded default
- `verify_form12.py`: DOB just under 18 → young_person with certificate
  fields available; DOB under 14 → warning present but save still
  succeeds (not blocked); DOB well over 18 → adult, no extra fields
  required; missing-compliance list is correct; cross-owner scoping

## Day 2 — Wages & leave capture

Confirmed for this phase:

- Wage rate source: manual entry per worker. No external payroll system
  integration.
- A wage slip generated for a past month reflects that month's rate, not
  today's — rates are versioned via `effective_from`; resolution always
  means "the rate that applied during that period," never simply "the
  latest rate." This only stays safe if rate **corrections** are always
  inserted as a new row with a new `effective_from`, and an existing
  row's `effective_from`/values are never edited in place — enforce this
  at the API layer (no `PUT` on `WageProfile`, only `POST` to add a new
  version).

### 2a. `WageProfile`

```python
class WageProfile(Base):
    __tablename__ = "wage_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    # "daily" | "monthly" -- which way `basic` should be read
    rate_type: Mapped[str] = mapped_column(String, default="daily", nullable=False)
    basic: Mapped[float] = mapped_column(nullable=False)
    hra: Mapped[float] = mapped_column(default=0, nullable=False)
    da: Mapped[float] = mapped_column(default=0, nullable=False)
    other_allowances: Mapped[float] = mapped_column(default=0, nullable=False)
    pf_rate: Mapped[float] = mapped_column(default=0, nullable=False)   # percent
    esi_rate: Mapped[float] = mapped_column(default=0, nullable=False)  # percent
    lwf_amount: Mapped[float] = mapped_column(default=0, nullable=False)  # flat, not percent
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

`rate_type` defaults to `"daily"` — this app is attendance-driven, so a
per-day rate pro-rated by days worked is the realistic default for
floor-worker wages; `"monthly"` is available for salaried staff who get
paid the same regardless of attendance. `lwf_amount` is a flat
owner-entered figure, not a hardcoded statutory percentage — Tamil
Nadu's actual current LWF figure isn't something to guess into the
codebase; the owner enters whatever their factory's real number is.

Multiple rows per worker are allowed (history, never overwritten, see
above). "Rate as of date X" = the row with the latest `effective_from <=
X`.

### 2b. `LeaveEntry`

```python
class LeaveEntry(Base):
    __tablename__ = "leave_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    # "earned" | "national_festival_special" | "other" -- aligned to
    # Form 15's actual leave-wage columns, not a generic HR taxonomy
    leave_type: Mapped[str] = mapped_column(String, nullable=False)
    date_from: Mapped[date] = mapped_column(Date, nullable=False)
    date_to: Mapped[date] = mapped_column(Date, nullable=False)
    days: Mapped[float] = mapped_column(nullable=False)
    wages_paid: Mapped[float | None] = mapped_column(nullable=True)
    marked_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

`leave_type` values changed from the original draft (`earned` / `sick` /
`casual` / `festival`) to match Form 15's actual three leave-wage
buckets (`Earned Leave` / `National, Festival & Special Holidays` /
`Others`) — sick/casual leave aren't statutory Form 15 categories, and a
mismatched taxonomy would leave Day 3's totals with no clean column to
sum into.

### 2c. `WagePayment` — new, small, not a rollup

"Date of Payment" and a bank transaction reference are **facts that
happened**, not derivable from `WageProfile`/`Attendance`/`LeaveEntry` —
something has to record them. This is source data, same category as
`AuditLog`, not a cached computation of other tables.

```python
class WagePayment(Base):
    __tablename__ = "wage_payments"
    __table_args__ = (
        UniqueConstraint("worker_id", "month", "year", name="uq_wage_payment_period"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    date_of_payment: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String, nullable=True)
    recorded_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

Endpoints:

- `POST /workers/{worker_id}/wage-profile` — adds a new versioned row,
  never overwrites (no `PUT`, per the versioning rule above)
- `GET /workers/{worker_id}/wage-profile?as_of=YYYY-MM-DD` — resolves the
  applicable rate
- `GET /workers/{worker_id}/wage-profile/history`
- `POST /workers/{worker_id}/leave`
- `GET /workers/{worker_id}/leave?start_date=&end_date=`
- `POST /workers/{worker_id}/wage-payment` — `{month, year,
  date_of_payment, payment_reference}`, upserts the one row for that
  period

Mobile:

- New `WageProfileScreen.tsx` — form (rate type, basic/HRA/DA/other
  allowances/PF/ESI rate/LWF amount, effective date) + rate history list
  below it
- New `LeaveEntryScreen.tsx` — form (type, date range, wages paid) +
  recent entries list below it
- A "mark as paid" action (date + reference) — either its own small
  screen or a section on the Payroll/Wage Slip view built in Day 4
- All reachable from the worker-edit screen added in Day 1c

### Day 2 verification

- `verify_wage_profile.py`: `as_of` resolution picks the correct
  historical row; a new version never mutates an old one; cross-owner
  scoping
- `verify_leave_entry.py`: rejects `date_to < date_from`; `leave_type`
  restricted to the three valid values; cross-owner scoping
- `verify_wage_payment.py`: one row per worker/month enforced; cross-owner
  scoping

## Day 3 — Form generation (backend)

`backend/reports.py` today has **no existing header/footer helper** to
reuse — it builds a PDF with a plain title `Paragraph` + one `Table`, no
per-page canvas callback. The forms below need real headers (factory
name, licence no., period) on every page, so `_form_header` is new work
in Day 3, not a reuse of something that already exists — correcting the
original draft's assumption here.

**Form 25 and Form 15 are factory-wide registers, not per-worker
documents** — confirmed from reading the actual PDFs: both list every
worker as a row for the whole month/period on one document. Only Form
25-B, Form 12, and the Wage Slip are genuinely per-worker. Function
signatures and endpoints below reflect this (corrected from the original
draft, which had all five as `(owner, worker, month, year)`).

### 3a. `backend/forms.py`

```python
# backend/forms.py

def _form_header(canvas_obj, owner, form_title, period_label):
    """Factory name, address, licence no., form title, period, generated
    timestamp. New helper -- reports.py has nothing equivalent to reuse."""
    ...

def generate_form25_pdf(owner, month, year) -> bytes:
    """Muster roll -- ALL active workers for this owner as rows, days
    1-31 as columns. Per-day hours = ShiftConfig duration for any slot
    marked present that day + overtime_hours (see Day 1's confirmed
    attendance-hours approach). Compensatory Holidays section left blank
    in v1 -- no Holiday register exists this phase (see Non-goals)."""
    ...

def generate_form25b_pdf(owner, worker, month, year) -> bytes:
    """Time card for ONE worker -- same underlying Attendance data as
    Form 25, laid out with days as rows. "No. of days counted for wages
    incl. weekly holidays" treats Sunday as the weekly holiday (hardcoded
    for this phase, not owner-configurable -- see Non-goals). If a
    worker used more than one shift in the month, list all distinct
    shifts used, comma-separated, rather than picking one."""
    ...

def generate_form12_pdf(owner, worker) -> bytes:
    """One-time registration record from WorkerCompliance + Worker.
    Photo and signature/thumb cells print blank this phase (see
    Non-goals). Date of exit / reason reuse Worker.deactivated_at /
    deactivated_reason directly."""
    ...

def generate_form15_pdf(owner, month, year) -> bytes:
    """Wage register -- ALL active workers for this owner as rows.
    Person-count header (Men/Women/Male Adolescent/Female Adolescent)
    computed from Worker.gender x WorkerCompliance.category; a gender of
    "Other" doesn't map onto these 4 statutory buckets -- include in the
    closest applicable column and don't silently drop the worker from
    the count.

    Per worker, per confirmed formulas:
      basic_wage = rate.basic * days_worked   if rate_type == "daily"
                 = rate.basic                 if rate_type == "monthly"
      ot_wages   = overtime_hours_total * (rate.basic / std_daily_hours) * 2
                   -- 2x multiplier per Factories Act Sec. 59; verify the
                   current notified rate before go-live, don't treat this
                   constant as unquestionable
      leave_wages = sum(LeaveEntry.wages_paid) for entries overlapping
                    the period, type in (earned, national_festival_special)
      gross      = basic_wage + rate.da + rate.hra + rate.other_allowances
                   + ot_wages + leave_wages
      pf         = rate.pf_rate% * (basic_wage + rate.da)
                   -- PF wage base is Basic+DA, not Basic alone or Gross
      esi        = rate.esi_rate% * gross
                   -- ESI wage base is Gross, not Basic alone
      lwf        = rate.lwf_amount   -- flat, owner-entered
      total_deductions = pf + esi + lwf   -- advances/damages ledgers are
                   out of scope this phase (see Non-goals); those two
                   column groups print blank/zero, not fabricated
      net_wages  = gross - total_deductions

    PF/ESI wage-base rules above match the standard statutory definition
    but the actual rate PERCENTAGES and any wage ceiling are
    owner-entered on WageProfile, never hardcoded -- confirm current
    notified figures with the owner before relying on generated numbers
    for real filing.

    date_of_payment / payment_reference come from WagePayment if a row
    exists for that worker+month, else print blank -- never inferred."""
    ...

def generate_wageslip_pdf(owner, worker, month, year) -> bytes:
    """Same computed numbers as one worker's row in generate_form15_pdf,
    reformatted as the single-worker slip. Nature of Work/Designation
    reuses Worker.nature_of_work directly. Manager/worker signature
    lines print blank -- no auto-stamped signature this phase (see
    Non-goals)."""
    ...
```

Add matching `*_excel()` functions for each, following `reports.py`'s
existing PDF/Excel dual-format pattern exactly.

Endpoints (`backend/main.py`):

- `GET /forms/form25?month=&year=&format=pdf|excel` — factory-wide, no
  `worker_id`
- `GET /forms/form25b?worker_id=&month=&year=&format=`
- `GET /forms/form12/{worker_id}?format=`
- `GET /forms/form15?month=&year=&format=` — factory-wide, no
  `worker_id`
- `GET /forms/wageslip?worker_id=&month=&year=&format=`
- `POST /forms/{form_code}/email` — body `{worker_id (omit for
  factory-wide forms), month, year, format, recipient_email}`, reusing
  `email_service.py`'s existing send function as-is

### 3b. `FormGenerationLog`

```python
class FormGenerationLog(Base):
    __tablename__ = "form_generation_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    worker_id: Mapped[int | None] = mapped_column(ForeignKey("workers.id"), nullable=True)
    # "form25" | "form25b" | "form12" | "form15" | "wageslip"
    form_code: Mapped[str] = mapped_column(String, nullable=False)
    period_label: Mapped[str | None] = mapped_column(String, nullable=True)  # e.g. "2026-08"
    # "generated" | "emailed"
    action: Mapped[str] = mapped_column(String, nullable=False)
    generated_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

`worker_id` stays nullable — `null` for the two factory-wide forms
(Form 25, Form 15), set for the three per-worker ones. Write one row on
every successful `GET /forms/*` and `POST /forms/*/email` call.

### Day 3 verification

- `verify_forms.py`: for each of the 5 forms, generate both PDF and
  Excel, parse them back for real content (openpyxl read; PDF magic
  bytes + text extraction check for expected factory/worker name and
  period) — matching `verify_reports.py`'s existing discipline exactly;
  Form 25/Form 15 checks confirm multiple workers appear as rows on one
  document, not one document per worker
- PF/ESI/OT/LWF arithmetic checked against hand-computed expected values
  for a fixture worker with known attendance + wage profile
- Confirm `FormGenerationLog` gets a row on each call
- Cross-owner scoping: owner B cannot generate a form for owner A's
  worker, and owner B's factory-wide Form 25/15 never includes owner A's
  workers (expect 403/404 or an empty/owner-scoped result as
  appropriate)

## Day 4 — Statutory Forms screen, real-device pass, rollout

Mobile:

- New `StatutoryFormsScreen.tsx`, structurally a sibling of
  `ReportScreen.tsx`: month picker up top, then 5 form-type cards — Form
  25 and Form 15 generate directly (factory-wide); Form 25-B, Form 12,
  and Wage Slip open a worker picker first. Format toggle (PDF/Excel),
  Send-by-email button (reuse `ReportScreen.tsx`'s existing email UI
  pattern)
- "Print"/"Share" is **not** built this phase — `expo-sharing` and
  `expo-file-system` aren't installed today (checked
  `mobile/package.json`), and this codebase has explicit precedent
  (`ReportScreen.tsx`'s own comments) for avoiding new native modules
  without a dedicated real-device testing round. Email delivery is the
  v1 distribution path; local share/print is a follow-on, not Day 4
  scope
- Form 12 card opens the read-only `WorkerCompliance` record built in
  Day 1, not a month picker
- Add a navigation entry point matching whatever pattern
  `ReportScreen.tsx` uses today

Rollout checklist:

- `tsc --noEmit` clean
- Metro bundle forced, no errors
- Real-device pass on an actual phone: the new Compliance registration
  step (including the under-14 warning banner), Shift Settings screen,
  worker-edit screen, wage/leave entry screens, and the full Statutory
  Forms screen end to end
- Confirm no regressions to existing PII encryption on `Worker`
- Confirm `FormGenerationLog` captures real usage during the pass
- Update `DATA_MODEL.md` (or add `PHASE3_STATUTORY_FORMS.md`) with what
  actually got built vs. this plan, same status-log discipline as
  `BUILD_PLAN.md`'s existing days

### Day 4 verification

- Full end-to-end pass in the style of the existing Day 5 "Testing,
  cutover, ship" checklist
- Bug fixes from whatever the real-device pass surfaces — every prior
  day has found something real here, budget time for it rather than
  treating the pass as a formality

## Non-goals for this 4-day scope (explicitly deferred, don't build)

- Consultant multi-tenant layer (`PHASE2_BACKLOG.md`'s existing item) —
  not needed for a single-owner factory's own forms
- Payroll system integration — wage rates are manual entry
- Running leave/wage balance (opening/closing carried across months) —
  v1 lists entries + totals for the requested period only;
  "unpaid accumulation" on Form 15 prints blank rather than computing a
  cross-month carryforward
- Multiple states' exact form layouts — Tamil Nadu only; more states is
  a separate future expansion
- **Photo and signature/thumb-impression capture** — this needs real
  file storage (nothing in the app persists images today; OCR only ever
  reads bytes in memory). Those two Form 12 cells print blank this
  phase. Worth its own dedicated pass once the rest of this phase ships,
  not squeezed into Day 1
- **Advances ledger and damages/fines deduction ledger** — Form 15's
  columns for these exist on the printed form but are not backed by data
  this phase; they print blank/zero, not fabricated. A real advances/
  damages tracking feature is future scope
- **Owner-configurable weekly-off day** — hardcoded to Sunday
- **Real per-shift arrival/departure-time capture** — replaced by
  shift-standard-duration + optional manual overtime hours (see Day 1b)
- **Auto-stamped manager/owner signature on generated PDFs** — signature
  lines print blank for physical signing
- **Bank name field** — only IFSC prints; looking up a bank's name from
  its IFSC needs an external dataset this project doesn't have
- Free-text "Remarks" capture on Form 12 / Form 25 — those cells print
  blank for the owner to annotate by hand if needed

---

## Decisions confirmed before Day 1 (2026-09-02)

Resolved in conversation, recorded here so Day 1 doesn't re-litigate
them:

1. **Jurisdiction**: Tamil Nadu Factories Rules, 1950 — confirmed, not
   Jharkhand as the original draft assumed.
2. **Underage registration**: warn-only, never a hard block. Category
   logic (`adult`/`young_person`, <18) is separate from the under-14
   legal-minimum-age warning — both computed from DOB, only the second
   ever shows a warning banner.
3. **Form 25 / Form 15 are factory-wide**, not per-worker — corrected
   from the original draft after reading the actual form PDFs.
4. **Attendance hours**: shift-standard-duration-when-present +
   optional manual OT hours, not real arrival/departure capture. A
   deliberate v1 accuracy tradeoff, not an oversight — flag it as such
   wherever the generated forms are handed to someone who might expect
   clocked times.
5. **Wage rate type**: `WageProfile` gains `rate_type`
   (`"daily"`/`"monthly"`), defaulting to daily — right for
   attendance-tracked floor workers; monthly available for salaried
   staff.
6. **PF wage base**: Basic + DA. **ESI wage base**: Gross Wages. These
   match the standard statutory definitions, but the actual notified
   percentages, thresholds, and any wage ceiling are **not** hardcoded —
   owner-entered on `WageProfile`, confirm current figures before relying
   on output for real filing.
7. **OT multiplier**: 2× the ordinary hourly rate (Factories Act Sec.
   59's standard basis) — same caveat, verify the current rate before
   go-live.
8. **LWF**: flat owner-entered monthly amount (`WageProfile.lwf_amount`),
   not a hardcoded statutory figure — Tamil Nadu's actual current LWF
   number isn't something to guess into the codebase.
9. **Weekly-off day**: hardcoded Sunday for this phase, not
   owner-configurable.
10. **Multi-shift-in-month display**: list all distinct shifts used that
    month, comma-separated — no "primary shift" heuristic.
11. **Photo/signature capture, advances & damages ledgers**: deferred
    out of this 4-day phase entirely (see Non-goals) — the corresponding
    Form 12/Form 15 cells print blank/zero rather than blocking the rest
    of the phase on new file-storage and ledger-tracking infrastructure.
12. **Bank name, auto-stamped signatures, free-text Remarks**: all
    deferred, cells print blank (see Non-goals) — low value relative to
    the effort for this phase.

## Review basis

This plan was checked against the actual repo (`SPEC.md`, `DATA_MODEL.md`,
`BUILD_PLAN.md`, `backend/models.py`, `backend/main.py`,
`backend/reports.py`, `mobile/src/navigation/RootNavigator.tsx`,
`mobile/src/screens/*.tsx`, `mobile/package.json`) plus the five actual
Tamil Nadu government form PDFs this project has on hand, before any of
the decisions above were locked in.
