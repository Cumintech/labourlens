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

# --- 5. Name-guessing rejects lines with digits (real-device bug: a
# noisy OCR line with stray digits beat the actual name line) ---
assert ocr._guess_name(["S0 aG34 Trust", "SURESH PRASAD", "MALE"]) == "SURESH PRASAD", (
    "a digit-bearing noise line beat the real name -- this bug is back"
)
assert ocr._guess_name(["SURESH PRASAD", "MALE"]) == "SURESH PRASAD"
print("name-guessing digit rejection (real-device bug fix): PASSED")

# --- 6. Address extraction against a REAL card's actual OCR output
# (captured verbatim from a real-device scan's [ocr-debug] log, not
# synthesized) -- the old 6-line cap and the "WWW." stop-keyword typo
# (real cards read as "WwW", no period) both caused the real address and
# PIN code to be missed entirely; this is the exact input that exposed
# both bugs. ---
real_back_lines = [
    "@mal B6IUUL_", "Ino", "Alanemu [", "Mioln4", "4S1IJ", "Identification", "(@sou1f:", "S/O;",
    "of India", "UTOU# UJIJL6odIuJLD", "6 Cu", "Address:", "32, 2600lq WJUJUGOT", "Sio:", "3651 #bgl",
    "Balasubramaniyam K P 3/2,", "UGOLDILI  6U66OTGWITIUGULOL, QIGoofjusuQu", "ANDIYAPPAN 3RD LANE",
    "QUTGopfLGiQu_, Qesutso6u , gu@p DiG", "OLD WASHERMENPET;", "600021", "Washermanpet,",
    "Washermanpet; Chennai,", "Tamil Nadu, 600021", "3927 4012 2754", "1947", "WwW", "1800,300 1947",
    "help @ uidai:gov.in", "WWWuidai gov.in", "Unique", "Authority",
]
real_address = ocr._guess_address(real_back_lines)
assert real_address is not None, "address extraction found nothing on a real card's actual OCR text"
assert ocr.PIN_CODE_PATTERN.search(real_address), (
    f"PIN code missing from a real card's address -- the old 6-line cap bug is back: {real_address!r}"
)
assert "WASHERMENPET" in real_address.upper(), (
    f"the real English address content is missing, not just noisy: {real_address!r}"
)
assert "UIDAI" not in real_address.upper() and "HELP" not in real_address.upper(), (
    f"collection ran past the UIDAI/help boilerplate that should have stopped it: {real_address!r}"
)
print("address extraction against a real card's actual OCR text (PIN + real content captured): PASSED")

# --- 7. A SECOND real scan of the same physical card, OCR'd differently
# (the boilerplate footer read "Wwi"/"wwuldal gouin" this time, not
# "WwW"/"help @ uidai" like scan #6 above) -- proves the fix isn't
# keyword-matching-shaped luck: it has to survive the boilerplate being
# unrecognizable, by anchoring on the PIN code instead. ---
real_back_lines_2 = [
    "968 B6UUL", "60)L", "iner", "#9nga0iu | [ Aictidi na", "#S00", "Unique Identification", "of India",
    "(Borf:", "SIO:", "UT6U& UJIJLD6oIuJLD", "Cu", "Address: SIO:", "32,", "236 WJLUGOT 30151 #1g1",
    "Balasubramaniyam K P 3/2", "UGOLDi  QUGOOTGOOITIUGUL_6OL , QUIGooiuguGuL", "ANDIYAPPAN 3RD LANE",
    "QUTCOQiJLGoQu, 0860160601 , gu@0 BIC", "OLD WASHERMENPET;", "500021", "Washermanpet,",
    "Washermanpet, Chennai,", "Tamil Nadu; 600021", "3927 4012 2754", "Wwi", "1947", "wwuldal gouin",
    "J0 300 1947", "help @ uidai gov.in", "Authority",
]
real_address_2 = ocr._guess_address(real_back_lines_2)
assert real_address_2 is not None, "address extraction found nothing on the second real scan"
assert real_address_2.rstrip().endswith("600021"), (
    f"result should end right at the last PIN-bearing line, not run on into footer noise: {real_address_2!r}"
)
assert "3927 4012 2754" not in real_address_2, (
    f"the Aadhaar number (after the address) leaked in -- trimming didn't stop where it should: {real_address_2!r}"
)
assert "WASHERMENPET" in real_address_2.upper(), "real address content missing"
print("address extraction survives boilerplate OCR'd differently than the first real scan (PIN-anchored, not keyword-anchored): PASSED")

# --- 8. A THIRD real scan of the same card -- explicit real-device
# feedback: the address should start at the street name (ANDIYAPPAN),
# not the "S/O: <father's name>, <door no.>" preamble that precedes it
# on the actual card. ---
real_back_lines_3 = [
    "9681W BTUUL", "91601_UIITGR   95080)6001U /", "SiluLI", "2500j", "Identification", "(Lourj:", "SIO:",
    "of India", "UTGU#LILDSoluJLD", "6 Cu", "Address:", "3/2 ,", "G00llq WLJUGOT", "SIO:", "3ug1 #bgl",
    "Balasubramaniyam K ? 3/2,", "UGOLpI QU6M GMIJUGUL_SoL, QurGogijusurqul_", "ANDIYAPPAN 3RD LANE",
    "QUIGooiugQuL, Qesotso6o , gup DiG", "OLD WASHERMENPET;", "600021", "Washermanpet;",
    "Washermanpet, Chennai,", "Tamil Nadu, 600021", "3927 4012 2754", "WwW", "1947", "1800 300 1947",
    "help @ uidai gov.in", "WwWuidal gov.in", "Unique", "Authority",
]
real_address_3 = ocr._guess_address(real_back_lines_3)
assert real_address_3 is not None, "address extraction found nothing on the third real scan"
assert real_address_3.startswith("ANDIYAPPAN"), (
    f"address should start at the street name, not the S/O/father-name/door-number preamble: {real_address_3!r}"
)
assert "Balasubramaniyam" not in real_address_3, (
    f"the father's name (S/O preamble) leaked into the address: {real_address_3!r}"
)
assert real_address_3.rstrip().endswith("600021") and "3927 4012 2754" not in real_address_3, (
    f"trailing Aadhaar-number/footer noise leaked in: {real_address_3!r}"
)
print("address extraction starts at the real street name, skipping the S/O/father-name preamble: PASSED")

print("\nALL ASSERTIONS PASSED")
