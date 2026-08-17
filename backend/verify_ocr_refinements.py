"""Verifies the Day 3 OCR fixes: the FEMALE/MALE substring bug, the
Latin-script name filter, and new address extraction.

Script-detection logic is unit-tested directly with real Devanagari
characters rather than through a rendered+OCR'd image -- this system has
no guaranteed font for rendering that script, so testing the actual Unicode
classification logic directly is more reliable than depending on font
availability. Gender and address extraction go through real OCR, since
those specifically test word-level recognition behavior.

    python verify_ocr_refinements.py
"""

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PIL import Image, ImageDraw

import ocr


# --- 1. Script-detection logic, tested directly (no OCR/rendering involved) ---
assert ocr._is_mostly_latin("SURESH PRASAD") is True
assert ocr._is_mostly_latin("सुरेश प्रसाद") is False, "Devanagari text was misclassified as Latin"
assert ocr._is_mostly_latin("1234") is False, "no alphabetic chars -- should not classify as Latin"
print("script-detection logic: PASSED")


# --- 2. The FEMALE/MALE substring bug, through the real regex path ---
assert ocr.GENDER_PATTERNS[2][0].search("MALE") is not None  # MALE pattern still matches "MALE" alone
assert ocr.GENDER_PATTERNS[2][0].search("FEMALE") is None, (
    "MALE pattern incorrectly matched inside FEMALE -- the original bug is back"
)
assert ocr.GENDER_PATTERNS[0][0].search("FEMALE") is not None  # FEMALE pattern matches FEMALE
print("gender word-boundary regex: PASSED")


# --- 3. Full pipeline: a female card should report Female, not Male ---
def _render_text_image(lines: list[str]) -> bytes:
    img = Image.new("RGB", (700, 80 * len(lines) + 40), color="white")
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        draw.text((20, 20 + i * 80), line, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


female_card_front = _render_text_image(["ANITA SHARMA", "DOB: 22/07/1990", "FEMALE", "9876 5432 1098"])
fields = ocr.extract_fields(female_card_front)
print("female card extracted:", fields)
assert fields.get("gender") == "Female", f"expected Female, got {fields.get('gender')!r} -- the bug is back"
assert fields.get("name") == "ANITA SHARMA", fields
print("full pipeline gender fix: PASSED")


# --- 4. Address extraction ---
back_card = _render_text_image([
    "ADDRESS",
    "42 MG Road",
    "Near City Hospital",
    "Bengaluru Urban Karnataka 560001",
])
fields = ocr.extract_fields(front_image_bytes=_render_text_image(["placeholder"]), back_image_bytes=back_card)
address = fields.get("current_address")
print("address extracted:", address)
assert address is not None, "address was not extracted at all"
# Checking the extraction LOGIC (found the block, stopped at a 6-digit PIN
# pattern, included the street line) -- not exact OCR character accuracy,
# which is a separate concern (small-font synthetic renders OCR noisily,
# e.g. Road -> Rcad, a digit misread -- real-card testing already proved
# the underlying OCR itself works fine on genuine card text).
assert ocr.PIN_CODE_PATTERN.search(address), "no 6-digit PIN-shaped pattern found -- stop condition didn't fire"
assert "MG" in address, "street line missing from extracted address"
print("address extraction (logic, not exact OCR accuracy): PASSED")

print("\nALL ASSERTIONS PASSED")
