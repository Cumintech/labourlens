"""workers routes (moved verbatim from main.py)."""

from fastapi import APIRouter

from common import *  # noqa: F401,F403

router = APIRouter()


@router.post("/workers/ocr", response_model=OcrFieldsOut)
async def scan_aadhaar(
    front_image: UploadFile = File(...),
    back_image: UploadFile | None = File(None),
    owner: models.Owner = Depends(get_current_owner),
):
    # Bounded reads so an oversized upload can't exhaust memory.
    front_bytes = await front_image.read(MAX_OCR_UPLOAD_BYTES + 1)
    back_bytes = await back_image.read(MAX_OCR_UPLOAD_BYTES + 1) if back_image else None
    if len(front_bytes) > MAX_OCR_UPLOAD_BYTES or (back_bytes is not None and len(back_bytes) > MAX_OCR_UPLOAD_BYTES):
        raise HTTPException(status_code=413, detail="Image too large (max 8 MB per side)")
    try:
        # OCR is CPU-bound and synchronous -- run it off the event loop so
        # one scan doesn't freeze every other request.
        fields = await run_in_threadpool(ocr.extract_fields, front_bytes, back_bytes)
    except UnidentifiedImageError:
        raise HTTPException(status_code=400, detail="Could not read that image")
    return OcrFieldsOut(**fields)


