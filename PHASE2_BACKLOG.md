# Phase 2 backlog

Explicitly **not** part of the current 5-day sprint (see
[BUILD_PLAN.md](BUILD_PLAN.md)). Recorded here so the design work already
done isn't lost before Phase 2 actually starts. Nothing in this file has
been built.

## Confirmed for Phase 2

### Consultant tenant layer
Today's model is one Owner → their own Workers. Reframing Labour Lens as a
service for labour consultants (who each serve multiple factory clients)
needs an extra tenant layer above `Owner`: a `Consultant` who manages many
`Owner`/factory clients, with role-based access for consultant staff.
This is the one structural decision that other Phase 2 features (below)
depend on — anything describing "across all of a consultant's clients"
needs this in place first. Not yet designed in schema detail; needs its
own pass when Phase 2 actually starts.

### License & deadline management
Confirmed real, confirmed Phase 2 (not sprint scope). Design as discussed:

**`documents` table** — one row per license/certificate/registration:
`id`, `owner_id`, `document_type` (controlled list, not free text —
"Factory License," "PF Registration," "ESI Registration," "Fire Safety
Certificate," etc.), `document_number`, `issuing_authority`, `issue_date`,
`expiry_date` (nullable — some certificates don't expire), `file_key`
(reference to stored file, not the file itself), `status` (active /
expired / renewal_in_progress / superseded), `last_alerted_at` (stops the
alert job from re-notifying about the same deadline daily),
`uploaded_by`, `uploaded_at`.

**`document_versions`** — worth having from day one, not bolted on later.
When a license renews, keep the old file linked to the new one rather
than overwriting — an inspector or auditor asking to see last year's
certificate is a real, foreseeable ask.

**File storage**: object storage (Supabase Storage is the natural
default — same ecosystem as the other project's Postgres, one less
account to manage), not blobs in Postgres. `documents.file_key`
references it; access via short-lived signed URLs, not public links,
since these files can reveal other sensitive business details.

**Alert engine**: reuses the same scheduled-job mechanism as the Portal
Sync Worker (Day 3) — one scheduler, two jobs, not two pieces of
infrastructure. Daily run checks `expiry_date` against a threshold ladder
(90/60/30/7 days out is a reasonable default), notifies once per
threshold crossing using `last_alerted_at` to avoid daily spam. The
"what's due" dashboard itself is a live query (sorted by nearest expiry),
not its own stored alert state.

**Consolidated cross-client view**: depends on the Consultant tenant
layer above — once it exists, this is `WHERE owners.consultant_id = X
ORDER BY expiry_date ASC`, not exotic engineering, just correct modeling
on top of the tenant layer. Without that layer, still useful per-factory,
just not consultant-wide.

## Mentioned, not confirmed — do not treat as committed

Raised as a broader brainstorm before License & deadline management was
singled out. None of these have been confirmed as real requirements —
listed here only so they're not forgotten, not because they're decided:

- PF (EPFO) / ESI registration & returns
- Professional Tax, Minimum Wages Act compliance checks
- Contract Labour (Regulation & Abolition) Act tracking — Principal
  Employer ↔ Contractor relationships
- Factories Act statutory registers (wage register, overtime register,
  register of adult workers)
- Consultant portfolio dashboard (aggregate headcount/attendance/sync
  health across clients)
- Per-client billing/invoicing for the consultant's own services
- WhatsApp/SMS/email client communication
- Turnover/attendance analytics, inspection-readiness export

Before any of these move from "mentioned" to "confirmed," the same
question applies as last time: which of these are real for the actual
consultants this is being built for, versus speculation about what
"labour compliance" generally involves.
