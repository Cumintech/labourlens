"""enable row-level security on all app tables (no policies)

Revision ID: c9d2e6a4f108
Revises: a7f3c9e1d5b8
Create Date: 2026-10-01 00:00:00.000000

No policies are created -- with RLS enabled and zero policies, every row
is denied by default to any role WITHOUT BYPASSRLS (e.g. Supabase's
`anon`/`authenticated` API roles), while the backend's own connection
role keeps working exactly as before because it has BYPASSRLS (confirmed
via `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'postgres'` before
writing this). This is a hard backstop against the Supabase auto-generated
REST/GraphQL API ever exposing tenant data directly -- tenant isolation
inside the app itself (see database.py's TenantScoped/do_orm_execute
guard, and every endpoint's own owner_id filter) is unchanged.

Postgres-only: SQLite (local dev, verify_*.py) has no ENABLE ROW LEVEL
SECURITY, so this is a no-op there.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c9d2e6a4f108'
down_revision: Union[str, Sequence[str], None] = 'a7f3c9e1d5b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = [
    "owners", "worker_types", "workers", "attendance", "sync_status",
    "portal_credentials", "audit_log", "shift_configs", "worker_compliance",
    "wage_profiles", "leave_entries", "wage_payments", "factories",
    "factory_payments", "factory_employee_snapshots", "admin_user",
    "form_generation_log", "biometric_devices", "device_user_mapping",
    "biometric_punches", "biometric_consents", "form_templates",
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY;')


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY;')
