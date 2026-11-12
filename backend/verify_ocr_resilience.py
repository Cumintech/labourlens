"""Verifies the OCR endpoint degrades gracefully: an unavailable or
out-of-memory engine answers 503 with an "enter manually" message (never a
crash/502), and a joined address has no doubled commas.

    DATABASE_URL=sqlite:///./scratch.db JWT_SECRET=x ENCRYPTION_KEY=<fernet key> python verify_ocr_resilience.py
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient
from PIL import Image

import ocr
from database import Base, engine
from main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)
s = client.post("/owners/signup", json={"name": "Ocr Owner", "mobile": "9000000931", "password": "pass12345", "factory_name": "Ocr Factory", "consent_given": True})
assert s.status_code == 201, s.text
h = {"Authorization": f"Bearer {s.json()['access_token']}"}

buf = io.BytesIO()
Image.new("RGB", (400, 250), "white").save(buf, format="JPEG")
files = lambda: {"front_image": ("f.jpg", buf.getvalue(), "image/jpeg")}

def raise_(exc):
    def _f(*a, **k):
        raise exc
    return _f

orig = ocr._get_engine
try:
    ocr._get_engine = raise_(ocr.OcrUnavailable("ImportError"))
    r = client.post("/workers/ocr", headers=h, files=files())
    assert r.status_code == 503 and "manually" in r.json()["detail"], r.text
    ocr._get_engine = raise_(MemoryError())
    r = client.post("/workers/ocr", headers=h, files=files())
    assert r.status_code == 503 and "manually" in r.json()["detail"], r.text
finally:
    ocr._get_engine = orig

# A blank card is a valid scan that finds nothing -- 200 with no fields, not an error.
r = client.post("/workers/ocr", headers=h, files=files())
assert r.status_code == 200, r.text
assert not any(r.json().get(k) for k in ("name", "aadhaar_number", "dob")), r.json()

# Either side can be scanned alone (the app scans the front while the back is photographed)
only_back = client.post("/workers/ocr", headers=h, files={"back_image": ("b.jpg", buf.getvalue(), "image/jpeg")})
assert only_back.status_code == 200, only_back.text
none = client.post("/workers/ocr", headers=h)
assert none.status_code == 422, none.text

# Warm-up call: 204 when signed in, refused when not, and never an error if the engine can't load
assert client.post("/workers/ocr/warm", headers=h).status_code == 204
assert client.post("/workers/ocr/warm").status_code in (401, 403)
try:
    ocr._get_engine = raise_(ocr.OcrUnavailable("ImportError"))
    assert client.post("/workers/ocr/warm", headers=h).status_code == 204
finally:
    ocr._get_engine = orig

# CPU limit: OCR_THREADS wins, and the engine's ONNX sessions get exactly that many threads
# (the default sizes pools from the host's cores; on a fractional-CPU container that made a scan ~2x slower).
import os
os.environ["OCR_THREADS"] = "1"
assert ocr._container_cpu_limit() == 1
ocr._engine = None
engine = ocr._get_engine()
assert engine.text_detector.infer.session.get_session_options().intra_op_num_threads == 1
assert engine.text_recognizer.session.session.get_session_options().intra_op_num_threads == 1
import rapidocr_onnxruntime.utils as _u
assert _u.SessionOptions.__name__ != "limited", "SessionOptions was not restored after the engine loaded"
ocr._engine = None
del os.environ["OCR_THREADS"]

# Two threads asking for the engine at once load it once (warm-up + first scan can coincide)
import threading
loads = []
class _FakeRapid:
    def __init__(self, **kw):
        loads.append(1)
import types
fake_mod = types.ModuleType("rapidocr_onnxruntime"); fake_mod.RapidOCR = _FakeRapid
sys.modules["rapidocr_onnxruntime"] = fake_mod
ocr._engine = None
ts = [threading.Thread(target=ocr._get_engine) for _ in range(6)]
[t.start() for t in ts]; [t.join() for t in ts]
assert len(loads) == 1, loads
ocr._engine = None
del sys.modules["rapidocr_onnxruntime"]

# Memory guard: a scan on a nearly-full container is shrunk, or refused with a 503 -- never allowed to
# push the host into killing the whole service (which every user sees as a 502).
real_mem = ocr._memory_usage_limit_mb
try:
    engine = ocr._get_engine()
    det = lambda: engine.text_detector.preprocess_op[0].limit_side_len
    ocr._memory_usage_limit_mb = lambda: (100, 512)      # plenty free -> full size
    ocr.extract_fields(buf.getvalue(), None)
    assert det() == ocr.OCR_DET_LIMIT_SIDE, det()
    ocr._memory_usage_limit_mb = lambda: (370, 512)      # 142 MB free -> reduced detector size
    ocr.extract_fields(buf.getvalue(), None)
    assert det() == ocr.REDUCED_DET_LIMIT_SIDE, det()
    ocr._memory_usage_limit_mb = lambda: (450, 512)      # 62 MB free -> refuse
    refused = client.post("/workers/ocr", headers=h, files=files())
    assert refused.status_code == 503 and "busy" in refused.json()["detail"], refused.text
    ocr._memory_usage_limit_mb = lambda: None            # no limit visible (laptop) -> just scan
    assert client.post("/workers/ocr", headers=h, files=files()).status_code == 200
finally:
    ocr._memory_usage_limit_mb = real_mem

# No CPU quota visible (some hosts hide it): use a small fixed pool, not the host's core count
real_limit = ocr._container_cpu_limit
try:
    ocr._container_cpu_limit = lambda: None
    ocr._engine = None
    e2 = ocr._get_engine()
    assert e2.text_detector.infer.session.get_session_options().intra_op_num_threads == ocr.DEFAULT_OCR_THREADS
finally:
    ocr._container_cpu_limit = real_limit
    ocr._engine = None

# Lines ending in commas must not produce ",," when joined
addr = ocr._guess_address(["Address:", "S/O Muthu, 12, Gandhi Street,", "Anna Nagar, Madurai,", "Tamil Nadu - 625020"])
assert addr and ",," not in addr.replace(" ", "") and addr.endswith("625020"), addr
print("verify_ocr_resilience: OK")
