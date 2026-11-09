"""Aadhaar OCR: extracts name/DOB/gender/Aadhaar-number/address from a
front and back card image. Server-side (this backend, not a third-party
cloud OCR vendor) rather than on-device -- plain Expo Go can't load
native OCR modules (e.g. ML Kit) without switching to a custom dev-client
build, which would break Day 1's "scan the QR code with Expo Go" flow.
Keeping OCR on our own backend, not a third-party API, is the meaningful
privacy line: raw ID images never leave infrastructure this project
controls.

Uses EasyOCR (pure pip-installable, no system binary) rather than
Tesseract -- this dev machine has no package manager (no winget/choco)
and the UB-Mannheim installer blocks non-browser downloads (403), so
Tesseract's system binary isn't reliably installable here. A Linux
production deploy could trivially `apt-get install tesseract-ocr`
instead; revisit this choice if/when that's the real deploy target,
since EasyOCR (PyTorch-based) is a heavier dependency and slower on CPU.

Extraction is heuristic, not guaranteed -- this is exactly why the
manual-correction UI exists. Never treat this module's output as final
without the owner reviewing it first.

Day 3 refinements from real-card testing (Day 2's synthetic test image
never exercised any of these, since it only ever had one language, one
gender keyword, and no address text at all):
- Name extraction now filters to predominantly-Latin-script lines --
  real cards print the name in English AND a regional script, and the
  original heuristic picked whichever line came first regardless of
  script, which was usually wrong.
- Gender matching now uses word-boundary regex, not substring "in"
  checks -- the original code checked "MALE" before "FEMALE" using
  `keyword in text`, and "MALE" is literally a substring of "FEMALE",
  so a female card's OCR text would have incorrectly matched "Male"
  first. Real bug, not just a hardening exercise.
- Address extraction is new -- previously owner-entered only.
"""

from __future__ import annotations

import io
import logging
import math
import os
import re
from datetime import date
import threading
import time
import unicodedata

from PIL import Image, ImageOps

from verhoeff import validate_verhoeff


# Real-device scans come off a phone camera at full resolution (often
# 3000px+ on the long edge), which EasyOCR (CPU, PyTorch-based) is slow
# on. Downscaling first cuts scan time meaningfully with no measured
# loss in field-extraction accuracy -- the text on an Aadhaar card is
# large enough relative to the card that 1600px is still plenty of
# resolution for EasyOCR's recognizer.
MAX_OCR_DIMENSION = 1280


def _prepare_image(image_bytes: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(image_bytes))
    # JPEG draft mode decodes straight at a reduced size (the decoder skips
    # detail it would throw away), so a 12MP phone photo never exists in
    # memory at full size -- a large part of the scan's peak memory.
    img.draft("RGB", (MAX_OCR_DIMENSION, MAX_OCR_DIMENSION))
    # Phone cameras often store the picture sideways plus an EXIF "rotate me"
    # tag; honour it so the card is the right way up where the file says so.
    img = ImageOps.exif_transpose(img).convert("RGB")
    largest_side = max(img.size)
    if largest_side > MAX_OCR_DIMENSION:
        scale = MAX_OCR_DIMENSION / largest_side
        new_size = (int(img.width * scale), int(img.height * scale))
        img = img.resize(new_size, Image.LANCZOS)
    return img


def _resize_for_ocr(image_bytes: bytes) -> bytes:
    buf = io.BytesIO()
    _prepare_image(image_bytes).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


class OcrUnavailable(Exception):
    """The OCR engine could not be imported or loaded (missing library,
    out of memory). Surfaced as a 503 with a "enter manually" message, not
    a crash."""


# "rapidocr" (default): ONNX Runtime, ~170 MB resident once loaded, about a
# second per card on CPU -- fits a small (512 MB) Render instance.
# "easyocr": PyTorch based, ~1 GB+ resident -- the original engine, kept for
# local/dev machines that have it installed (it is no longer in
# requirements.txt, because loading it ran the 512 MB instance out of memory
# and every scan came back as a 502).
OCR_ENGINE = os.environ.get("OCR_ENGINE", "rapidocr").lower()

