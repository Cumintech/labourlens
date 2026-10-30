"""App setup. Routes live in routers/*; shared helpers/constants in common.py."""

from common import *  # noqa: F401,F403
from common import _rate_limit_exceeded_handler  # noqa: F401

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Security/ops audit finding: this used to run unconditionally, so
    # Alembic wasn't the sole source of schema truth in production --
    # create_all() silently created a new model's table on boot before
    # its own migration ran, leaving alembic_version out of sync (hit
    # this for real with the upgrade_requests table: DuplicateTable on
    # the next `alembic upgrade head`, fixed only by a manual `stamp`).
    # Every table in models.py is confirmed covered by an Alembic
    # create_table (checked by diffing __tablename__ against every
    # migration's op.create_table calls) -- Alembic alone is sufficient
    # in production. Kept for local dev/fresh-SQLite convenience only.
    if ENVIRONMENT != "production":
        Base.metadata.create_all(bind=engine)
    # Skippable via OCR_WARM_UP=false -- loading EasyOCR's PyTorch models
    # at startup needs real memory headroom a free-tier host (e.g.
    # Render's 512MB web service) doesn't have, and an OOM here takes
    # the whole app down before it can even start serving requests, not
    # just the OCR feature. Defaults to on (unchanged local-dev
    # behavior: the first real Aadhaar scan stays fast).
    if os.environ.get("OCR_WARM_UP", "true").lower() != "false":
        ocr.warm_up()

    # One-time admin account bootstrap via env vars -- the other half of
    # seed_admin.py's "seeded via a one-time script or environment
    # variable" requirement. Only fires when no admin_user row exists
    # yet, so setting these in Render's env vars once (with real shell
    # access unavailable on the free tier) creates the account on first
    # boot and is a no-op on every boot after that -- never overwrites
    # an existing admin on a later redeploy even if the env vars are
    # still set.
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if admin_email and admin_password:
        db = SessionLocal()
        try:
            if not db.query(models.AdminUser).first():
                db.add(models.AdminUser(email=admin_email, password_hash=hash_password(admin_password)))
                db.commit()
        finally:
            db.close()

    yield

_docs_enabled = ENVIRONMENT != "production"

# Crash reporting: no-op until SENTRY_DSN is set on Render. Request bodies
# and PII are never attached (send_default_pii=False).
if os.environ.get("SENTRY_DSN"):
    import sentry_sdk

    sentry_sdk.init(dsn=os.environ["SENTRY_DSN"], send_default_pii=False, traces_sample_rate=0)

app = FastAPI(
    title="Labour Lens API",
    lifespan=lifespan,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

# Security audit finding: was allow_origins=["*"], marked in its own
# comment as "Day 1... tighten by Day 5+" and never revisited despite
# shipping to production. The mobile app never sends an Origin header
# at all for native requests, so it needs no entry here -- this list is
# only ever consulted for browser-based clients (the admin portal, and
# a local `expo start` web preview). Configurable via ALLOWED_ORIGINS
# (comma-separated) so the real admin-portal production origin can be
# set on Render without another code change once it's deployed
# somewhere with a known URL; defaults cover only local dev origins,
# never falls back to "*". 8081 is Expo SDK 57's own default web port
# (`npx expo start` -> press "w"); 8090 is this repo's own launch.json
# override of that port -- both are real local-dev entry points, not
# just one of them (confirmed live: 8081 alone was getting rejected).
_allowed_origins = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:8081,http://localhost:8090,http://localhost:19006",
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# Security audit finding: no rate limiting existed anywhere -- combined
# with no password-strength floor (see schemas.py's OwnerSignupIn),
# /owners/login was a straightforward online brute-force target. The
# actual Limiter instance lives in rate_limit.py (shared with admin.py,
# which can't import this module back without a circular import).
app.state.limiter = limiter

app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.include_router(admin.router)

app.include_router(biometric_api.router)

@app.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)):
    # Real check: a failing database must show up as unhealthy so uptime
    # monitors / Render restart it instead of reporting a false "ok".
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "db_unavailable"})
    return HealthOut(status="ok", time=datetime.now(timezone.utc))

@app.get("/privacy-policy", response_class=HTMLResponse)
def privacy_policy_page():
    """Publicly reachable (no auth) -- this is the URL Play Console's
    Data Safety form and App Store Connect's App Privacy section both
    require. Renders from privacy_policy.py's SECTIONS, the same source
    /privacy-policy.json below and the mobile app both read, so there's
    exactly one place this text is ever written."""
    return HTMLResponse(content=privacy_policy.render_html())

@app.get("/privacy-policy.json")
def privacy_policy_json():
    """Fetched by PrivacyPolicyScreen.tsx to render the in-app screen --
    see privacy_policy.py's module docstring for why the content lives
    there instead of being hardcoded in both places."""
    return {"title": privacy_policy.TITLE, "updated": privacy_policy.LAST_UPDATED, "sections": privacy_policy.SECTIONS}


from routers.owners import router as owners_router
from routers.workers import router as workers_router
from routers.wages import router as wages_router
from routers.insights import router as insights_router
from routers.attendance import router as attendance_router
from routers.forms import router as forms_router

app.include_router(owners_router)
app.include_router(workers_router)
app.include_router(wages_router)
app.include_router(insights_router)
app.include_router(attendance_router)
app.include_router(forms_router)
