"""Owner-scoped API for the biometric attendance sync layer -- device
CRUD, manual device-user mapping (the fallback safety net from
Section 4), unmapped-punch resolution, sync triggering, health, and
per-worker consent. Every route here is behind get_current_owner and
scoped to that owner's own devices/workers, same multi-tenant pattern
as every other route in main.py.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from auth import get_current_owner
from biometric import ConnectorError, get_connector
from biometric_sync import resolve_worker_for_punch, sync_device
from database import get_db
from schemas import (
    BiometricConsentIn,
    BiometricConsentOut,
    BiometricDeviceIn,
    BiometricDeviceOut,
    BiometricDeviceUpdateIn,
    BiometricHealthOut,
    DeviceUserMappingIn,
    DeviceUserMappingOut,
    EmployeeCodeOut,
    SyncResultOut,
    UnmappedPunchOut,
    VerifyPunchOut,
)

router = APIRouter(tags=["biometric"])

STALE_THRESHOLD_MINUTES = 30


def _get_owned_device(device_id: int, owner: models.Owner, db: Session) -> models.BiometricDevice:
    device = (
        db.query(models.BiometricDevice)
        .filter(models.BiometricDevice.id == device_id, models.BiometricDevice.owner_id == owner.id)
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


def _get_owned_worker(worker_id: int, owner: models.Owner, db: Session) -> models.Worker:
    worker = db.query(models.Worker).filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return worker


def _is_stale(device: models.BiometricDevice) -> bool:
    if device.status != "active":
        return False
    if device.last_synced_at is None:
        return True
    # SQLite doesn't preserve timezone-awareness on round-trip even for
    # a DateTime(timezone=True) column (unlike Postgres) -- same fix as
    # main.py's _owner_out and biometric_sync.py's dedup comparison.
    last_synced_at = device.last_synced_at
    if last_synced_at.tzinfo is None:
        last_synced_at = last_synced_at.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - last_synced_at
    return age > timedelta(minutes=STALE_THRESHOLD_MINUTES)


def _device_out(device: models.BiometricDevice) -> BiometricDeviceOut:
    return BiometricDeviceOut(
        id=device.id,
        name=device.name,
        ip_address=device.ip_address,
        port=device.port,
        force_udp=device.force_udp,
        status=device.status,
        last_sync_status=device.last_sync_status,
        last_synced_at=device.last_synced_at,
        is_stale=_is_stale(device),
    )


# --- Devices ---


@router.post("/biometric/devices", response_model=BiometricDeviceOut, status_code=201)
def create_device(body: BiometricDeviceIn, owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    device = models.BiometricDevice(owner_id=owner.id, **body.model_dump())
    db.add(device)
    db.commit()
    db.refresh(device)
    return _device_out(device)


@router.get("/biometric/devices", response_model=list[BiometricDeviceOut])
def list_devices(owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    devices = db.query(models.BiometricDevice).filter(models.BiometricDevice.owner_id == owner.id).all()
    return [_device_out(d) for d in devices]


@router.patch("/biometric/devices/{device_id}", response_model=BiometricDeviceOut)
def update_device(
    device_id: int,
    body: BiometricDeviceUpdateIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    device = _get_owned_device(device_id, owner, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(device, field, value)
    db.commit()
    db.refresh(device)
    return _device_out(device)


@router.post("/biometric/devices/{device_id}/sync", response_model=SyncResultOut)
def trigger_sync(device_id: int, owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    """Runs one sync cycle right now, on demand -- since there's no
    background scheduler wired up yet (see README.md's Biometric
    section), this is how a sync actually happens today: either called
    manually, or by whatever cron/scheduler gets configured once a
    real device exists to poll on an interval."""
    device = _get_owned_device(device_id, owner, db)
    connector = get_connector()
    try:
        result = sync_device(db, device, connector)
    except ConnectorError as e:
        # sync_device already turns every expected ConnectorError
        # subclass into a summary dict -- this only catches something
        # unexpected slipping through, so it still can't take down the
        # whole request or block other devices' sync calls.
        raise HTTPException(status_code=502, detail=str(e))
    return SyncResultOut(**result)


# --- Manual device-user mapping (fallback safety net) ---


@router.get("/biometric/device-mappings", response_model=list[DeviceUserMappingOut])
def list_device_mappings(
    device_id: int | None = None,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    query = (
        db.query(models.DeviceUserMapping)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
        .filter(models.BiometricDevice.owner_id == owner.id)
    )
    if device_id is not None:
        query = query.filter(models.DeviceUserMapping.device_id == device_id)
    mappings = query.all()
    out = []
    for m in mappings:
        worker = db.get(models.Worker, m.worker_id)
        out.append(
            DeviceUserMappingOut(
                id=m.id,
                device_id=m.device_id,
                device_user_id=m.device_user_id,
                worker_id=m.worker_id,
                worker_name=worker.name if worker else "-",
                worker_employee_code=worker.numeric_employee_code if worker else None,
                enrolled_at=m.enrolled_at,
            )
        )
    return out


@router.post("/biometric/device-mappings", response_model=DeviceUserMappingOut, status_code=201)
def create_device_mapping(
    body: DeviceUserMappingIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    device = _get_owned_device(body.device_id, owner, db)
    worker = _get_owned_worker(body.worker_id, owner, db)

    # DPDP requirement (Section 7): biometric enrollment -- which this
    # mapping represents the app-side record of -- must not proceed
    # without a captured consent record for this worker. A real gate,
    # not just a UI reminder.
    consent = db.query(models.BiometricConsent).filter(models.BiometricConsent.worker_id == worker.id).first()
    if not consent:
        raise HTTPException(
            status_code=422,
            detail="Biometric consent has not been captured for this worker yet -- capture it in Worker Details before enrolling them on a device.",
        )

    existing = (
        db.query(models.DeviceUserMapping)
        .filter(
            models.DeviceUserMapping.device_id == device.id,
            models.DeviceUserMapping.device_user_id == body.device_user_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="This device_user_id is already mapped on this device")

    mapping = models.DeviceUserMapping(device_id=device.id, device_user_id=body.device_user_id, worker_id=worker.id)
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return DeviceUserMappingOut(
        id=mapping.id,
        device_id=mapping.device_id,
        device_user_id=mapping.device_user_id,
        worker_id=mapping.worker_id,
        worker_name=worker.name,
        worker_employee_code=worker.numeric_employee_code,
        enrolled_at=mapping.enrolled_at,
    )


@router.delete("/biometric/device-mappings/{mapping_id}", status_code=204)
def delete_device_mapping(mapping_id: int, owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    mapping = (
        db.query(models.DeviceUserMapping)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
        .filter(models.DeviceUserMapping.id == mapping_id, models.BiometricDevice.owner_id == owner.id)
        .first()
    )
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    db.delete(mapping)
    db.commit()


# --- Unmapped punches ---


@router.get("/biometric/unmapped-punches", response_model=list[UnmappedPunchOut])
def list_unmapped_punches(owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    rows = (
        db.query(models.BiometricPunch, models.BiometricDevice.name)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.BiometricPunch.device_id)
        .filter(models.BiometricDevice.owner_id == owner.id, models.BiometricPunch.worker_id.is_(None))
        .order_by(models.BiometricPunch.timestamp.desc())
        .all()
    )
    return [
        UnmappedPunchOut(
            id=punch.id,
            device_id=punch.device_id,
            device_name=device_name,
            raw_device_user_id=punch.raw_device_user_id,
            timestamp=punch.timestamp,
            punch_type=punch.punch_type,
        )
        for punch, device_name in rows
    ]


@router.post("/biometric/unmapped-punches/{punch_id}/resolve", response_model=DeviceUserMappingOut)
def resolve_unmapped_punch(
    punch_id: int,
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Maps the punch's device_user_id to a worker going forward (same
    consent gate as the manual mapping screen) and backfills every
    other still-unmapped punch on that device with the same raw ID --
    a device_user_id that showed up unmapped once typically shows up
    unmapped many times before someone notices, so fixing all of them
    at once is what actually clears the "X unmapped punches" count."""
    punch = (
        db.query(models.BiometricPunch)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.BiometricPunch.device_id)
        .filter(models.BiometricPunch.id == punch_id, models.BiometricDevice.owner_id == owner.id)
        .first()
    )
    if not punch:
        raise HTTPException(status_code=404, detail="Punch not found")

    mapping_result = create_device_mapping(
        DeviceUserMappingIn(device_id=punch.device_id, device_user_id=punch.raw_device_user_id, worker_id=worker_id),
        owner,
        db,
    )

    still_unmapped = (
        db.query(models.BiometricPunch)
        .filter(
            models.BiometricPunch.device_id == punch.device_id,
            models.BiometricPunch.raw_device_user_id == punch.raw_device_user_id,
            models.BiometricPunch.worker_id.is_(None),
        )
        .all()
    )
    for p in still_unmapped:
        p.worker_id = worker_id
    db.commit()
    return mapping_result


