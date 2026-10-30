"""owners routes (moved verbatim from main.py)."""

from fastapi import APIRouter

from common import *  # noqa: F401,F403

router = APIRouter()


@router.post("/owners/signup", response_model=TokenOut, status_code=201)
@limiter.limit("10/hour")
def signup(request: Request, body: OwnerSignupIn, db: Session = Depends(get_db)):
    if not body.consent_given:
        raise HTTPException(status_code=422, detail="You must accept the Privacy Policy to create an account")

    existing = db.query(models.Owner).filter(models.Owner.mobile == body.mobile).first()
    if existing:
        raise HTTPException(status_code=409, detail="An owner with this mobile number already exists")

    # Falls back to the mobile number when no username was sent (every
    # verify_*.py script, and any other API caller that predates this
    # field) -- mobile is already unique, so this can't collide.
    username = body.username or body.mobile
    existing_username = db.query(models.Owner).filter(models.Owner.username == username).first()
    if existing_username:
        raise HTTPException(status_code=409, detail="That username is already taken")

    owner = models.Owner(
        name=body.name,
        mobile=body.mobile,
        username=username,
        email=body.email,
        password_hash=hash_password(body.password),
        factory_name=body.factory_name,
        factory_address=body.factory_address,
        factory_licence_no=body.factory_licence_no,
        state=body.state,
        industry=body.industry,
        consent_given_at=datetime.now(timezone.utc),
    )
    db.add(owner)
    db.commit()
    db.refresh(owner)

    # Every owner needs at least one shift to ever mark attendance --
    # seed the same default 3-shift scheme the migration script backfills
    # onto pre-existing owners, so a brand-new signup isn't left with zero
    # valid slots. Owner can rename/retime/replace these afterward.
    for slot_key, label, sort_order in (("AM", "AM", 0), ("PM", "PM", 1), ("Evening", "Evening", 2)):
        db.add(models.ShiftConfig(owner_id=owner.id, slot_key=slot_key, label=label, sort_order=sort_order))

    # Sensible starting defaults for the Wage Rate feature -- fully
    # editable/removable like any owner-created type, seeded once at
    # signup (not lazily whenever the list is empty) so a deliberate
    # delete-all by the owner later is respected, not silently reappearing.
    for name, default_rate in (("Plumber", 1000), ("Electrician", 1000), ("Helper", 500)):
        db.add(models.WorkerType(owner_id=owner.id, name=name, default_rate_type="daily", default_rate=default_rate))

    # Every Owner is one factory for admin-portal purposes -- auto-create
    # the matching Factory row here rather than requiring the admin to
    # manually re-enter every factory that's already signed up. Starts
    # in "trial" status; the admin updates it as the business
    # relationship changes (see admin.py).
    db.add(
        models.Factory(
            owner_id=owner.id,
            name=owner.factory_name,
            owner_name=owner.name,
            owner_contact=owner.mobile,
        )
    )
    db.commit()

    token = create_token(owner.id)
    return TokenOut(access_token=token, owner=_owner_out(db, owner))


@router.post("/owners/login", response_model=TokenOut)
@limiter.limit("10/minute")
def login(request: Request, body: OwnerLoginIn, db: Session = Depends(get_db)):
    owner = db.query(models.Owner).filter(models.Owner.username == body.username).first()
    if not owner or not verify_password(body.password, owner.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if owner.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_token(owner.id)
    return TokenOut(access_token=token, owner=_owner_out(db, owner))


@router.post("/owners/forgot-password", status_code=202)
@limiter.limit("5/hour")
def forgot_password(request: Request, body: ForgotPasswordIn, db: Session = Depends(get_db)):
    # Always the same response whether or not an account was found (or
    # has no email on file) -- a different response would let anyone
    # probe which usernames/emails exist in the system.
    generic = {"message": "If an account exists, a reset code has been sent to the email on file."}
    owner = _find_owner_by_identifier(db, body.identifier)
    if not owner or owner.deleted_at is not None or not owner.email:
        return generic

    code = f"{secrets.randbelow(1_000_000):06d}"
    owner.reset_code_hash = hash_password(code)
    owner.reset_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=RESET_CODE_TTL_MINUTES)
    db.commit()
    try:
        send_plain_email(
            owner.email,
            "Labour Lens password reset code",
            f"Your password reset code is {code}. It expires in {RESET_CODE_TTL_MINUTES} minutes.\n\n"
            "If you didn't request this, you can ignore this email.",
        )
    except Exception:
        # Never surface an SMTP failure here -- doing so would both leak
        # whether the account/email exists and expose server config
        # details to an unauthenticated caller.
        pass
    return generic