@router.post("/workers", response_model=WorkerOut, status_code=201)
def create_worker(
    body: WorkerCreateIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    current_count = (
        db.query(func.count(models.Worker.id))
        .filter(models.Worker.owner_id == owner.id)
        .scalar()
    )
    if current_count >= MAX_WORKERS_PER_OWNER:
        raise HTTPException(
            status_code=422,
            detail=f"This owner already has {MAX_WORKERS_PER_OWNER} workers, the maximum allowed",
        )

    worker = models.Worker(
        owner_id=owner.id,
        name=body.name,
        mobile=body.mobile,
        dob=body.dob,
        gender=body.gender,
        aadhaar_last4=mask_aadhaar(body.aadhaar_number),
        aadhaar_encrypted=body.aadhaar_number,
        current_address=body.current_address,
        current_district=body.current_district,
        native_address=body.native_address,
        native_district=body.native_district,
        bank_account_number=body.bank_account_number,
        bank_ifsc=body.bank_ifsc,
        employment_type=body.employment_type,
        is_ism=body.is_ism,
        home_state=body.home_state,
    )
    db.add(worker)
    db.commit()
    db.refresh(worker)

    # Assigned immediately at creation rather than only when an owner
    # happens to visit the biometric mapping screen and asks for one --
    # confirmed via investigation that workers going indefinitely
    # without a code (showing "no code yet" everywhere) was this gap,
    # not a bug in the generation logic itself.
    biometric_api.assign_employee_code_if_missing(worker, owner.id, db)
    db.commit()
    db.refresh(worker)


    return worker


@router.get("/workers", response_model=list[WorkerOut])
def list_workers(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # Multi-tenant boundary: scoped to the authenticated owner at the
    # query level, never trusting an owner_id from client input.
    workers = (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id)
        .order_by(models.Worker.created_at.desc())
        .all()
    )
    # One extra query for every worker's confirmed device mapping (if
    # any), scoped to this owner's own devices -- not a per-worker N+1,
    # and not the direct-employee-code path (see WorkerOut.device_user_id).
    mapping_by_worker_id = dict(
        db.query(models.DeviceUserMapping.worker_id, models.DeviceUserMapping.device_user_id)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
        .filter(models.BiometricDevice.owner_id == owner.id)
        .all()
    )
    joining_date_by_worker_id = dict(
        db.query(models.WorkerCompliance.worker_id, models.WorkerCompliance.date_of_joining)
        .join(models.Worker, models.Worker.id == models.WorkerCompliance.worker_id)
        .filter(models.Worker.owner_id == owner.id)
        .all()
    )
    return [
        WorkerOut(
            **w.__dict__,
            device_user_id=mapping_by_worker_id.get(w.id),
            date_of_joining=joining_date_by_worker_id.get(w.id),
        )
        for w in workers
    ]


@router.get("/workers/missing-compliance", response_model=list[WorkerOut])
def list_workers_missing_compliance(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # Registered ABOVE /workers/{worker_id} deliberately -- route matching
    # is order-sensitive, and a literal path below a {worker_id} path
    # parameter route gets swallowed by it ("missing-compliance" parsed
    # as an int and 422'd). Real bug caught by verify_form12.py, not a
    # style preference.
    compliant_worker_ids = (
        db.query(models.WorkerCompliance.worker_id)
        .join(models.Worker, models.Worker.id == models.WorkerCompliance.worker_id)
        .filter(models.Worker.owner_id == owner.id)
    )
    return (
        db.query(models.Worker)
        .filter(models.Worker.owner_id == owner.id, models.Worker.id.not_in(compliant_worker_ids))
        .order_by(models.Worker.created_at.desc())
        .all()
    )


@router.get("/workers/{worker_id}", response_model=WorkerOut)
def get_worker(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    # Real bug, not a hypothetical: returning the bare ORM object here
    # (unlike list_workers just above, which already does this same join)
    # left device_user_id silently defaulting to WorkerOut's None every
    # time, since Worker itself has no such column -- a worker showed as
    # "not mapped yet" on this endpoint even with a confirmed mapping.
    mapping = (
        db.query(models.DeviceUserMapping.device_user_id)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
        .filter(models.BiometricDevice.owner_id == owner.id, models.DeviceUserMapping.worker_id == worker.id)
        .first()
    )
    joining_date = (
        db.query(models.WorkerCompliance.date_of_joining)
        .filter(models.WorkerCompliance.worker_id == worker.id)
        .first()
    )
    return WorkerOut(
        **worker.__dict__,
        device_user_id=mapping[0] if mapping else None,
        date_of_joining=joining_date[0] if joining_date else None,
    )


@router.get("/workers/{worker_id}/photo")
def get_worker_photo_image(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Read-only: returns the worker's stored ID photo (owner-scoped) so the
    app can show it on the worker profile. 404 when no photo is on file."""
    worker = _get_owned_worker(worker_id, owner, db)
    if not worker.photo_key:
        raise HTTPException(status_code=404, detail="No photo on file")
    try:
        data = photo_storage.get_worker_photo(worker.photo_key)
    except Exception:
        raise HTTPException(status_code=404, detail="Photo not available")
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})


@router.post("/workers/{worker_id}/photo", response_model=WorkerOut)
async def upload_worker_photo(
    worker_id: int,
    photo: UploadFile = File(...),
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = _get_owned_worker(worker_id, owner, db)
    photo_bytes = await photo.read()
    if len(photo_bytes) > MAX_PHOTO_UPLOAD_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"Photo is too large ({len(photo_bytes) // 1024}KB) -- must be under {MAX_PHOTO_UPLOAD_BYTES // 1024}KB.",
        )
    # Security audit finding: this previously trusted the client's
    # declared Content-Type entirely -- nothing checked the bytes
    # actually decode as a real image before storing them under
    # {worker_id}.jpg. Image.open().verify() reads the real header/
    # magic bytes (not the filename or declared content-type), so a
    # renamed non-image file is rejected here rather than silently
    # stored. verify() invalidates the Image object for further use per
    # Pillow's own docs, which is fine -- photo_bytes (the raw bytes)
    # is what actually gets stored, not this Image instance.
    try:
        PILImage.open(io.BytesIO(photo_bytes)).verify()
    except UnidentifiedImageError:
        raise HTTPException(status_code=422, detail="That file isn't a valid image.")
    try:
        key = photo_storage.upload_worker_photo(worker.id, photo_bytes)
    except photo_storage.PhotoStorageNotConfigured as e:
        raise HTTPException(status_code=500, detail=str(e))
    worker.photo_key = key
    db.commit()
    db.refresh(worker)
    mapping = (
        db.query(models.DeviceUserMapping.device_user_id)
        .join(models.BiometricDevice, models.BiometricDevice.id == models.DeviceUserMapping.device_id)
        .filter(models.BiometricDevice.owner_id == owner.id, models.DeviceUserMapping.worker_id == worker.id)
        .first()
    )
    joining_date = (
        db.query(models.WorkerCompliance.date_of_joining)
        .filter(models.WorkerCompliance.worker_id == worker.id)
        .first()
    )
    return WorkerOut(
        **worker.__dict__,
        device_user_id=mapping[0] if mapping else None,
        date_of_joining=joining_date[0] if joining_date else None,
    )


@router.post("/workers/{worker_id}/id-card")
def generate_id_card(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = _get_owned_worker(worker_id, owner, db)
    if not worker.photo_key:
        raise HTTPException(status_code=400, detail="Upload a photo for this worker before generating an ID card.")
    try:
        photo_bytes = photo_storage.get_worker_photo(worker.photo_key)
    except photo_storage.PhotoStorageNotConfigured as e:
        raise HTTPException(status_code=500, detail=str(e))
    # Generated fresh from the stored photo + current worker/factory data
    # every time, not cached as its own separate file -- per explicit
    # request, storing both a photo AND a redundant PDF copy of the same
    # information isn't worth the extra storage for how cheap this is to
    # regenerate (a handful of Canvas draw calls, no per-worker register
    # scan like Form 25).
    content, media_type, filename = forms.build_id_card(owner, worker, photo_bytes)
    _log_form_generation(db, owner, "id_card", worker_id, None, None, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/workers/{worker_id}/appointment-letter")
def generate_appointment_letter(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """No photo/compliance/wage-profile prerequisite, unlike the ID card --
    every fact this pulls in is optional and renders as "-" when a worker
    doesn't have it on file yet (see forms.build_appointment_letter), so
    the letter can always be generated/reprinted, same as Forms & Reports'
    other per-worker documents."""
    worker = _get_owned_worker(worker_id, owner, db)
    content, media_type, filename = forms.build_appointment_letter(db, owner, worker)
    _log_form_generation(db, owner, "appointment_letter", worker_id, None, None, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.patch("/workers/{worker_id}/deactivate", response_model=WorkerOut)
def deactivate_worker(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # Minimal backend-only deactivate today -- no mobile UI for this yet
    # (that's Day 4's Worker List work), but Day 3's Sync Worker needs a
    # real deactivate path to actually test the full create+deactivate
    # sync lifecycle, not just the create half.
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    worker.status = "deactivated"
    worker.deactivated_at = datetime.now(timezone.utc)
    db.add(models.AuditLog(owner_id=owner.id, worker_id=worker.id, action="deactivate"))
    db.commit()
    db.refresh(worker)
    return worker


@router.post("/workers/{worker_id}/compliance", response_model=WorkerComplianceOut, status_code=201)
def create_worker_compliance(
    worker_id: int,
    body: WorkerComplianceIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    if not worker.dob:
        raise HTTPException(
            status_code=422, detail="Worker has no date of birth on file -- category can't be computed"
        )
    existing = (
        db.query(models.WorkerCompliance)
        .filter(models.WorkerCompliance.worker_id == worker_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Compliance record already exists -- use PUT to update")
    _validate_date_of_joining(body.date_of_joining, worker.dob)

    category = "young_person" if _age_years(worker.dob, date_.today()) < YOUNG_PERSON_AGE_CEILING else "adult"
    body_data = body.model_dump()
    if not body_data.get("worker_code"):
        body_data["worker_code"] = _generate_worker_code(db, owner.id)
    compliance = models.WorkerCompliance(
        worker_id=worker_id,
        category=category,
        registered_by=owner.id,
        **body_data,
    )
    db.add(compliance)
    db.add(models.AuditLog(owner_id=owner.id, worker_id=worker_id, action="compliance_create"))
    db.commit()
    db.refresh(compliance)
    return _compliance_out(compliance, worker)


@router.get("/workers/{worker_id}/compliance", response_model=WorkerComplianceOut)
def get_worker_compliance(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    compliance = (
        db.query(models.WorkerCompliance)
        .filter(models.WorkerCompliance.worker_id == worker_id)
        .first()
    )
    if not compliance:
        raise HTTPException(status_code=404, detail="No compliance record for this worker yet")
    return _compliance_out(compliance, worker)


@router.put("/workers/{worker_id}/compliance", response_model=WorkerComplianceOut)
def update_worker_compliance(
    worker_id: int,
    body: WorkerComplianceIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker = (
        db.query(models.Worker)
        .filter(models.Worker.id == worker_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    compliance = (
        db.query(models.WorkerCompliance)
        .filter(models.WorkerCompliance.worker_id == worker_id)
        .first()
    )
    if not compliance:
        raise HTTPException(status_code=404, detail="No compliance record for this worker yet -- use POST first")

    # category is recomputed, never taken from the request body -- it's
    # always derived from Worker.dob, same rule as creation.
    compliance.category = (
        "young_person" if _age_years(worker.dob, date_.today()) < YOUNG_PERSON_AGE_CEILING else "adult"
    )
    # Only validated when this request actually touches the field --
    # exclude_unset below means an omitted date_of_joining leaves
    # whatever's already stored untouched, so there's nothing new here
    # to validate.
    if "date_of_joining" in body.model_fields_set:
        _validate_date_of_joining(body.date_of_joining, worker.dob)
    # exclude_unset -- a field the client never included in the request
    # body (e.g. worker_code, which the mobile app no longer lets anyone
    # type since it's auto-generated) must be left alone, not silently
    # wiped to null just because this request didn't mention it.
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(compliance, field, value)
    db.add(models.AuditLog(owner_id=owner.id, worker_id=worker_id, action="compliance_update"))
    db.commit()
    db.refresh(compliance)
    return _compliance_out(compliance, worker)


@router.post("/workers/{worker_id}/wage-profile", response_model=WageProfileOut, status_code=201)
def create_wage_profile(
    worker_id: int,
    body: WageProfileIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # Append-only, deliberately no PUT/edit on an existing row -- a wage
    # slip generated for a past month must keep reflecting that month's
    # rate even after a later correction. See
    # PHASE3_STATUTORY_FORMS_PLAN.md's Day 2 section.
    _get_owned_worker(worker_id, owner, db)
    profile = models.WageProfile(worker_id=worker_id, created_by=owner.id, **body.model_dump())
    db.add(profile)
    db.add(
        models.AuditLog(
            owner_id=owner.id,
            worker_id=worker_id,
            action="wage_rate_set",
            reason=f"{body.rate_type} rate set to {body.basic}, effective {body.effective_from}",
        )
    )
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/workers/{worker_id}/wage-profile", response_model=WageProfileOut)
def get_wage_profile(
    worker_id: int,
    as_of: date_ = Query(default_factory=date_.today),
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    profile = (
        db.query(models.WageProfile)
        .filter(models.WageProfile.worker_id == worker_id, models.WageProfile.effective_from <= as_of)
        # Tie-break on id when two rows share the same effective_from
        # (e.g. a WorkerType-seeded default and a same-day manual
        # override) so the more-recently-added row always wins, not
        # whatever order SQL happens to return ties in.
        .order_by(models.WageProfile.effective_from.desc(), models.WageProfile.id.desc())
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail=f"No wage profile effective on or before {as_of}")
    return profile


@router.get("/workers/{worker_id}/wage-profile/history", response_model=list[WageProfileOut])
def get_wage_profile_history(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    return (
        db.query(models.WageProfile)
        .filter(models.WageProfile.worker_id == worker_id)
        .order_by(models.WageProfile.effective_from.desc(), models.WageProfile.id.desc())
        .all()
    )


@router.get("/worker-types", response_model=list[WorkerTypeOut])
def list_worker_types(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    return db.query(models.WorkerType).filter(models.WorkerType.owner_id == owner.id).order_by(models.WorkerType.name).all()


@router.post("/worker-types", response_model=WorkerTypeOut, status_code=201)
def create_worker_type(
    body: WorkerTypeIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(models.WorkerType)
        .filter(models.WorkerType.owner_id == owner.id, models.WorkerType.name == body.name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"A worker type named {body.name!r} already exists")
    worker_type = models.WorkerType(owner_id=owner.id, **body.model_dump())
    db.add(worker_type)
    db.commit()
    db.refresh(worker_type)
    return worker_type


@router.put("/worker-types/{worker_type_id}", response_model=WorkerTypeOut)
def update_worker_type(
    worker_type_id: int,
    body: WorkerTypeIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker_type = (
        db.query(models.WorkerType)
        .filter(models.WorkerType.id == worker_type_id, models.WorkerType.owner_id == owner.id)
        .first()
    )
    if not worker_type:
        raise HTTPException(status_code=404, detail="Worker type not found")
    worker_type.name = body.name
    worker_type.default_rate_type = body.default_rate_type
    worker_type.default_rate = body.default_rate
    db.commit()
    db.refresh(worker_type)
    return worker_type


@router.delete("/worker-types/{worker_type_id}", status_code=204)
def delete_worker_type(
    worker_type_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    worker_type = (
        db.query(models.WorkerType)
        .filter(models.WorkerType.id == worker_type_id, models.WorkerType.owner_id == owner.id)
        .first()
    )
    if not worker_type:
        raise HTTPException(status_code=404, detail="Worker type not found")
    # Assigned workers keep their worker_type_id pointing at a row that no
    # longer exists otherwise -- clear the assignment first so WorkerOut
    # never has to handle a dangling reference.
    db.query(models.Worker).filter(models.Worker.worker_type_id == worker_type_id).update({"worker_type_id": None})
    db.delete(worker_type)
    db.commit()


@router.put("/workers/{worker_id}/worker-type", response_model=WorkerOut)
def assign_worker_type(
    worker_id: int,
    body: WorkerTypeAssignIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Assigning a type to a worker who has no WageProfile yet auto-creates
    one from the type's defaults, effective today -- "defaults to that
    type's rate unless individually overridden". A worker who already has
    a rate keeps it: that rate already IS their override, so it's never
    touched here. This deliberately reuses WageProfile as the one source
    of truth for wages instead of adding a second, competing rate field."""
    worker = _get_owned_worker(worker_id, owner, db)
    if body.worker_type_id is not None:
        worker_type = (
            db.query(models.WorkerType)
            .filter(models.WorkerType.id == body.worker_type_id, models.WorkerType.owner_id == owner.id)
            .first()
        )
        if not worker_type:
            raise HTTPException(status_code=404, detail="Worker type not found")
        has_rate = db.query(models.WageProfile).filter(models.WageProfile.worker_id == worker_id).first()
        if not has_rate:
            db.add(
                models.WageProfile(
                    worker_id=worker_id,
                    created_by=owner.id,
                    rate_type=worker_type.default_rate_type,
                    basic=worker_type.default_rate,
                    # EPF's statutory employee contribution rate -- WageProfile.pf_rate
                    # defaults to 0 otherwise, silently leaving PF unset on every
                    # auto-created profile. Still just a default: the owner can
                    # override it same as basic/rate_type, per DEFAULT_PF_RATE_PERCENT's
                    # own docstring below.
                    pf_rate=DEFAULT_PF_RATE_PERCENT,
                    effective_from=date_.today(),
                )
            )
            db.add(
                models.AuditLog(
                    owner_id=owner.id,
                    worker_id=worker_id,
                    action="wage_rate_set",
                    reason=f"auto-created from worker type '{worker_type.name}' default ({worker_type.default_rate_type} {worker_type.default_rate})",
                )
            )
    worker.worker_type_id = body.worker_type_id
    db.commit()
    db.refresh(worker)
    return worker


@router.put("/workers/{worker_id}/employment", response_model=WorkerOut)
def update_worker_employment(
    worker_id: int,
    body: WorkerEmploymentIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Updates employment classification (permanent/temporary, inter-state
    migrant status, home state) after creation -- e.g. from the Worker
    Profile's Employment section. is_ism is independent of
    employment_type, so both can be set/cleared in any combination."""
    worker = _get_owned_worker(worker_id, owner, db)
    worker.employment_type = body.employment_type
    worker.is_ism = body.is_ism
    worker.home_state = body.home_state
    db.commit()
    db.refresh(worker)
    return worker


@router.post("/workers/{worker_id}/leave", response_model=LeaveEntryOut, status_code=201)
def create_leave_entry(
    worker_id: int,
    body: LeaveEntryIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    if body.date_to < body.date_from:
        raise HTTPException(status_code=422, detail="date_to must not be before date_from")
    joining_date = _get_joining_date(db, worker_id)
    if joining_date is not None and body.date_from < joining_date:
        raise HTTPException(
            status_code=422,
            detail=f"Leave can't start before this worker's date of entry into service ({joining_date.isoformat()})",
        )
    entry = models.LeaveEntry(worker_id=worker_id, marked_by=owner.id, **body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/workers/{worker_id}/leave", response_model=list[LeaveEntryOut])
def list_leave_entries(
    worker_id: int,
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    # Overlap, not containment -- an entry that only partially falls
    # inside the requested range should still show up (e.g. a leave
    # spanning month-end).
    return (
        db.query(models.LeaveEntry)
        .filter(
            models.LeaveEntry.worker_id == worker_id,
            models.LeaveEntry.date_from <= end_date,
            models.LeaveEntry.date_to >= start_date,
        )
        .order_by(models.LeaveEntry.date_from)
        .all()
    )


@router.get("/leave", response_model=list[LeaveEntryOut])
def list_leave_entries_for_owner(
    date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Every worker's leave entries overlapping one date, in a single
    call -- backs Dashboard's inline Leave chip. Without this, showing
    leave state for N workers on the Dashboard would mean N separate
    per-worker requests."""
    return (
        db.query(models.LeaveEntry)
        .join(models.Worker, models.Worker.id == models.LeaveEntry.worker_id)
        .filter(models.Worker.owner_id == owner.id, models.LeaveEntry.date_from <= date, models.LeaveEntry.date_to >= date)
        .all()
    )


@router.delete("/leave/{leave_id}", status_code=204)
def delete_leave_entry(
    leave_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    entry = (
        db.query(models.LeaveEntry)
        .join(models.Worker, models.Worker.id == models.LeaveEntry.worker_id)
        .filter(models.LeaveEntry.id == leave_id, models.Worker.owner_id == owner.id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Leave entry not found")
    db.delete(entry)
    db.commit()


@router.post("/workers/{worker_id}/wage-payment", response_model=WagePaymentOut, status_code=201)
def upsert_wage_payment(
    worker_id: int,
    body: WagePaymentIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _get_owned_worker(worker_id, owner, db)
    existing = (
        db.query(models.WagePayment)
        .filter(
            models.WagePayment.worker_id == worker_id,
            models.WagePayment.month == body.month,
            models.WagePayment.year == body.year,
        )
        .first()
    )
    if existing:
        existing.date_of_payment = body.date_of_payment
        existing.payment_reference = body.payment_reference
        existing.recorded_by = owner.id
        db.commit()
        db.refresh(existing)
        return existing
    payment = models.WagePayment(worker_id=worker_id, recorded_by=owner.id, **body.model_dump())
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/workers/{worker_id}/wage-computation", response_model=WorkerWageOut)
def get_worker_wage_computation(
    worker_id: int,
    month: int,
    year: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """The same figures Form 15/Wage Slip print, as JSON -- backs the
    "Total Wages" summary on the worker's monthly attendance screen and
    the wage detail breakdown on the Wage Calculation tab."""
    worker = _get_owned_worker(worker_id, owner, db)
    wage = forms.compute_wage(db, owner.id, worker_id, month, year)
    return _worker_wage_out(worker, wage)


@router.get("/workers/{worker_id}/attendance-month", response_model=list[AttendanceOut])
def list_worker_attendance_month(
    worker_id: int,
    month: int,
    year: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Backs the per-worker whole-month attendance view -- one call for
    every day of the month, instead of the owner-wide /attendance
    endpoint called once per day (30 requests, each returning every
    other worker's rows too, just to filter down to one)."""
    _get_owned_worker(worker_id, owner, db)
    start_date, end_date = forms._month_date_range(month, year)
    return (
        db.query(models.Attendance)
        .filter(
            models.Attendance.worker_id == worker_id,
            models.Attendance.date >= start_date,
            models.Attendance.date <= end_date,
        )
        .all()
    )
