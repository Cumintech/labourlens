# PHASE 3 — Statutory Forms (Form 25 / 25B / 12 / 15 / Wage Slip)

Implementation plan for Claude Code, written against the actual repo at
`github.com/Cumintech/labourlens` (Expo + FastAPI/SQLAlchemy/Postgres).
Read `SPEC.md`, `DATA_MODEL.md`, `BUILD_PLAN.md`, `backend/models.py`, and
`backend/reports.py` before starting — this plan extends those, it
doesn't replace them.

Not exceeding 4 days. Each day should ship working, verified code, same
discipline as Days 1–4 in `BUILD_PLAN.md`.

> **Not yet started.** See the review notes appended at the bottom before
> beginning Day 1 — several assumptions below don't match the current
> repo and need resolving first.

## Ground rules (carried over from the existing codebase — don't deviate)

- Multi-tenant scoping at the query level. Every new table with an
  `owner_id` (directly or via `worker_id → owner_id`) must be filtered by
  the authenticated owner in every query. This is tested explicitly in
  every existing `verify_*.py` — do the same for new tables.
- No cached rollup tables. `DATA_MODEL.md` states report data is
  generated on-demand from source tables, not stored. Form 25B and Form
  15 follow the same rule — computed at request time from `Attendance` /
  `LeaveEntry`, nothing new is written to represent "the rollup."
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

## Day 1 — Shift configurability + Form 12 registration

### 1a. `ShiftConfig`

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

`Attendance.slot` needs no schema change — it's still a `String`.
Wherever `POST /attendance` currently validates slot against a hardcoded
list, change that validation to check membership in the calling owner's
`ShiftConfig.slot_key` values instead.

Endpoints (all scoped to authenticated owner):

- `GET /shift-configs` — list, ordered by `sort_order`
- `POST /shift-configs` — `{slot_key, label, start_time, end_time}`
- `PUT /shift-configs/{id}` — edit label/times
- `DELETE /shift-configs/{id}` — reject with 409 if any `Attendance` row
  for this owner references that `slot_key` (don't orphan attendance
  history)

Mobile:

