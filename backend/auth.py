"""Owner authentication: bcrypt password hashing, JWT issuing/verification.
No refresh-token flow yet (Day 1 scope is auth existing at all, not a full
session-lifecycle design) -- tokens are short-lived and re-login is cheap
for this app's usage pattern (an owner opens the app once per shift)."""

import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

import models
from database import get_db

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24 * 7  # a week -- re-login isn't a big burden, but a
# factory owner shouldn't need to log in every single day either.

security = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_token(owner_id: int) -> str:
    payload = {
        "owner_id": owner_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_owner(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> models.Owner:
    """Dependency for every worker/attendance endpoint from Day 2 onward --
    this is the multi-tenant boundary. Every query downstream must filter
    by this owner's id, never trust an owner_id from the request body."""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    owner = db.get(models.Owner, payload["owner_id"])
    if not owner:
        raise HTTPException(status_code=401, detail="Owner not found")
    return owner
