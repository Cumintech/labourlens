"""encrypt worker bank_ifsc in place

Revision ID: a7f3c9e1d5b8
Revises: d4a6f1c8b3e2
Create Date: 2026-10-01 00:00:00.000000

No schema change -- bank_ifsc was already a String column and stays one;
EncryptedString (see crypto.py) is a Python-side TypeDecorator, not a DB
type. This migration only re-writes existing plaintext values as Fernet
tokens using the exact same key/mechanism, so models.py's new
EncryptedString mapping can decrypt them transparently. Idempotent: a
value that decrypts successfully under the current key is left alone.
"""
import sys
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from cryptography.fernet import InvalidToken
from crypto import _fernet

# revision identifiers, used by Alembic.
revision: str = 'a7f3c9e1d5b8'
down_revision: Union[str, Sequence[str], None] = 'd4a6f1c8b3e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, bank_ifsc FROM workers WHERE bank_ifsc IS NOT NULL")).fetchall()
    for worker_id, value in rows:
        try:
            _fernet.decrypt(value.encode())
            continue  # already encrypted -- idempotent, skip
        except InvalidToken:
            pass
        encrypted = _fernet.encrypt(value.encode()).decode()
        conn.execute(sa.text("UPDATE workers SET bank_ifsc = :v WHERE id = :id"), {"v": encrypted, "id": worker_id})


def downgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, bank_ifsc FROM workers WHERE bank_ifsc IS NOT NULL")).fetchall()
    for worker_id, value in rows:
        try:
            plain = _fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            continue  # already plaintext, skip
        conn.execute(sa.text("UPDATE workers SET bank_ifsc = :v WHERE id = :id"), {"v": plain, "id": worker_id})