# Detector input cap (long side, px). 960 reads a card fine and peaks ~295 MB
# in a standalone process; lower it (e.g. 640) on a very small instance if
# scans still run out of memory -- smaller text (the address) gets harder to read.
OCR_DET_LIMIT_SIDE = int(os.environ.get("OCR_DET_LIMIT_SIDE", "960"))

_engine = None
_engine_lock = threading.Lock()
# One scan at a time: two concurrent scans would double peak memory.
_ocr_lock = threading.Lock()


def _limit_malloc_arenas() -> None:
    """glibc gives every worker thread its own malloc arena, and inference
    running on the request threadpool leaves several of them holding freed
    memory (about 40 MB measured). Capping arenas keeps the resident set
    smaller. Linux/glibc only; a no-op anywhere else."""
    try:
        import ctypes

        ctypes.CDLL("libc.so.6").mallopt(-8, 2)  # M_ARENA_MAX
    except Exception:
        pass


def _cgroup_cpu_candidates() -> list[tuple[str, str]]:
    """(kind, path) of every place this process's CPU quota may be recorded: the
    container root (the usual case, where the container's own cgroup is mounted
    at /sys/fs/cgroup) and the cgroup path listed in /proc/self/cgroup."""
    found = [("v2", "/sys/fs/cgroup/cpu.max"), ("v1", "/sys/fs/cgroup/cpu")]
    try:
        for line in open("/proc/self/cgroup").read().splitlines():
            _num, controllers, path = line.split(":", 2)
            path = path.strip("/")
            if controllers == "":
                found.append(("v2", f"/sys/fs/cgroup/{path}/cpu.max"))
            elif "cpu" in controllers.split(","):
                found.append(("v1", f"/sys/fs/cgroup/cpu/{path}" if path else "/sys/fs/cgroup/cpu"))
    except Exception:
        pass
    return found


def _container_cpu_limit() -> int | None:
    """How many CPUs this container may really use, from the cgroup quota
    (a host with 64 cores can still give a service half of one). OCR_THREADS
    overrides. None when unknown."""
    override = os.environ.get("OCR_THREADS")
    if override and override.isdigit() and int(override) > 0:
        return int(override)
    for kind, path in _cgroup_cpu_candidates():
        try:
            if kind == "v2":  # "max 100000" or "50000 100000"
                quota, period = open(path).read().split()[:2]
                if quota != "max":
                    return max(1, math.ceil(int(quota) / int(period)))
            else:
                quota = int(open(f"{path}/cpu.cfs_quota_us").read())
                period = int(open(f"{path}/cpu.cfs_period_us").read())
                if quota > 0:
                    return max(1, math.ceil(quota / period))
        except Exception:
            continue
    return None


class _ThreadLimit:
    """While the engine is built, size its thread pools to the container's
    real CPU count. ONNX Runtime sizes them from the cores it can see, and a
    container sees the whole host: on a 0.5 CPU quota a two-sided scan took
    6.6 s with the default pools and 3.3 s with one thread (measured, same
    code) -- threads fight over a sliver of CPU instead of working. Only
    applies when a limit is known (cgroup quota or OCR_THREADS); on a machine
    with no limit the defaults are left alone."""

    def __enter__(self):
        self.restore = None
        self.limit = _container_cpu_limit()
        if self.limit is None:
            return self
        try:
            import cv2

            cv2.setNumThreads(self.limit)
        except Exception:
            pass
        try:
            if OCR_ENGINE == "easyocr":
                import torch

                torch.set_num_threads(self.limit)
            else:
                import rapidocr_onnxruntime.utils as ort_utils

                original, limit = ort_utils.SessionOptions, self.limit

                def limited():
                    options = original()
                    options.intra_op_num_threads = limit
                    options.inter_op_num_threads = 1
                    return options

                ort_utils.SessionOptions = limited
                self.restore = (ort_utils, original)
        except Exception:  # leave the defaults rather than fail to load
            self.restore = None
        return self

    def __exit__(self, *exc):
        if self.restore is not None:
            self.restore[0].SessionOptions = self.restore[1]


