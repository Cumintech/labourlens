"""Admin portal authentication -- deliberately the same JWT/bcrypt
approach as auth.py (owner auth), not a second auth library. The one
thing that keeps the two token types from being interchangeable is the
"type" claim: an owner token has no "type" field at all, and
get_current_admin() rejects anything where "type" != "admin" -- so an
owner's own token, decoded with the same JWT_SECRET, still fails here.
There is deliberately no create-admin-via-API path -- see seed_admin.py."""

import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

import jwt
import models
from auth import JWT_ALGORITHM, JWT_SECRET, hash_password, verify_password  # noqa: F401 -- re-exported for seed_admin.py
from database import get_db

ADMIN_JWT_EXPIRY_HOURS = 12  # shorter-lived than an owner's -- this token can see every factory's data

admin_security = HTTPBearer()


def create_admin_token(admin_id: int) -> str:
    payload = {
        "admin_id": admin_id,
        "type": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(hours=ADMIN_JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Depends(admin_security),
    db: Session = Depends(get_db),
) -> models.AdminUser:
    """Dependency for every /admin/* route. Rejects an owner token (or
    any token missing the "type": "admin" claim) even though it's
    signed with the same secret -- confirmed by verify_admin_auth.py."""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if payload.get("type") != "admin":
        raise HTTPException(status_code=401, detail="Not an admin token")

    admin = db.get(models.AdminUser, payload.get("admin_id"))
    if not admin:
        raise HTTPException(status_code=401, detail="Admin not found")
    return admin
