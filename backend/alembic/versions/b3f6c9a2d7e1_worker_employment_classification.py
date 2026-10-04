"""worker employment classification

Revision ID: b3f6c9a2d7e1
Revises: a64bf81853b2
Create Date: 2026-10-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3f6c9a2d7e1'
down_revision: Union[str, Sequence[str], None] = 'a64bf81853b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('workers') as batch_op:
        batch_op.add_column(sa.Column('employment_type', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('is_ism', sa.Boolean(), nullable=False, server_default='false'))
        batch_op.add_column(sa.Column('home_state', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('workers') as batch_op:
        batch_op.drop_column('home_state')
        batch_op.drop_column('is_ism')
        batch_op.drop_column('employment_type')