def _get_engine():
    # The engine (and onnxruntime / torch) is imported here, not at module
    # level -- merely importing it costs resident memory, and
    # OCR_WARM_UP=false (see main.py's lifespan) is meant to keep that cost
    # off the startup path. Python caches the import after the first call.
    global _engine
    if _engine is not None:
        return _engine
    # One load at a time: the warm-up call and a first scan can arrive together,
    # and two simultaneous loads double the memory.
    with _engine_lock:
        if _engine is None:
            try:
                with _ThreadLimit() as limiter:
                    if OCR_ENGINE == "easyocr":
                        import easyocr

                        _engine = easyocr.Reader(["en"], gpu=False)
                    else:
                        from rapidocr_onnxruntime import RapidOCR

                        # Cap the detector's input on the long side. Its default
                        # upscales every image to at least 736px on the short side, which
                        # made a scan spike to ~375 MB; capped at 960px it peaks ~295 MB with the same
                        # fields read (measured). det_model_path=None keeps the bundled model.
                        _limit_malloc_arenas()
                        _engine = RapidOCR(det_limit_side_len=OCR_DET_LIMIT_SIDE, det_limit_type="max", det_model_path=None)
                logging.getLogger("uvicorn.error").info(
                    "OCR engine ready: %s, cpu limit %s", OCR_ENGINE, limiter.limit if limiter.limit else "none detected"
                )
            except Exception as exc:  # ImportError, onnx/torch load failure, MemoryError
                # The error text names a missing library or model, never card data,
                # so it is safe (and needed) in the logs to diagnose a host.
                logging.getLogger("uvicorn.error").error("OCR engine failed to load: %s: %s", type(exc).__name__, exc)
                raise OcrUnavailable(type(exc).__name__) from exc
    return _engine


def warm_up() -> None:
    """Loads the OCR engine eagerly. Call once at backend startup so the
    model-load cost lands during server startup, not during an owner's
    first real scan."""
    _get_engine()


AADHAAR_PATTERN = re.compile(r"\b(\d{4})\s?(\d{4})\s?(\d{4})\b")
DOB_PATTERN = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b")
# Same, but tolerant of OCR spacing ("15 / 06 / 1984").
DATE_PATTERN = re.compile(r"\b(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})\b")
DOB_LABEL = re.compile(r"\b(D\s?[O0]\s?B|D\.\s?O\.\s?B|BIRTH|YOB)\b|जन्म")
# Other dates printed on the card/letter -- never a date of birth.
NON_DOB_DATE_WORDS = ("ISSUE", "DOWNLOAD", "GENERAT", "PRINT", "UPDATE", "AS ON", "ENROL", "VALID", "DATE:")
PIN_CODE_PATTERN = re.compile(r"\b\d{6}\b")
# "3RD", "1ST", "2ND" -- ordinal numbers are a normal part of a real
# street name ("ANDIYAPPAN 3RD LANE") and shouldn't be treated as OCR
# noise just because they mix a digit with letters.
ORDINAL_PATTERN = re.compile(r"^\d+(ST|ND|RD|TH)$", re.IGNORECASE)

# Order doesn't actually matter for correctness now (word-boundary regex
# means "MALE" can't match inside "FEMALE"), but FEMALE/TRANSGENDER are
# still checked first for clarity -- the old ordering is exactly what
# caused the bug this replaces.
GENDER_PATTERNS = (
    (re.compile(r"\bFEMALE\b"), "Female"),
    (re.compile(r"\bTRANSGENDER\b"), "Other"),
    (re.compile(r"\bMALE\b"), "Male"),
)

