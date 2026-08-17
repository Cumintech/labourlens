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

import re
import unicodedata

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
PIN_CODE_PATTERN = re.compile(r"\b\d{6}\b")

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
ADDRESS_STOP_KEYWORDS = (
    "VID",
    "WWW.",
    "UIDAI",
    "GOVERNMENT",
    "SIGNATURE",
    "HELP@UIDAI",
)

ADDRESS_MAX_LINES = 6


def _extract_text_lines(image_bytes: bytes) -> list[str]:
    reader = _get_reader()
    results = reader.readtext(image_bytes)
    return [text for (_bbox, text, _conf) in results]


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


def _guess_name(lines: list[str]) -> str | None:
    for line in lines:
        upper = line.upper()
        if any(keyword in upper for keyword in NAME_EXCLUDE_KEYWORDS):
            continue
        if AADHAAR_PATTERN.search(line) or DOB_PATTERN.search(line):
            continue
        if not _is_mostly_latin(line):
            continue
        letters = sum(c.isalpha() for c in line)
        if letters >= 4:
            return line.strip()
    return None


def _guess_address(lines: list[str]) -> str | None:
    """Looks for a line containing "Address", then collects subsequent
    lines until a 6-digit PIN code (included) or a stop-keyword line is
    hit, capped at ADDRESS_MAX_LINES so a bad match can't run away and
    swallow the rest of the card's text."""
    start_idx = None
    for i, line in enumerate(lines):
        if "ADDRESS" in line.upper():
            start_idx = i
            break
    if start_idx is None:
        return None

    collected = []
    # The "Address" label line itself is usually just the label, not
    # address content -- start from the line after it, but fall back to
    # including it if it's the only thing found.
    for line in lines[start_idx + 1 : start_idx + 1 + ADDRESS_MAX_LINES]:
        upper = line.upper()
        if any(keyword in upper for keyword in ADDRESS_STOP_KEYWORDS):
            break
        collected.append(line.strip())
        if PIN_CODE_PATTERN.search(line):
            break

    if not collected:
        return None
    return ", ".join(collected)


def extract_fields(front_image_bytes: bytes, back_image_bytes: bytes | None = None) -> dict:
    """Returns whatever fields could be confidently identified; missing
    keys mean "OCR didn't find this, the owner enters it manually" -- not
    an error. Front card carries name/DOB/gender/Aadhaar number; back
    typically carries the address, so both are scanned when available and
    merged."""
    front_lines = _extract_text_lines(front_image_bytes)
    back_lines = _extract_text_lines(back_image_bytes) if back_image_bytes else []
    all_lines = front_lines + back_lines

    joined = " ".join(all_lines)
    fields: dict = {}

    aadhaar_match = AADHAAR_PATTERN.search(joined)
    if aadhaar_match:
        fields["aadhaar_number"] = "".join(aadhaar_match.groups())

    dob_match = DOB_PATTERN.search(joined)
    if dob_match:
        day, month, year = dob_match.groups()
        fields["dob"] = f"{year}-{int(month):02d}-{int(day):02d}"

    upper_joined = joined.upper()
    for pattern, normalized in GENDER_PATTERNS:
        if pattern.search(upper_joined):
            fields["gender"] = normalized
            break

    name = _guess_name(front_lines)
    if name:
        fields["name"] = name

    # Address is typically on the back, but check both -- some cards
    # (or scan orders) may only have one side provided.
    address = _guess_address(back_lines) or _guess_address(front_lines)
    if address:
        fields["current_address"] = address

    return fields
