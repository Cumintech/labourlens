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
expired / renewal_in_progress / superseded), `uploaded_by`, `uploaded_at`.

**Alert-tracking fields**: `last_alerted_threshold` (int, one of
90/60/30/7/0 — which urgency bucket the last alert was for) and
`last_alerted_at`. A single timestamp alone isn't enough to prevent
spam — it can't tell "already alerted at the 30-day mark" apart from
"already alerted at the 7-day mark," so it would either re-alert daily
in the gap between thresholds or skip the more urgent follow-up.
Tracking the threshold itself means each crossing (90 → 60 → 30 → 7 →
overdue) fires exactly one alert, not one alert repeated daily for
however many days sit between two thresholds.

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
infrastructure. Once a day is the right cadence here (unlike the Portal
sync question, license expiries don't move fast enough to need
minute-level freshness). Each run is a single indexed query — `WHERE
expiry_date <= today + 90 days AND status = 'active'` — cheap regardless
of how many documents/clients exist, not a per-document check. For each
row returned: compute days-until-expiry, work out which bucket it falls
into (90/60/30/7/overdue), and only send a notification if that bucket is
more urgent than `last_alerted_threshold` — i.e. exactly one alert per
threshold crossing over a document's life, not a repeat every day between
two thresholds. The "what's due" dashboard is separate and unrelated to
this job's cadence — a live query, run fresh whenever opened, no stored
alert state involved.

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
