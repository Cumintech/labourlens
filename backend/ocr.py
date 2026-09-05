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

import io
import re
import unicodedata

import easyocr
from PIL import Image

_reader: easyocr.Reader | None = None

# Real-device scans come off a phone camera at full resolution (often
# 3000px+ on the long edge), which EasyOCR (CPU, PyTorch-based) is slow
# on. Downscaling first cuts scan time meaningfully with no measured
# loss in field-extraction accuracy -- the text on an Aadhaar card is
# large enough relative to the card that 1600px is still plenty of
# resolution for EasyOCR's recognizer.
MAX_OCR_DIMENSION = 1600


def _resize_for_ocr(image_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    largest_side = max(img.size)
    if largest_side > MAX_OCR_DIMENSION:
        scale = MAX_OCR_DIMENSION / largest_side
        new_size = (int(img.width * scale), int(img.height * scale))
        img = img.resize(new_size, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _get_reader() -> easyocr.Reader:
    # Loaded once and reused -- each Reader() call loads real models into
    # memory, far too expensive to do per-request.
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(["en"], gpu=False)
    return _reader


def warm_up() -> None:
    """Loads the EasyOCR model eagerly. Call once at backend startup so
    the model-load cost (several seconds, separate from the resize
    speedup) lands during server startup, not during an owner's first
    real scan -- real-device feedback flagged scanning as "very slow",
    which lazy-loading on the first request would produce every time the
    dev backend restarts."""
    _get_reader()


AADHAAR_PATTERN = re.compile(r"\b(\d{4})\s?(\d{4})\s?(\d{4})\b")
DOB_PATTERN = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b")
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


def _extract_text_lines(image_bytes: bytes) -> list[str]:
    reader = _get_reader()
    results = reader.readtext(_resize_for_ocr(image_bytes))
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
        # A real name never contains digits -- a noisy OCR line with
        # stray digits (VID fragments, misread boilerplate) was beating
        # the actual name line before this check existed (a real bug
        # found on real-device testing, not a hypothetical).
        if any(c.isdigit() for c in line):
            continue
        letters = sum(c.isalpha() for c in line)
        if letters >= 4:
            return line.strip()
    return None


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
        stripped = line.strip()
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


def extract_fields(front_image_bytes: bytes, back_image_bytes: bytes | None = None) -> dict:
    """Returns whatever fields could be confidently identified; missing
    keys mean "OCR didn't find this, the owner enters it manually" -- not
    an error. Front card carries name/DOB/gender/Aadhaar number; back
    typically carries the address, so both are scanned when available and
    merged."""
    front_lines = _extract_text_lines(front_image_bytes)
    back_lines = _extract_text_lines(back_image_bytes) if back_image_bytes else []
    all_lines = front_lines + back_lines

    # Temporary -- remove once the real-device name/address accuracy
    # complaint is diagnosed and confirmed fixed against real OCR text,
    # not guessed at. Printed to stdout, so visible in the backend's
    # running log.
    print(f"[ocr-debug] front_lines={front_lines!r}")
    print(f"[ocr-debug] back_lines={back_lines!r}")

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
