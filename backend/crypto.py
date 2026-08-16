"""Field-level encryption for PII columns (Aadhaar number, addresses,
bank details). Applied via the EncryptedString SQLAlchemy type below --
every column using it is encrypted at rest automatically, never plaintext
in the database, without repeating encrypt/decrypt calls at every call
site.

ENCRYPTION_KEY must be a Fernet key (32 url-safe base64-encoded bytes).
Generate one with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
Store it in .env for local dev; in a real secrets manager (not plain
config, not committed) for anything beyond local dev -- losing this key
means losing access to every encrypted field, permanently."""

import os

from cryptography.fernet import Fernet
from dotenv import load_dotenv
from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

# Loaded here too, not just in database.py -- models.py imports crypto
# before database, so relying on database.py's load_dotenv() having
# already run by the time this module-level check executes would be
# import-order-dependent and fragile. load_dotenv() is idempotent.
load_dotenv()

_key = os.environ.get("ENCRYPTION_KEY")
if not _key:
    raise RuntimeError(
        "ENCRYPTION_KEY not set. Generate one with: "
        "python -c \"from cryptography.fernet import Fernet; "
        "print(Fernet.generate_key().decode())\""
    )
_fernet = Fernet(_key.encode())


class EncryptedString(TypeDecorator):
    """A String column that's encrypted in the database and decrypted
    transparently on read. Use for any PII field -- Aadhaar number,
    addresses, bank account details."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return _fernet.encrypt(value.encode()).decode()

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return _fernet.decrypt(value.encode()).decode()


def mask_aadhaar(aadhaar_number: str) -> str:
    """Last 4 digits only, for display -- never show the full number in
    the UI even to the owner who scanned it."""
    digits = aadhaar_number.replace(" ", "")
    return digits[-4:] if len(digits) >= 4 else digits
