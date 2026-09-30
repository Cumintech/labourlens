"""owner username, email, password reset

Revision ID: d4a6f1c8b3e2
Revises: b7c14e2a9f60
Create Date: 2026-09-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a6f1c8b3e2'
down_revision: Union[str, Sequence[str], None] = 'b7c14e2a9f60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('owners', sa.Column('username', sa.String(), nullable=True))
    op.add_column('owners', sa.Column('email', sa.String(), nullable=True))
    op.add_column('owners', sa.Column('reset_code_hash', sa.String(), nullable=True))
    op.add_column('owners', sa.Column('reset_code_expires_at', sa.DateTime(timezone=True), nullable=True))
    # Backfill every pre-existing owner's username to their current
    # mobile number -- mobile is already unique, so this is safe to do
    # before the unique index below, and it means nobody's login stops
    # working: they keep typing the same digits, just into a field
    # that's now labeled "Username".
    op.execute("UPDATE owners SET username = mobile WHERE username IS NULL")
    op.create_index('ix_owners_username', 'owners', ['username'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_owners_username', table_name='owners')
    op.drop_column('owners', 'reset_code_expires_at')
    op.drop_column('owners', 'reset_code_hash')
    op.drop_column('owners', 'email')
    op.drop_column('owners', 'username')
