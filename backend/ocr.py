"""Aadhaar OCR: extracts name/DOB/gender/Aadhaar-number from a front and
back card image. Server-side (this backend, not a third-party cloud OCR
vendor) rather than on-device -- plain Expo Go can't load native OCR
modules (e.g. ML Kit) without switching to a custom dev-client build,
which would break Day 1's "scan the QR code with Expo Go" flow. Keeping
OCR on our own backend, not a third-party API, is the meaningful privacy
line: raw ID images never leave infrastructure this project controls.

Uses EasyOCR (pure pip-installable, no system binary) rather than
Tesseract -- this dev machine has no package manager (no winget/choco)
and the UB-Mannheim installer blocks non-browser downloads (403), so
Tesseract's system binary isn't reliably installable here. A Linux
production deploy could trivially `apt-get install tesseract-ocr`
instead; revisit this choice if/when that's the real deploy target,
since EasyOCR (PyTorch-based) is a heavier dependency and slower on CPU.

Extraction is heuristic, not guaranteed -- this is exactly why Day 2's
manual-correction UI exists. Never treat this module's output as
final without the owner reviewing it first.
"""

import re

import easyocr

_reader: easyocr.Reader | None = None


def _get_reader() -> easyocr.Reader:
    # Loaded once and reused -- each Reader() call loads real models into
    # memory, far too expensive to do per-request.
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(["en"], gpu=False)
    return _reader


AADHAAR_PATTERN = re.compile(r"\b(\d{4})\s?(\d{4})\s?(\d{4})\b")
DOB_PATTERN = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b")
GENDER_KEYWORDS = {"MALE": "Male", "FEMALE": "Female", "TRANSGENDER": "Other"}

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


def _extract_text_lines(image_bytes: bytes) -> list[str]:
    reader = _get_reader()
    results = reader.readtext(image_bytes)
    return [text for (_bbox, text, _conf) in results]


def _guess_name(lines: list[str]) -> str | None:
    for line in lines:
        upper = line.upper()
        if any(keyword in upper for keyword in NAME_EXCLUDE_KEYWORDS):
            continue
        if AADHAAR_PATTERN.search(line) or DOB_PATTERN.search(line):
            continue
        letters = sum(c.isalpha() for c in line)
        if letters >= 4:
            return line.strip()
    return None


def extract_fields(front_image_bytes: bytes, back_image_bytes: bytes | None = None) -> dict:
    """Returns whatever fields could be confidently identified; missing
    keys mean "OCR didn't find this, the owner enters it manually" -- not
    an error. Front card carries name/DOB/gender/Aadhaar number; back
    typically carries the address, so both are scanned when available and
    merged."""
    front_lines = _extract_text_lines(front_image_bytes)
    all_lines = list(front_lines)
    if back_image_bytes:
        all_lines += _extract_text_lines(back_image_bytes)

    joined = " ".join(all_lines)
    fields: dict = {}

    aadhaar_match = AADHAAR_PATTERN.search(joined)
    if aadhaar_match:
        fields["aadhaar_number"] = "".join(aadhaar_match.groups())

    dob_match = DOB_PATTERN.search(joined)
    if dob_match:
        day, month, year = dob_match.groups()
        fields["dob"] = f"{year}-{int(month):02d}-{int(day):02d}"

    for keyword, normalized in GENDER_KEYWORDS.items():
        if keyword in joined.upper():
            fields["gender"] = normalized
            break

    name = _guess_name(front_lines)
    if name:
        fields["name"] = name

    return fields
