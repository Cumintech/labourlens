"""Attendance report generation -- PDF via reportlab. Excel support was
removed per explicit request (PDF + email/download only); reportlab is
pure-Python/pip-installable, no system binary needed (same reasoning as
choosing EasyOCR over Tesseract elsewhere in this repo)."""

import io
from datetime import datetime, time

from reportlab.lib import colors as pdf_colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from sqlalchemy.orm import Session

import models


def _fetch_rows(db: Session, owner: models.Owner, start_date, end_date):
    return (
        db.query(models.Attendance, models.Worker)
        .join(models.Worker, models.Worker.id == models.Attendance.worker_id)
        .filter(
            models.Worker.owner_id == owner.id,
            models.Attendance.date >= start_date,
            models.Attendance.date <= end_date,
        )
        .order_by(models.Attendance.date, models.Worker.name, models.Attendance.slot)
        .all()
    )


def _fetch_deactivated_in_period(db: Session, owner: models.Owner, start_date, end_date):
    """Workers deactivated during the report period -- attendance rows
    alone don't say who left partway through and why, which matters for
    a period-spanning report. deactivated_at is a full datetime (real
    time-of-day, not midnight) -- comparing it against plain `date`
    bind params in SQLite is a text comparison, and "2026-08-18
    10:15:00" sorts *after* "2026-08-18" lexicographically, so a bare
    `<= end_date` silently excludes anyone deactivated on the end date
    itself. Widening to end-of-day avoids that."""
    end_of_day = datetime.combine(end_date, time.max)
    return (
        db.query(models.Worker)
        .filter(
            models.Worker.owner_id == owner.id,
            models.Worker.status == "deactivated",
            models.Worker.deactivated_at.isnot(None),
            models.Worker.deactivated_at >= start_date,
            models.Worker.deactivated_at <= end_of_day,
        )
        .order_by(models.Worker.deactivated_at)
        .all()
    )


def build_report(db: Session, owner: models.Owner, start_date, end_date) -> tuple[bytes, str, str]:
    """Returns (content_bytes, media_type, filename)."""
    rows = _fetch_rows(db, owner, start_date, end_date)
    deactivated = _fetch_deactivated_in_period(db, owner, start_date, end_date)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=1.5 * cm, bottomMargin=1.5 * cm)
    styles = getSampleStyleSheet()

    elements = [
        Paragraph(f"{owner.factory_name} -- attendance report", styles["Title"]),
        Paragraph(f"{start_date.isoformat()} to {end_date.isoformat()}", styles["Normal"]),
        Spacer(1, 0.5 * cm),
    ]

    table_data = [["Worker", "Aadhaar (last 4)", "Date", "Slot", "Status"]]
    for attendance, worker in rows:
        table_data.append(
            [worker.name, worker.aadhaar_last4, attendance.date.isoformat(), attendance.slot, attendance.status]
        )

    table = Table(table_data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), pdf_colors.HexColor("#1B2340")),
                ("TEXTCOLOR", (0, 0), (-1, 0), pdf_colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, pdf_colors.HexColor("#E5E7EB")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [pdf_colors.white, pdf_colors.HexColor("#F4F6F9")]),
            ]
        )
    )
    elements.append(table)

    elements.append(Spacer(1, 0.6 * cm))
    elements.append(Paragraph("Workers deactivated during this period", styles["Heading3"]))
    if deactivated:
        deactivated_data = [["Worker", "Aadhaar (last 4)", "Date deactivated", "Reason"]]
        for worker in deactivated:
            deactivated_data.append(
                [
                    worker.name,
                    worker.aadhaar_last4,
                    worker.deactivated_at.date().isoformat(),
                    worker.deactivated_reason or "-",
                ]
            )
        deactivated_table = Table(deactivated_data, repeatRows=1)
        deactivated_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), pdf_colors.HexColor("#1B2340")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), pdf_colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("GRID", (0, 0), (-1, -1), 0.5, pdf_colors.HexColor("#E5E7EB")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [pdf_colors.white, pdf_colors.HexColor("#F4F6F9")]),
                ]
            )
        )
        elements.append(deactivated_table)
    else:
        elements.append(Paragraph("None.", styles["Normal"]))

    doc.build(elements)
    return buf.getvalue(), "application/pdf", f"attendance_{start_date}_{end_date}.pdf"