# Boilerplate text that appears on every Aadhaar card -- excluded when
# guessing which line is the person's name, since it isn't one.
NAME_EXCLUDE_KEYWORDS = (
    "GOVERNMENT",
    "INDIA",
    "AADHAAR",
    "UNIQUE",
    "IDENTIFICATION",
    "AUTHORITY",
    "DOB",
    "DATE OF BIRTH",
    "MALE",
    "FEMALE",
    "ADDRESS",
)

# Lines containing these mark the end of an address block or aren't part
# of one -- stop collecting address lines once one of these shows up.
# "WWW." (with the period) never matched a real card's OCR output, which
# reads as "WwW" with no trailing punctuation -- found on real-device
# testing, not a hypothetical.
ADDRESS_STOP_KEYWORDS = (
    "VID",
    "WWW",
    "UIDAI",
    "GOVERNMENT",
    "SIGNATURE",
    "HELP@UIDAI",
)

# How many raw OCR lines after the "Address" label to look through before
# giving up. Real cards print the address in a regional script followed
# by English -- with an English-only reader (see the module docstring),
# the regional-script portion doesn't come back as recognizable Tamil
# text, it comes back as meaningless Latin-letter noise ("WJUJUGOT"),
# often running 6+ lines before the real English address and its PIN
# code even start. The old 6-line cap cut off before ever reaching them.
ADDRESS_SCAN_WINDOW = 25
# How many non-trivial lines to actually keep once found -- a separate,
# generous cap from the scan window so a genuinely long bilingual block
# doesn't get truncated right before its own PIN code.
ADDRESS_MAX_LINES = 15


def _box_is_vertical(box) -> bool:
    """True when a detected text box is clearly taller than it is wide."""
    try:
        (x0, y0), (x1, y1), (x2, y2) = box[0], box[1], box[2]
        width = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
        height = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        return height > 1.5 * width
    except Exception:
        return False


def _run_engine(img: Image.Image) -> list[tuple[str, float, bool]]:
    """One OCR pass over an image: [(text, confidence, is_vertical), ...] in
    the engine's order (top to bottom of the image as given)."""
    import numpy as np

    engine = _get_engine()
    with _ocr_lock:
        if OCR_ENGINE == "easyocr":
            return [(text, float(conf), _box_is_vertical(box)) for (box, text, conf) in engine.readtext(np.array(img))]
        result, _elapsed = engine(np.array(img))
    # RapidOCR returns [[box, text, confidence], ...] (None when nothing found)
    return [(text, float(conf), _box_is_vertical(box)) for (box, text, conf) in (result or [])]


# Words printed on every card; finding several of them is how we tell that a
# pass read real card text rather than noise.
ORIENTATION_ANCHORS = (
    "GOVERNMENT", "INDIA", "AADHAAR", "UNIQUE", "IDENTIFICATION", "AUTHORITY",
    "DOB", "BIRTH", "MALE", "FEMALE", "ADDRESS", "UIDAI", "ENROLMENT", "VID",
)
# Enough anchors in the first pass and we don't try other rotations.
ORIENTATION_GOOD_ENOUGH = 4
# Printed near the top / bottom of a card side. An upside-down page still reads
# correctly line by line (the engine flips each line) but comes back in reverse
# order, which breaks "the address follows the Address label".
HEADER_WORDS = ("GOVERNMENT", "UNIQUE", "IDENTIFICATION", "AUTHORITY")
FOOTER_WORDS = ("VID", "UIDAI", "WWW", "GOV.IN", "HELP")