- New `ShiftSettingsScreen.tsx` — list/add/edit shifts
- Add a navigation entry point (check how Settings/menu is currently
  structured; if there's no Settings surface yet, this may need one)
- `DashboardScreen.tsx`: replace the hardcoded `['AM','PM','Evening']`
  slot array with a fetch from `GET /shift-configs`

### 1b. `WorkerCompliance` (Form 12)

```python
class WorkerCompliance(Base):
    __tablename__ = "worker_compliance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False, unique=True)
    # "adult" | "young_person"
    category: Mapped[str] = mapped_column(String, nullable=False)
    guardian_name: Mapped[str | None] = mapped_column(String, nullable=True)
    fitness_cert_no: Mapped[str | None] = mapped_column(String, nullable=True)
    fitness_cert_valid_till: Mapped[date | None] = mapped_column(Date, nullable=True)
    registered_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

Category rule: age at registration date, computed server-side from
`Worker.dob` (already OCR'd) — under 18 → `young_person`, else `adult`.
Flag if "age at date of joining" should be used instead of "age at
registration" — likely the same date in practice but worth stating the
assumption explicitly rather than silently picking one.

Endpoints:

- `POST /workers/{worker_id}/compliance` — category auto-computed
  server-side; request body carries `guardian_name` / `fitness_cert_no`
  / `fitness_cert_valid_till` only (used if young_person)
- `GET /workers/{worker_id}/compliance`
- `PUT /workers/{worker_id}/compliance` — for certificate renewal
- `GET /workers/missing-compliance` — workers for this owner with no
  `WorkerCompliance` row, for the backfill banner

Mobile:

- Insert a Compliance step into the existing registration flow: Scan →
  Manual-correction → Compliance (new) → Save
- Compliance step: show the computed category as a read-only badge; if
  young_person, show `guardian_name` + `fitness_cert_no` +
  `fitness_cert_valid_till` inputs — otherwise just a confirm
- `DashboardScreen.tsx`: banner "N workers need Form 12 details" → simple
  per-worker compliance-entry screen for backfill

### Day 1 verification

- `verify_shift_config.py`: seed migration correctness; multi-shift
  attendance marking still works after slot becomes owner-scoped;
  deleting a shift with attendance history returns 409; cross-owner
  scoping (owner B can't see/edit owner A's shifts)
- `verify_form12.py`: DOB just under 18 → young_person with required
  fields enforced; DOB well over 18 → adult, no extra fields required;
  missing-compliance list is correct; cross-owner scoping

## Day 2 — Wages & leave capture

Pre-flight — confirm before starting, or proceed on the stated default
and flag it:

- Wage rate source: manual entry per worker (default assumption below)
  vs. reading from an external payroll system. Build manual entry unless
  told otherwise.
- Whether a wage slip generated for a past month must reflect that
  month's rate, not today's. Plan below assumes yes — rates are
  versioned via `effective_from`, and slip generation resolves "the rate
  that applied during that month," not simply "the latest rate."

### 2a. `WageProfile`

```python
class WageProfile(Base):
    __tablename__ = "wage_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    basic: Mapped[float] = mapped_column(nullable=False)
    hra: Mapped[float] = mapped_column(default=0, nullable=False)
    da: Mapped[float] = mapped_column(default=0, nullable=False)
    other_allowances: Mapped[float] = mapped_column(default=0, nullable=False)
    pf_rate: Mapped[float] = mapped_column(default=0, nullable=False)   # percent
    esi_rate: Mapped[float] = mapped_column(default=0, nullable=False)  # percent
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("owners.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

Multiple rows per worker are allowed (history, never overwritten). "Rate
as of date X" = the row with the latest `effective_from <= X`.

### 2b. `LeaveEntry`

```python
class LeaveEntry(Base):
    __tablename__ = "leave_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"), nullable=False)
    # "earned" | "sick" | "casual" | "festival"
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

Endpoints:

- `POST /workers/{worker_id}/wage-profile` — adds a new versioned row,
  never overwrites
- `GET /workers/{worker_id}/wage-profile?as_of=YYYY-MM-DD` — resolves the
  applicable rate
- `GET /workers/{worker_id}/wage-profile/history`
- `POST /workers/{worker_id}/leave`
- `GET /workers/{worker_id}/leave?start_date=&end_date=`

Mobile:

- New `WageProfileScreen.tsx` — form (basic/HRA/DA/allowances/PF/ESI
  rate, effective date) + rate history list below it
- New `LeaveEntryScreen.tsx` — form (type, date range, wages paid) +
  recent entries list below it
- Both need a navigation path from a per-worker context. Check first
  whether a single-worker detail screen already exists — if
  `DashboardScreen.tsx` only ever shows a flat worker list with inline
  attendance chips, these two screens may need a lightweight
  worker-detail screen to hang off of, which wasn't in the original
  4-day estimate and should be flagged if so.

### Day 2 verification

- `verify_wage_profile.py`: `as_of` resolution picks the correct
  historical row; cross-owner scoping
- `verify_leave_entry.py`: rejects `date_to < date_from`; cross-owner
  scoping

## Day 3 — Form generation (backend)

Pre-flight: confirm the exact state-format layout for Form
25/25B/12/15 (Jharkhand assumed, given Bokaro, unless told otherwise). If
this can't be confirmed in time, build against a reasonable generic
Factories Act layout and flag it as unconfirmed in the day's status log
rather than presenting it as final — same discipline `BUILD_PLAN.md`
already uses for open items.

### 3a. `backend/forms.py`

Sibling to `backend/reports.py`, reusing its reportlab/openpyxl setup and
whatever header/footer helper it already has for the attendance PDF:

```python
# backend/forms.py

def _form_header(canvas_obj, owner, form_title, period_label):
    """Factory name, form title, period, generated timestamp —
    reuse reports.py's existing header pattern rather than reinventing one."""
    ...

def generate_form25_pdf(owner, worker, month, year) -> bytes:
    """Daily shift attendance for one worker, one month.
    Query Attendance for worker_id + date in month, joined to
    ShiftConfig for slot labels."""
    ...

def generate_form25b_pdf(owner, worker, month, year) -> bytes:
    """Monthly time card - computed at request time from Attendance:
    days present, per-shift counts, total marked slots.
    No stored rollup (see ground rules)."""
    ...

def generate_form12_pdf(owner, worker) -> bytes:
    """One-time registration record - renders WorkerCompliance as-is."""
    ...

def generate_form15_pdf(owner, worker, month, year) -> bytes:
    """Leave register for the month. v1: list LeaveEntry rows
    overlapping the month + totals (days, wages_paid) for the period.
    No running opening/closing balance across months unless confirmed
    as required - flagged as a non-goal below."""
    ...

def generate_wageslip_pdf(owner, worker, month, year) -> bytes:
    """WageProfile as_of the last day of the month + Attendance
    (days present) + LeaveEntry (wages_paid during leave).
    gross = basic + hra + da + other_allowances
    deductions = pf_rate% * basic + esi_rate% * basic
    net = gross - deductions
    Flag if pro-rating gross by days-present is actually required -
    the formula above assumes a fixed monthly gross regardless of
    attendance, which may be wrong; confirm before treating this as final."""
    ...
```

Add matching `*_excel()` functions for each, following `reports.py`'s
existing PDF/Excel dual-format pattern exactly.

Endpoints (`backend/main.py`):

- `GET /forms/form25?worker_id=&month=&year=&format=pdf|excel`
- `GET /forms/form25b?worker_id=&month=&year=&format=`
- `GET /forms/form12/{worker_id}?format=`
- `GET /forms/form15?worker_id=&month=&year=&format=`
- `GET /forms/wageslip?worker_id=&month=&year=&format=`
- `POST /forms/{form_code}/email` — body
  `{worker_id, month, year, format, recipient_email}`, reusing
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

Write one row on every successful `GET /forms/*` and `POST
/forms/*/email` call.

### Day 3 verification

- `verify_forms.py`: for each of the 5 forms, generate both PDF and
  Excel, parse them back for real content (openpyxl read; PDF magic
  bytes + text extraction check for expected worker name/period) —
  matching `verify_reports.py`'s existing discipline exactly
- Confirm `FormGenerationLog` gets a row on each call
- Cross-owner scoping: owner B cannot generate a form for owner A's
  worker (expect 403/404)

## Day 4 — Statutory Forms screen, real-device pass, rollout

Mobile:

- New `StatutoryFormsScreen.tsx`, structurally a sibling of
  `ReportScreen.tsx`: worker picker → list of 5 form-type cards → tap
  into a per-form screen with month picker (Form 12 skips this — it's
  one-time), format toggle (PDF/Excel), Share/Print button
  (`expo-sharing`), Send-by-email button (reuse `ReportScreen.tsx`'s
  existing email UI)
- Form 12 card opens the read-only `WorkerCompliance` record built in
  Day 1, not a month picker
- Add a navigation entry point matching whatever pattern the existing
  `ReportScreen.tsx` uses today

Rollout checklist:

- `tsc --noEmit` clean
- Metro bundle forced, no errors
- Real-device pass on an actual phone: the new Compliance registration
  step, Shift Settings screen, wage/leave entry screens, and the full
  Statutory Forms screen end to end
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
- Payroll system integration — wage rates are manual entry unless
  confirmed otherwise
- Running leave balance (opening/closing carried across months) — v1
  Form 15 lists entries + totals for the requested period only
- Multiple states' exact form layouts — one confirmed layout only; more
  states is a separate future expansion

## Open questions — resolve ideally before the day that needs them

1. Before Day 2: wage rate source (manual entry assumed) — confirm or
   correct
2. Before Day 3: which state's exact Form 25/25B/12/15 layout to match
   (Jharkhand assumed)
3. Before Day 4: whether Share-to-PDF is sufficient for "print," or real
   printer/label support is actually needed

---

## Review notes (added before Day 1 starts — see chat for full discussion)

This plan was checked against the actual repo (`SPEC.md`, `DATA_MODEL.md`,
`BUILD_PLAN.md`, `backend/models.py`, `backend/main.py`,
`backend/reports.py`, `mobile/src/navigation/RootNavigator.tsx`,
`mobile/src/screens/*.tsx`, `mobile/package.json`) plus the five actual
government form PDFs this project already has on hand. Several of the
plan's stated assumptions don't hold and are corrected here rather than
discovered mid-build. Nothing below has been decided by this assistant —
these are the specific answers needed to start Day 1 for real.
