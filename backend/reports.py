"""6-month attendance report generation -- Excel via openpyxl, PDF via
reportlab. Both are pure-Python/pip-installable, no system binary needed
(same reasoning as choosing EasyOCR over Tesseract elsewhere in this repo)."""

import io

from openpyxl import Workbook
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


def _build_excel(owner: models.Owner, start_date, end_date, rows: list) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Attendance"
    ws.append(["Worker", "Aadhaar (last 4)", "Date", "Slot", "Status"])
    for attendance, worker in rows:
        ws.append(
            [worker.name, worker.aadhaar_last4, attendance.date.isoformat(), attendance.slot, attendance.status]
        )
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _build_pdf(owner: models.Owner, start_date, end_date, rows: list) -> bytes:
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
    doc.build(elements)
    return buf.getvalue()


def build_report(db: Session, owner: models.Owner, start_date, end_date, format: str) -> tuple[bytes, str, str]:
    """Returns (content_bytes, media_type, filename)."""
    rows = _fetch_rows(db, owner, start_date, end_date)

    if format == "excel":
        content = _build_excel(owner, start_date, end_date, rows)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"attendance_{start_date}_{end_date}.xlsx"
    else:
        content = _build_pdf(owner, start_date, end_date, rows)
        media_type = "application/pdf"
        filename = f"attendance_{start_date}_{end_date}.pdf"

    return content, media_type, filename