def _orientation_score(lines: list[tuple[str, float, bool]]) -> float:
    if not lines:
        return 0.0
    anchors = sum(1 for text, _c, _v in lines if any(word in text.upper() for word in ORIENTATION_ANCHORS))
    joined = " ".join(text for text, _c, _v in lines)
    bonus = 2.0 * bool(AADHAAR_PATTERN.search(joined)) + 2.0 * bool(DATE_PATTERN.search(joined))
    mean_conf = sum(conf for _t, conf, _v in lines) / len(lines)
    return anchors * 2.0 + bonus + mean_conf


def _looks_reversed(lines: list[tuple[str, float, bool]]) -> bool:
    n = len(lines)
    header = [i for i, (t, _c, _v) in enumerate(lines) if any(w in t.upper() for w in HEADER_WORDS)]
    footer = [i for i, (t, _c, _v) in enumerate(lines) if any(w in t.upper() for w in FOOTER_WORDS)]
    if header and footer:
        return sum(header) / len(header) > sum(footer) / len(footer)
    if header:
        return sum(header) / len(header) > (n - 1) / 2
    if footer:
        return sum(footer) / len(footer) < (n - 1) / 2
    return False


def _vertical_share(lines: list[tuple[str, float, bool]]) -> float:
    real = [v for t, _c, v in lines if sum(c.isalnum() for c in t) >= 3]
    return sum(real) / len(real) if real else 0.0


PROBE_SIDE = 512


def _probe_vertical_share(img: Image.Image) -> float | None:
    """Cheap check of whether the card is sideways: run only the text
    *detector* on a small copy (about a quarter of a full pass) and look at
    the shape of the boxes. None when it can't tell (other engine, or too few
    boxes found)."""
    if OCR_ENGINE == "easyocr":
        return None
    import numpy as np

    engine = _get_engine()
    scale = PROBE_SIDE / max(img.size)
    thumb = img.resize((int(img.width * scale), int(img.height * scale)), Image.BILINEAR) if scale < 1 else img
    with _ocr_lock:
        boxes, _elapsed = engine.text_detector(np.array(thumb))
    if boxes is None or len(boxes) < 3:
        return None
    return sum(_box_is_vertical(b) for b in boxes) / len(boxes)


def _extract_text_lines(image_bytes: bytes) -> list[str]:
    """Reads a card photo and returns its lines top to bottom, whatever way up
    the photo is. People photograph a landscape card with the phone held
    upright, so the text runs sideways (tall text boxes): the engine can read
    that but returns the lines in scrambled order, so such a page is turned
    upright first -- decided by a cheap detector-only probe so the (slow) full
    pass runs once, not once per rotation. An upside-down page reads correctly
    line by line but comes back in reverse order, which is fixed by reversing
    the list (identical to re-running it flipped, without the second pass)."""
    img = _prepare_image(image_bytes)
    share = _probe_vertical_share(img)
    turned = share is not None and share >= 0.5
    if turned:
        img = img.transpose(Image.Transpose.ROTATE_90)
    lines = _run_engine(img)

    if share is None and not turned and _vertical_share(lines) >= 0.5:
        # No probe available: the page's own boxes say it is sideways.
        img = img.transpose(Image.Transpose.ROTATE_90)
        lines = _run_engine(img)
        turned = True

    anchors = sum(1 for t, _c, _v in lines if any(w in t.upper() for w in ORIENTATION_ANCHORS))
    if anchors < 2 and not turned:
        # Nothing card-like read at all (blurry / odd angle): try the other turns
        best_score = _orientation_score(lines)
        for rotation in (Image.Transpose.ROTATE_90, Image.Transpose.ROTATE_270):
            candidate = _run_engine(img.transpose(rotation))
            score = _orientation_score(candidate)
            if score > best_score + 1.0:  # a clear win, not noise
                lines, best_score = candidate, score

    if _looks_reversed(lines):
        lines = lines[::-1]
    return [text for text, _c, _v in lines]


