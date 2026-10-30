"""drop portal sync tables

Browser-automation Portal Sync was removed. Irreversible: take a database
backup before running `alembic upgrade head`.

Revision ID: c1d8e4f7a2b9
Revises: b3f6c9a2d7e1
Create Date: 2026-10-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1d8e4f7a2b9'
down_revision: Union[str, Sequence[str], None] = 'b3f6c9a2d7e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('sync_status')
    op.drop_table('portal_credentials')


def downgrade() -> None:
    op.create_table(
        'portal_credentials',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('owners.id'), nullable=False, unique=True),
        sa.Column('portal_username', sa.String(), nullable=False),
        sa.Column('portal_password', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'sync_status',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('worker_id', sa.Integer(), sa.ForeignKey('workers.id'), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('state', sa.String(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('last_attempted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.String(), nullable=True),
    )
