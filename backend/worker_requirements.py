"""What Labour Lens needs to know about a worker, and what is still missing.

REQUIRED items are asked (and enforced) when a worker is added; if one is still missing
(older workers, or data entered elsewhere) it is flagged on the worker's compliance card.
OPTIONAL items are asked but never block: they are listed as "can add later".
One list, used by the compliance card, so it only ever reports real gaps."""
from __future__ import annotations

from datetime import date

import minimum_wage
import models

# (key, label, where it is used)
REQUIRED = (
    ("dob", "Date of birth", "Form 12, ID card, appointment letter"),
    ("gender", "Gender", "Form 12, maternity benefit"),
    ("present_address", "Present address", "Form 12, ID card"),
    ("permanent_address", "Permanent address", "ID card, appointment letter"),
    ("father_or_spouse_name", "Father / spouse name", "Form 12, ID card, appointment letter"),
    ("nature_of_work", "Nature of work", "Form 12, appointment letter"),
    ("date_of_joining", "Date of joining", "Form 12, appointment letter"),
    ("employment_type", "Type of employment", "ID card, appointment letter"),
    ("wage", "Wage rate", "Wage slip, Form 15, minimum-wage check"),
)
OPTIONAL = (
    ("epf_uan_no", "EPF / UAN number", "Form 12, appointment letter"),
    ("esic_no", "ESIC number", "Form 12, appointment letter"),
    ("blood_group", "Blood group", "ID card"),
    ("mobile", "Mobile number", "Contact"),
    ("bank_account_number", "Bank account", "Paying wages"),
)


def _present(worker: models.Worker, compliance: models.WorkerCompliance | None, has_wage: bool) -> dict[str, bool]:
    def filled(value) -> bool:
        return bool(value and str(value).strip())

    c = compliance
    return {
        "dob": worker.dob is not None,
        "gender": filled(worker.gender),
        "present_address": filled(worker.current_address),
        "permanent_address": filled(worker.native_address),
        "father_or_spouse_name": filled(c.father_or_spouse_name if c else None),
        "nature_of_work": filled(c.designation_or_nature_of_work if c else None),
        "date_of_joining": bool(c and c.date_of_joining),
        "employment_type": filled(worker.employment_type),
        "wage": has_wage,
        "epf_uan_no": filled(c.epf_uan_no if c else None),
        "esic_no": filled(c.esic_no if c else None),
        "blood_group": filled(worker.blood_group),
        "mobile": filled(worker.mobile),
        "bank_account_number": filled(worker.bank_account_number),
    }


def compute_gaps(db, worker: models.Worker, as_of: date | None = None) -> dict:
    """{required: [...missing], optional: [...missing], wage_below_minimum: {...} | None}"""
    as_of = as_of or date.today()
    compliance = db.query(models.WorkerCompliance).filter(models.WorkerCompliance.worker_id == worker.id).first()
    wage = (
        db.query(models.WageProfile)
        .filter(models.WageProfile.worker_id == worker.id, models.WageProfile.effective_from <= as_of)
        .order_by(models.WageProfile.effective_from.desc(), models.WageProfile.id.desc())
        .first()
    )
    has = _present(worker, compliance, wage is not None)
    temporary = worker.employment_type == "temporary"  # not covered by EPF / ESIC

    def missing(items):
        return [
            {"key": key, "label": label, "used_for": used}
            for key, label, used in items
            if not has[key] and not (temporary and key in ("epf_uan_no", "esic_no"))
        ]

    below = None
    if wage is not None and worker.min_wage_class_id is not None:
        chk = minimum_wage.MinimumWageResolver(db).check(worker.min_wage_class_id, wage.rate_type, wage.basic, wage.da, as_of)
        if chk["available"] and not chk["meets"]:
            below = {
                "class_name": chk["class_name"],
                "offered": chk["proposed"],
                "minimum": chk["minimum"],
                "shortfall": chk["shortfall"],
                "unit": chk["unit"],
            }
    return {"required": missing(REQUIRED), "optional": missing(OPTIONAL), "wage_below_minimum": below}
