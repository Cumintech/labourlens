"""Verifies Phase 3 Day 2's WagePayment work: one row per worker/month
(a second call upserts rather than duplicating), and cross-owner
scoping. "Date of payment" is a fact, not a rollup -- this is the one
exception to the "no cached tables" ground rule (see
PHASE3_STATUTORY_FORMS_PLAN.md), so it's verified for real writes, not
just a 200.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_wage_payment.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient

from database import Base, SessionLocal, engine
import models
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)

signup = client.post(
    "/owners/signup",
    json={"name": "Payment Owner A", "mobile": "9000000601", "password": "pass123", "factory_name": "Payment Factory A"},
)
assert signup.status_code == 201, signup.text
token_a = signup.json()["access_token"]
headers_a = {"Authorization": f"Bearer {token_a}"}

worker = client.post(
    "/workers", headers=headers_a, json={"name": "Payment Worker", "aadhaar_number": "222233334444"}
).json()

first = client.post(
    f"/workers/{worker['id']}/wage-payment",
    headers=headers_a,
    json={"month": 8, "year": 2026, "date_of_payment": "2026-09-01", "payment_reference": "UTR-AAA"},
)
assert first.status_code == 201, first.text

second = client.post(
    f"/workers/{worker['id']}/wage-payment",
    headers=headers_a,
    json={"month": 8, "year": 2026, "date_of_payment": "2026-09-02", "payment_reference": "UTR-BBB"},
)
assert second.status_code == 201, second.text
assert second.json()["payment_reference"] == "UTR-BBB", second.json()

db = SessionLocal()
rows = (
    db.query(models.WagePayment)
    .filter(models.WagePayment.worker_id == worker["id"], models.WagePayment.month == 8, models.WagePayment.year == 2026)
    .all()
)
assert len(rows) == 1, f"expected exactly one row for this worker/month, got {len(rows)}"
assert rows[0].payment_reference == "UTR-BBB", rows[0].payment_reference
db.close()
print("posting a second payment for the same worker/month upserts, doesn't duplicate: PASSED")

different_month = client.post(
    f"/workers/{worker['id']}/wage-payment",
    headers=headers_a,
    json={"month": 9, "year": 2026, "date_of_payment": "2026-10-01", "payment_reference": "UTR-CCC"},
)
assert different_month.status_code == 201, different_month.text
db2 = SessionLocal()
count_all = db2.query(models.WagePayment).filter(models.WagePayment.worker_id == worker["id"]).count()
assert count_all == 2, f"expected 2 distinct month rows, got {count_all}"
db2.close()
print("a different month for the same worker creates a separate row: PASSED")

# --- Cross-owner scoping ---
signup_b = client.post(
    "/owners/signup",
    json={"name": "Payment Owner B", "mobile": "9000000602", "password": "pass123", "factory_name": "Payment Factory B"},
)
token_b = signup_b.json()["access_token"]
headers_b = {"Authorization": f"Bearer {token_b}"}

post_from_b = client.post(
    f"/workers/{worker['id']}/wage-payment",
    headers=headers_b,
    json={"month": 8, "year": 2026, "date_of_payment": "2026-09-01"},
)
assert post_from_b.status_code == 404, post_from_b.text
print("cross-owner scoping on wage payments: PASSED")

print("\nALL ASSERTIONS PASSED")
