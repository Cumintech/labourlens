"""worker photo key

Revision ID: f2a9c7d13e4b
Revises: e15fb0d97995
Create Date: 2026-09-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a9c7d13e4b'
down_revision: Union[str, Sequence[str], None] = 'e15fb0d97995'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('workers', sa.Column('photo_key', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('workers', 'photo_key')
