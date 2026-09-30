import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker, with_loader_criteria

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class TenantScoped:
    """Mixin for models with a direct `owner_id` column. Combined with
    the do_orm_execute hook below, every SELECT/UPDATE/DELETE against a
    TenantScoped model is auto-filtered to the current request's tenant
    (set as db.info["tenant_id"] by auth.get_current_owner) -- defense in
    depth on TOP OF, not a replacement for, each endpoint's own explicit
    `.filter(Model.owner_id == owner.id)`. A session that never went
    through get_current_owner (verify_*.py, migrate_*.py, admin routes)
    has no tenant_id set, so this is a no-op for them, unchanged from
    before. Models scoped only via a differently-named owner FK
    (Attendance.marked_by, WorkerCompliance.registered_by,
    WageProfile.created_by, LeaveEntry.marked_by, WagePayment.recorded_by,
    BiometricConsent.consented_by) or transitively via worker_id/device_id
    (SyncStatus, DeviceUserMapping, BiometricPunch, FactoryPayment,
    FactoryEmployeeSnapshot) are NOT covered here -- still protected only
    by their existing manual filters, same as before this change."""


_tenant_scoped_classes_cache: list | None = None


def _tenant_scoped_classes() -> list:
    # Resolved lazily (not at this module's own import time, before
    # models.py has registered any mappers) and cached after the first
    # real query, once every model is loaded.
    global _tenant_scoped_classes_cache
    if _tenant_scoped_classes_cache is None:
        _tenant_scoped_classes_cache = [
            m.class_ for m in Base.registry.mappers if issubclass(m.class_, TenantScoped)
        ]
    return _tenant_scoped_classes_cache


@event.listens_for(Session, "do_orm_execute")
def _apply_tenant_filter(execute_state):
    if not (execute_state.is_select or execute_state.is_update or execute_state.is_delete):
        return
    tenant_id = execute_state.session.info.get("tenant_id")
    if tenant_id is None:
        return
    # with_loader_criteria(TenantScoped, ...) (the marker base directly)
    # doesn't work: SQLAlchemy eagerly probes the lambda against that
    # base class itself to analyze it, and the base has no owner_id of
    # its own -- so this is applied once per real mapped subclass instead.
    for cls in _tenant_scoped_classes():
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(cls, lambda c: c.owner_id == tenant_id, include_aliases=True)
        )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