def _is_mostly_latin(line: str) -> bool:
    """True if the alphabetic characters in this line are predominantly
    Latin script (English) rather than a regional script (Devanagari,
    Tamil, etc.) -- Aadhaar cards print the name in both, and without
    this check the heuristic below has no way to prefer the English
    line over the regional-language one."""
    alpha_chars = [c for c in line if c.isalpha()]
    if not alpha_chars:
        return False
    latin_count = sum(1 for c in alpha_chars if "LATIN" in unicodedata.name(c, ""))
    return (latin_count / len(alpha_chars)) >= 0.8


# First four letters of boilerplate words printed on cards/letters. OCR often
# garbles these ("Authority" -> "auther"), so an exact-keyword check misses
# them and they get picked as the person's name.
BOILERPLATE_PREFIXES = (
    "AUTH", "GOVE", "GOVT", "UNIQ", "IDEN", "AADH", "AADA", "ENRO", "SIGN",
    "DOWN", "ISSU", "VERI", "ADDR", "DIGI", "ELEC", "HELP", "TOLL", "PROO",
    "CITI", "ONLI", "OFFL", "DATE", "BIRT", "FEMA", "TRAN", "INDI", "MALE",
)


def _is_boilerplate_line(line: str) -> bool:
    upper = line.upper()
    if any(keyword in upper for keyword in NAME_EXCLUDE_KEYWORDS):
        return True
    return any(len(tok) >= 4 and tok[:4] in BOILERPLATE_PREFIXES for tok in re.findall(r"[A-Z]+", upper))


def _valid_name_line(line: str) -> bool:
    if _is_boilerplate_line(line):
        return False
    if AADHAAR_PATTERN.search(line) or DATE_PATTERN.search(line):
        return False
    if not _is_mostly_latin(line):
        return False
    # A real name never contains digits -- a noisy OCR line with
    # stray digits (VID fragments, misread boilerplate) was beating
    # the actual name line before this check existed (a real bug
    # found on real-device testing, not a hypothetical).
    if any(c.isdigit() for c in line):
        return False
    # Letters, spaces and the odd dot/apostrophe only
    if sum(1 for c in line if not (c.isalpha() or c in " .'-")) > 0:
        return False
    return sum(c.isalpha() for c in line) >= 4


def _find_dob_line(lines: list[str]) -> int | None:
    """Index of the line carrying the date of birth (a "DOB"/"Date of Birth"
    label, or the date directly under one), else None."""
    for i, line in enumerate(lines):
        up = line.upper()
        if DOB_LABEL.search(up) and (DATE_PATTERN.search(line) or i + 1 < len(lines)):
            return i
    return None


def _tidy_name(line: str) -> str:
    # Blurry photos make the engine run words together ("GaneshPrabu")
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", " ".join(line.split()))


def _guess_name(lines: list[str], dob_line: int | None = None) -> str | None:
    # On an Aadhaar front the English name is printed directly above the
    # "DOB:" line, so when that line is known look just above it first --
    # far more reliable than "first line that looks like a name", which
    # also matches garbled boilerplate.
    if dob_line is not None:
        for idx in range(dob_line - 1, max(dob_line - 5, -1), -1):
            if _valid_name_line(lines[idx]):
                return _tidy_name(lines[idx])
    for line in lines:
        if _valid_name_line(line):
            return _tidy_name(line)
    return None


def _guess_dob(front_lines: list[str], back_lines: list[str]) -> str | None:
    """Date of birth as YYYY-MM-DD. A labelled date wins; otherwise an
    unlabelled date from the FRONT only. Cards and letters print other dates
    too (issue, download, details-as-on) -- those are never taken, and dates
    that make the person younger than 10 are treated as OCR/other-date noise."""
    today = date.today()
    candidates = []
    for side, lines in ((0, front_lines), (1, back_lines)):
        for i, line in enumerate(lines):
            up = line.upper()
            labelled = bool(DOB_LABEL.search(up)) or (i > 0 and bool(DOB_LABEL.search(lines[i - 1].upper())))
            if not labelled:
                if side == 1 or any(word in up for word in NON_DOB_DATE_WORDS):
                    continue
            for m in DATE_PATTERN.finditer(line):
                day, month, year = (int(g) for g in m.groups())
                try:
                    parsed = date(year, month, day)
                except ValueError:
                    continue
                if parsed.year < 1900 or parsed.year > today.year - 10:
                    continue
                candidates.append((0 if labelled else 1, side, i, parsed))
    return min(candidates)[3].isoformat() if candidates else None


