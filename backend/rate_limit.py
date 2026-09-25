"""Shared slowapi Limiter instance -- lives in its own module so both
main.py and admin.py can import the SAME limiter object without a
circular import (main.py imports admin.py, so admin.py can't import
main.py back). In-memory storage (slowapi's default) is fine for this
app's current single-instance Render deployment; revisit with a shared
backend (Redis) if this ever runs as more than one process."""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