# --- Health ---


@router.get("/biometric/health", response_model=BiometricHealthOut)
def biometric_health(owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    devices = db.query(models.BiometricDevice).filter(models.BiometricDevice.owner_id == owner.id).all()
    unmapped_count = (
        db.query(models.BiometricPunch)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.BiometricPunch.device_id)
        .filter(models.BiometricDevice.owner_id == owner.id, models.BiometricPunch.worker_id.is_(None))
        .count()
    )
    return BiometricHealthOut(devices=[_device_out(d) for d in devices], unmapped_punch_count=unmapped_count)


# --- Verification punch (Section 4) ---


@router.post("/biometric/devices/{device_id}/verify-punch", response_model=VerifyPunchOut)
def verify_punch(
    device_id: int,
    device_user_id: str,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Right after enrolling someone on the physical device, the owner
    is prompted for one immediate test punch; this pulls the current
    batch and reports which worker it resolves to (via mapping or a
    direct numeric_employee_code match) BEFORE moving to the next
    person -- catches a wrong-finger-under-wrong-ID mistake at the
    moment it happens, not weeks later in a payroll report."""
    device = _get_owned_device(device_id, owner, db)
    connector = get_connector()
    try:
        punches = connector.fetch_punches(device)
    except ConnectorError as e:
        raise HTTPException(status_code=502, detail=str(e))

    matching = [p for p in punches if p.device_user_id == device_user_id]
    if not matching:
        return VerifyPunchOut(resolved=False, message="No punch seen yet for this device user ID -- ask them to punch again.")

    latest = max(matching, key=lambda p: p.timestamp)
    worker = resolve_worker_for_punch(db, device, device_user_id)
    if not worker:
        return VerifyPunchOut(
            resolved=False,
            timestamp=latest.timestamp,
            message="Punch received, but this device user ID isn't mapped to any worker yet.",
        )
    return VerifyPunchOut(
        resolved=True,
        worker_id=worker.id,
        worker_name=worker.name,
        worker_employee_code=worker.numeric_employee_code,
        timestamp=latest.timestamp,
        message=f"Resolved to {worker.name}" + (f" ({worker.numeric_employee_code})" if worker.numeric_employee_code else ""),
    )


# --- Employee code + consent (Worker-scoped, kept in this router for
# cohesion with the rest of the biometric feature) ---


@router.post("/workers/{worker_id}/employee-code", response_model=EmployeeCodeOut)
def get_or_create_employee_code(worker_id: int, owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    """Idempotent: returns the existing code if the worker already has
    one, otherwise generates the next one for this owner. Generated
    once, never reused -- even a later-deactivated worker keeps theirs,
    so the next generated code always increments past every code ever
    issued, not just the ones currently in use."""
    worker = _get_owned_worker(worker_id, owner, db)
    if worker.numeric_employee_code:
        return EmployeeCodeOut(worker_id=worker.id, numeric_employee_code=worker.numeric_employee_code)

    existing_codes = (
        db.query(models.Worker.numeric_employee_code)
        .filter(models.Worker.owner_id == owner.id, models.Worker.numeric_employee_code.isnot(None))
        .all()
    )
    max_code = max((int(c[0]) for c in existing_codes if c[0].isdigit()), default=0)
    worker.numeric_employee_code = str(max_code + 1).zfill(4)
    db.commit()
    db.refresh(worker)
    return EmployeeCodeOut(worker_id=worker.id, numeric_employee_code=worker.numeric_employee_code)


@router.get("/workers/{worker_id}/biometric-consent", response_model=BiometricConsentOut | None)
def get_biometric_consent(worker_id: int, owner: models.Owner = Depends(get_current_owner), db: Session = Depends(get_db)):
    _get_owned_worker(worker_id, owner, db)
    consent = db.query(models.BiometricConsent).filter(models.BiometricConsent.worker_id == worker_id).first()
    if not consent:
        return None
    return BiometricConsentOut(
        worker_id=consent.worker_id,
        consented_at=consent.consented_at,
        consented_by=consent.consented_by,
        notice_text=consent.notice_text,
    )


@router.post("/workers/{worker_id}/biometric-consent", response_model=BiometricConsentOut, status_code=201)
def capture_biometric_consent(
    worker_id: int,
    body: BiometricConsentIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = _get_owned_worker(worker_id, owner, db)
    existing = db.query(models.BiometricConsent).filter(models.BiometricConsent.worker_id == worker.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Consent already captured for this worker")

    consent = models.BiometricConsent(worker_id=worker.id, consented_by=owner.id, notice_text=body.notice_text)
    db.add(consent)
    db.commit()
    db.refresh(consent)
    return BiometricConsentOut(
        worker_id=consent.worker_id,
        consented_at=consent.consented_at,
        consented_by=consent.consented_by,
        notice_text=consent.notice_text,
    )