def _looks_like_clean_address_line(line: str) -> bool:
    """True if every token on this line is either alphabetic, purely
    numeric (a house/door number, or a PIN), or an ordinal like "3RD" --
    i.e. it reads like a real address fragment, not a token where OCR
    has jammed letters and digits together mid-word (e.g. "G00llq",
    "QU6M"), which is the actual signature of the regional-script noise
    an English-only reader produces (see the module docstring). Requires
    at least 2 such tokens so a single stray number doesn't count."""
    tokens = line.split()
    if len(tokens) < 2:
        return False
    clean_count = 0
    for tok in tokens:
        core = tok.strip(",.;:'\"()-")
        if not core:
            continue
        if core.isalpha() or core.isdigit() or ORDINAL_PATTERN.match(core):
            clean_count += 1
        else:
            return False
    return clean_count >= 2


def _guess_address(lines: list[str]) -> str | None:
    """Looks for a line containing "Address", then collects subsequent
    lines up to ADDRESS_MAX_LINES, scanning up to ADDRESS_SCAN_WINDOW raw
    lines to get there. Two trims are then applied, found from real scans
    of the same physical card:

    1. Trims everything BEFORE the first "clean" line (see
       _looks_like_clean_address_line) -- real cards print "Address:
       S/O: <father's name>, <door no.>, ..." before the actual street
       name, and the S/O/door-number portion is dense with
       regional-script-misread-as-Latin noise (house numbers like "3/2"
       stuck to garbled fragments). Real-device feedback was explicit:
       the address should start at the street name, not the S/O
       preamble.

    2. Trims everything AFTER the LAST line containing a PIN code. The
       footer boilerplate that should otherwise mark "the address block
       is over" (UIDAI, www..., the help line) gets OCR'd differently
       almost every time -- one scan read "WwW", the very next read
       "Wwi", neither of which matches the other, so matching it by
       fixed keyword is fundamentally unreliable. A 6-digit PIN code is
       far more OCR-stable than English boilerplate text, and real cards
       restate it (once standalone, once in the closing "State, PIN"
       line) -- stopping right after the last one seen reliably drops
       the trailing Aadhaar-number/footer noise without depending on
       boilerplate text surviving OCR intact.

    This does NOT cleanly separate the regional-script noise mixed
    *within* the kept address lines from the real English address (an
    English-only OCR reader has no way to tell them apart by content,
    only by unicode script, and the noise is already Latin-charset
    garbage, not real Tamil unicode) -- some noise lines will still show
    up in the result. That's a real limitation, not silently hidden:
    this is exactly why the manual-correction UI exists, and it's a
    strict improvement over the old behavior, which dropped the real
    address and PIN code entirely rather than just adding noise around
    them."""
    start_idx = None
    for i, line in enumerate(lines):
        if "ADDRESS" in line.upper():
            start_idx = i
            break
    if start_idx is None:
        return None

    collected = []
    # The "Address" label line itself is usually just the label, not
    # address content -- start from the line after it. The stop-keyword
    # check stays as an early bail-out for the rare clean-OCR case (or a
    # scan with no PIN code to anchor on at all), not the primary way
    # this decides where the address ends.
    for line in lines[start_idx + 1 : start_idx + 1 + ADDRESS_SCAN_WINDOW]:
        upper = line.upper()
        if any(keyword in upper for keyword in ADDRESS_STOP_KEYWORDS):
            break
        stripped = line.strip().rstrip(",;").strip()
        # Drop bare label fragments ("Sio:", ":") -- real content, even
        # noisy OCR content, carries more than a couple of characters.
        if sum(c.isalnum() for c in stripped) <= 3:
            continue
        collected.append(stripped)
        if len(collected) >= ADDRESS_MAX_LINES:
            break

    if not collected:
        return None

    # Trim the S/O / father-name / door-number preamble by starting from
    # the first line that actually looks like real address content.
    first_clean_idx = next((i for i, line in enumerate(collected) if _looks_like_clean_address_line(line)), None)
    if first_clean_idx is not None:
        collected = collected[first_clean_idx:]

    last_pin_idx = None
    for i, line in enumerate(collected):
        if PIN_CODE_PATTERN.search(line):
            last_pin_idx = i
    if last_pin_idx is not None:
        collected = collected[: last_pin_idx + 1]

    if not collected:
        return None
    return ", ".join(collected)


