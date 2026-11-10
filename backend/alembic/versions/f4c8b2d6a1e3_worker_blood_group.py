"""worker blood group (printed on the ID card)

Revision ID: f4c8b2d6a1e3
Revises: e3b7a1c9d5f2
Create Date: 2026-11-10 00:00:00.000000

Nullable, no default -- existing workers are untouched. Run `alembic upgrade head`
manually (Render does not).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f4c8b2d6a1e3'
down_revision: Union[str, Sequence[str], None] = 'e3b7a1c9d5f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('workers') as b:
        b.add_column(sa.Column('blood_group', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('workers') as b:
        b.drop_column('blood_group')