@router.post("/owners/reset-password")
@limiter.limit("10/hour")
def reset_password(request: Request, body: ResetPasswordIn, db: Session = Depends(get_db)):
    owner = _find_owner_by_identifier(db, body.identifier)
    if not owner or owner.deleted_at is not None or not owner.reset_code_hash or not owner.reset_code_expires_at:
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    # SQLite hands back a naive datetime even for DateTime(timezone=True)
    # (unlike Postgres) -- see the same handling in _owner_out above.
    expires_at = owner.reset_code_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc) or not verify_password(body.code, owner.reset_code_hash):
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    owner.password_hash = hash_password(body.new_password)
    owner.reset_code_hash = None
    owner.reset_code_expires_at = None
    db.commit()
    return {"message": "Password updated. Log in with your new password."}


@router.put("/owners/me/account", response_model=OwnerOut)
def update_account(
    body: AccountUpdateIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if body.username:
        existing = (
            db.query(models.Owner)
            .filter(models.Owner.username == body.username, models.Owner.id != owner.id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="That username is already taken")
        owner.username = body.username
    if body.email is not None:
        owner.email = body.email
    db.commit()
    return _owner_out(db, owner)


@router.get("/owners/me", response_model=OwnerOut)
def get_me(owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    return _owner_out(db, owner)


@router.put("/owners/me/factory-profile", response_model=OwnerOut)
def update_factory_profile(
    body: FactoryProfileIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # factory_name is NOT NULL on Owner (it's set at signup) -- only
    # overwrite it when a real value is sent, unlike address/licence
    # which are nullable and fine to clear.
    if body.factory_name and body.factory_name.strip():
        owner.factory_name = body.factory_name.strip()
    owner.factory_address = body.factory_address
    owner.factory_licence_no = body.factory_licence_no
    owner.state = body.state
    owner.industry = body.industry
    db.commit()
    db.refresh(owner)
    return _owner_out(db, owner)


@router.delete("/owners/me", status_code=204)
def delete_account(owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    """Apple Guideline 5.1.1(v): an app that supports account creation
    must also support account deletion, in-app. This does NOT cascade-
    delete Worker/Attendance/WageProfile/etc. rows -- the Tamil Nadu
    Factories Act requires those statutory registers to be retained
    regardless of whether the owner's own login still exists (see
    PrivacyPolicyScreen.tsx's "How long we keep it" section). Deleting
    is therefore: invalidate the password so it can never verify again,
    and stamp deleted_at so both this endpoint's own re-entrancy and
    every future request through get_current_owner reject the account
    outright, even with an unexpired token issued before deletion."""
    if owner.deleted_at is not None:
        return Response(status_code=204)
    owner.password_hash = hash_password(secrets.token_urlsafe(32))
    owner.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=204)


@router.post("/plan/upgrade-request", response_model=UpgradeRequestOut, status_code=201)
def create_upgrade_request(
    body: UpgradeRequestIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Plans screen's "Upgrade" button -- records a lead for sales to
    follow up manually; no payment gateway yet (Razorpay planned). The
    mobile app also opens WhatsApp with the same request at the same
    moment, so this is a backup record, not the only trace of intent."""
    request = models.UpgradeRequest(owner_id=owner.id, plan=body.plan, cycle=body.cycle)
    db.add(request)
    db.commit()
    db.refresh(request)
    return request
