"""The one place that writes to the Attendance table -- used by both
the manual POST /attendance endpoint (main.py) and the biometric sync
job (biometric_sync.py), so a supervisor's tap and a resolved
biometric punch upsert on (worker_id, date, slot) exactly the same
way, including source/source_detail bookkeeping. Kept in its own
module (not main.py) specifically so biometric_sync.py can import it
without a circular import back into main.py.
"""

from datetime import date as date_type, datetime, timezone

from sqlalchemy.orm import Session

import models


def upsert_attendance(
    db: Session,
    worker_id: int,
    date: date_type,
    slot: str,
    status: str,
    overtime_hours: float,
    marked_by: int,
    source: str | None = None,
    source_detail: str | None = None,
) -> models.Attendance:
    record = (
        db.query(models.Attendance)
        .filter(
            models.Attendance.worker_id == worker_id,
            models.Attendance.date == date,
            models.Attendance.slot == slot,
        )
        .first()
    )
    if record:
        record.status = status
        record.overtime_hours = overtime_hours
        record.marked_by = marked_by
        record.marked_at = datetime.now(timezone.utc)
        record.source = source
        record.source_detail = source_detail
    else:
        record = models.Attendance(
            worker_id=worker_id,
            date=date,
            slot=slot,
            status=status,
            overtime_hours=overtime_hours,
            marked_by=marked_by,
            source=source,
            source_detail=source_detail,
        )
        db.add(record)
    db.commit()
    db.refresh(record)
    return record
