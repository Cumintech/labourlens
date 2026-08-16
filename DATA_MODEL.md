# Data model — Day 1

Implemented in [`backend/models.py`](backend/models.py). PII fields are
marked **[encrypted]** — see [`backend/crypto.py`](backend/crypto.py) for
the field-level encryption approach.

## Owner
Factory owner, the app's tenant boundary — every query scopes to
`owner_id` at the database level, never trusted from client input alone.

| Field | Notes |
|---|---|
| id | PK |
| name | |
| mobile | login identifier |
| password_hash | bcrypt, never stored plain |
| factory_name | |
| created_at | |

## Worker
| Field | Notes |
|---|---|
| id | PK |
| owner_id | FK → Owner, every query filtered by this |
| name | from OCR, owner-correctable |
| mobile | owner-entered |
| dob | from OCR |
| gender | from OCR |
| aadhaar_last4 | plain, for display ("•••• •••• 7412") |
| aadhaar_encrypted | **[encrypted]** full Aadhaar number |
| current_address | **[encrypted]** |
| current_district | **[encrypted]** |
| native_address | **[encrypted]** |
| native_district | **[encrypted]** |
| bank_account_number | **[encrypted]**, optional |
| bank_ifsc | optional |
| status | `active` \| `deactivated` |
| deactivated_at | nullable |
| deactivated_reason | nullable, free text |
| created_at | |

50-worker-per-owner limit enforced at the API layer on create (Day 2).

## Attendance
One row per worker per date per slot — not a single Present/Absent per
day, since AM/PM/Evening are tracked independently.

| Field | Notes |
|---|---|
| id | PK |
| worker_id | FK → Worker |
| date | |
| slot | `AM` \| `PM` \| `Evening` |
| status | `present` \| `absent` |
| marked_by | FK → Owner (who marked it) |
| marked_at | |

Unique constraint on `(worker_id, date, slot)` — one status per
worker/date/slot, re-marking updates the existing row rather than
duplicating.

## SyncStatus
Tracks each worker's Portal sync state independently of the worker's own
`status` field — the app's state is never blocked on Portal success (per
the brief's explicit design).

| Field | Notes |
|---|---|
| id | PK |
| worker_id | FK → Worker, one row per worker |
| action | `create` \| `deactivate` — which sync this row represents |
| state | `pending` \| `synced` \| `failed` |
| attempts | retry count |
| last_attempted_at | |
| last_error | nullable, for the Failed state's diagnostic detail |

## AuditLog
Append-only. Every activate/deactivate action, per the brief's explicit
requirement ("Logged in audit trail — who, when, why").

| Field | Notes |
|---|---|
| id | PK |
| owner_id | who performed the action |
| worker_id | which worker |
| action | `activate` \| `deactivate` |
| reason | nullable free text (deck's confirm-dialog implies a reason may be captured) |
| timestamp | |

## Not yet modeled (later days)

- Portal credential storage (Day 3's encrypted vault) — separate from this
  app's own data model, credentials belong to the Sync Worker's config,
  not a database table of worker data.
- Report generation state — the 6-month report (Day 4) is generated
  on-demand from Attendance, not a stored/cached table for Day 1-4's
  scope.
