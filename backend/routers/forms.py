"""forms routes (moved verbatim from main.py)."""

from fastapi import APIRouter

from common import *  # noqa: F401,F403

router = APIRouter()


@router.get("/form-templates", response_model=list[FormTemplateOut])
def list_form_templates(
    state: str,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Which Form Types show up in Forms & Reports for the selected
    state -- reference data (not owner-scoped), seeded via migration.
    A state with no rows yet (anything beyond Tamil Nadu/Karnataka today)
    returns an empty list rather than an error -- the frontend already
    handles "no form types available" the same way it handles "no
    workers yet"."""
    templates = (
        db.query(models.FormTemplate)
        .filter(models.FormTemplate.state == state)
        .order_by(models.FormTemplate.id)
        .all()
    )
    # ID Card and Appointment Letter aren't state-specific statutory
    # registers (unlike everything else in form_templates) -- they're the
    # same document regardless of which state's forms an owner is on, so
    # they're appended here rather than seeded as per-state DB rows that
    # would need inserting again for every future state.
    return [
        *templates,
        FormTemplateOut(form_code="id_card", label="ID Card (Duplicate)", is_available=True),
        FormTemplateOut(form_code="appointment_letter", label="Appointment Letter", is_available=True),
    ]


@router.get("/forms/form25")
def get_form25(
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, media_type, filename = _generate_form_content(db, owner, "form25", None, start_date, end_date)
    _log_form_generation(db, owner, "form25", None, start_date, end_date, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/forms/form25b")
def get_form25b(
    worker_id: int,
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, media_type, filename = _generate_form_content(db, owner, "form25b", worker_id, start_date, end_date)
    _log_form_generation(db, owner, "form25b", worker_id, start_date, end_date, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/forms/form12")
def get_form12_register(
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """The full register -- every worker who has ever been employed, one
    row each, in registration order. This is what a real Form 12 is: a
    running register, not a per-worker sheet."""
    content, media_type, filename = _generate_form_content(db, owner, "form12", None, None, None)
    _log_form_generation(db, owner, "form12", None, None, None, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/forms/form12/{worker_id}")
def get_form12(
    worker_id: int,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """A single register row for one worker -- same exact 24-column
    layout as the full register, just narrowed to one worker."""
    content, media_type, filename = _generate_form_content(db, owner, "form12", worker_id, None, None)
    _log_form_generation(db, owner, "form12", worker_id, None, None, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/forms/form15")
def get_form15(
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, media_type, filename = _generate_form_content(db, owner, "form15", None, start_date, end_date)
    _log_form_generation(db, owner, "form15", None, start_date, end_date, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/forms/wageslip")
def get_wageslip(
    worker_id: int,
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, media_type, filename = _generate_form_content(db, owner, "wageslip", worker_id, start_date, end_date)
    _log_form_generation(db, owner, "wageslip", worker_id, start_date, end_date, "generated")
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/forms/{form_code}/email", status_code=202)
def email_form(
    form_code: str,
    body: FormEmailIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if body.start_date and body.end_date and body.end_date < body.start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")
    content, _media_type, filename = _generate_form_content(db, owner, form_code, body.worker_id, body.start_date, body.end_date)
    send_report_email(
        to_email=body.recipient_email,
        subject=f"{owner.factory_name} -- {form_code}",
        body_text=f"Attached: {form_code} from {owner.factory_name}.",
        attachment_bytes=content,
        attachment_filename=filename,
        format="pdf",
    )
    _log_form_generation(db, owner, form_code, body.worker_id, body.start_date, body.end_date, "emailed")
    return {"status": "email sent"}


@router.get("/reports/attendance")
def download_report(
    start_date: date_,
    end_date: date_,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")

    content, media_type, filename = reports.build_report(db, owner, start_date, end_date)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/reports/attendance/email", status_code=202)
def email_report(
    body: ReportEmailIn,
    owner: models.Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    if body.end_date < body.start_date:
        raise HTTPException(status_code=422, detail="end_date must not be before start_date")

    content, _media_type, filename = reports.build_report(db, owner, body.start_date, body.end_date)
    send_report_email(
        to_email=body.recipient_email,
        subject=f"{owner.factory_name} attendance report ({body.start_date} to {body.end_date})",
        body_text=(
            f"Attached: attendance report for {owner.factory_name}, "
            f"{body.start_date} to {body.end_date}."
        ),
        attachment_bytes=content,
        attachment_filename=filename,
        format="pdf",
    )
    return {"status": "email sent"}
