# LabourLens — session rules

## Start here
- Read `docs/CURRENT_STATUS.md` first. Read other docs only when the task needs them, using section headers / line ranges (`grep -n "^#"`). Never read ONBOARDING.md or PHASE3 in full.

## Mobile (Expo)
- Follow `mobile/AGENTS.md` (read the SDK v57 docs before writing Expo code).
- Type-check: `cd mobile && npx tsc --noEmit`.

## Backend
- FastAPI + SQLAlchemy + Alembic. Schema changes ONLY via alembic migrations.
- Verify with `backend/run_verify_suite.py` (the `verify_*.py` scripts). See `docs/testing.md`.

## Tenancy
- Every tenant query filters `Model.owner_id == owner.id`. There is no RLS, so a missed filter is a data leak.

## PII
- Aadhaar, bank account, IFSC, addresses use `EncryptedString`.
- Never print or log PII. Never add debug prints of OCR or worker data.

## Employment
- `is_ism` is independent of `employment_type`. "ISM contractor" = temporary + `is_ism`.
- Labels, colours and grouping come only from `mobile/src/employment.ts`.

## Git
- Branch + PR. Never push to master (a push = production deploy on Render). Keep commits small.

## Token rules
- No whole-file reads over 150 lines. No subagents unless asked. No refactors outside the task.

## End of every session
- Update `docs/CURRENT_STATUS.md` (max 40 lines).
