"""add foreign-key indexes

Postgres does not index foreign keys automatically; these speed up the
per-worker / per-owner lookups used by wages, leave, punches and audit.
Safe and non-destructive (indexes only).

Revision ID: d2e9f5a8b3c1
Revises: c1d8e4f7a2b9
Create Date: 2026-10-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'd2e9f5a8b3c1'
down_revision: Union[str, Sequence[str], None] = 'c1d8e4f7a2b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = [
    ('ix_workers_owner_id', 'workers', ['owner_id']),
    ('ix_audit_log_owner_id', 'audit_log', ['owner_id']),
    ('ix_wage_profiles_worker_id', 'wage_profiles', ['worker_id']),
    ('ix_leave_entries_worker_id', 'leave_entries', ['worker_id']),
    ('ix_biometric_punches_device_id', 'biometric_punches', ['device_id']),
    ('ix_biometric_punches_worker_id', 'biometric_punches', ['worker_id']),
]


def upgrade() -> None:
    for name, table, cols in INDEXES:
        op.create_index(name, table, cols)


def downgrade() -> None:
    for name, table, _ in reversed(INDEXES):
        op.drop_index(name, table_name=table)