def _guess_aadhaar(lines: list[str]) -> str | None:
    """The 12-digit Aadhaar number. A number passing the Verhoeff check
    beats one that doesn't, and a line carrying the 16-digit VID is skipped
    (its first 12 digits look just like an Aadhaar number)."""
    candidates: list[str] = []
    for line in lines:
        if "VID" in line.upper():
            continue
        for m in AADHAAR_PATTERN.finditer(line):
            # part of a longer digit run (a VID split across lines)? skip
            tail = line[m.end():].lstrip()
            if tail[:1].isdigit():
                continue
            candidates.append("".join(m.groups()))
    if not candidates:
        # OCR often splits the number oddly ("1234 56 789012") -- accept a
        # line that is exactly 12 digits once spaces/noise are stripped
        # (VID lines are 16 digits, so they never match).
        for line in lines:
            digits = re.sub(r"\D", "", line)
            if len(digits) == 12 and len(re.sub(r"[\d\s]", "", line)) <= 2 and "VID" not in line.upper():
                candidates.append(digits)
    for digits in candidates:
        if validate_verhoeff(digits):
            return digits
    return candidates[0] if candidates else None


def extract_fields(front_image_bytes: bytes | None, back_image_bytes: bytes | None = None) -> dict:
    """Returns whatever fields could be confidently identified; missing
    keys mean "OCR didn't find this, the owner enters it manually" -- not
    an error. Front card carries name/DOB/gender/Aadhaar number; back
    typically carries the address, so both are scanned when available and
    merged."""
    started = time.monotonic()
    front_lines = _extract_text_lines(front_image_bytes) if front_image_bytes else []
    back_lines = _extract_text_lines(back_image_bytes) if back_image_bytes else []
    all_lines = front_lines + back_lines

    # Raw OCR text (Aadhaar, name, address) must never be printed or logged.

    joined = " ".join(all_lines)
    fields: dict = {}

    aadhaar = _guess_aadhaar(all_lines)
    if aadhaar:
        fields["aadhaar_number"] = aadhaar

    dob = _guess_dob(front_lines, back_lines)
    if dob:
        fields["dob"] = dob

    upper_joined = joined.upper()
    for pattern, normalized in GENDER_PATTERNS:
        if pattern.search(upper_joined):
            fields["gender"] = normalized
            break

    name = _guess_name(front_lines, _find_dob_line(front_lines))
    if name:
        fields["name"] = name

    # Address is typically on the back, but check both -- some cards
    # (or scan orders) may only have one side provided.
    address = _guess_address(back_lines) or _guess_address(front_lines)
    if address:
        fields["current_address"] = address

    # Timing only -- never any card text.
    logging.getLogger("uvicorn.error").info(
        "ocr scan: %.1fs, sides=%d, fields=%d", time.monotonic() - started, bool(front_image_bytes) + bool(back_image_bytes), len(fields)
    )
    return fields
