"""Verifies Aadhaar scanning on photos like real phone shots: a card held
sideways / upside down / EXIF-rotated, with an extra non-birth date printed on
it, must still give the right name, date of birth, gender, number and address.
Cards are rendered here with invented data; the OCR itself is real.

    python verify_ocr_orientation.py
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from PIL import Image, ImageDraw, ImageFont

import ocr

TAMIL = str(Path(__file__).parent / "fonts" / "NotoSansTamil-Regular.ttf")
latin = lambda size: ImageFont.load_default(size=size)
tamil = lambda size: ImageFont.truetype(TAMIL, size)
W, H = 1011, 638


def front_card() -> Image.Image:
    img = Image.new("RGB", (W, H), (250, 248, 240)); d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 90], fill=(255, 153, 51)); d.text((260, 25), "Government of India", font=latin(40), fill=0)
    d.rectangle([40, 150, 260, 420], fill=(180, 170, 160))
    d.text((300, 170), "கணேஷ் பிரபு", font=tamil(40), fill=0)
    d.text((300, 235), "Ganesh Prabu", font=latin(40), fill=0)
    d.text((300, 300), "DOB: 15/06/1984", font=latin(36), fill=0)
    d.text((300, 350), "ஆண் / MALE", font=tamil(36), fill=0)
    d.text((300, 500), "5555 1111 2225", font=latin(64), fill=0)
    d.text((200, 590), "Aadhaar - Aam Admi ka Adhikar", font=latin(28), fill=0)
    return img


def back_card() -> Image.Image:
    img = Image.new("RGB", (W, H), (250, 248, 240)); d = ImageDraw.Draw(img)
    d.text((40, 30), "Unique Identification Authority of India", font=latin(34), fill=0)
    d.text((40, 110), "முகவரி:", font=tamil(30), fill=0)
    d.text((40, 160), "த/பெ முத்து, 12, காந்தி தெரு, அண்ணா நகர்,", font=tamil(30), fill=0)
    d.text((40, 230), "Address:", font=latin(32), fill=0)
    d.text((40, 280), "S/O Muthu, 12, Gandhi Street,", font=latin(32), fill=0)
    d.text((40, 330), "Anna Nagar, Madurai,", font=latin(32), fill=0)
    d.text((40, 380), "Tamil Nadu - 625020", font=latin(32), fill=0)
    d.text((40, 445), "Aadhaar issued: 07/04/2017", font=latin(30), fill=0)  # a date that is NOT the birth date
    d.text((40, 520), "5555 1111 2225", font=latin(48), fill=0)
    d.text((40, 590), "VID : 9123 4567 8901 2345   www.uidai.gov.in", font=latin(26), fill=0)
    return img


def jpeg(img: Image.Image, exif_tag: int | None = None) -> bytes:
    buf = io.BytesIO()
    if exif_tag:
        ex = Image.Exif(); ex[0x0112] = exif_tag
        img.save(buf, format="JPEG", exif=ex, quality=90)
    else:
        img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


T = Image.Transpose
cases = {
    "upright": (lambda i: i, None),
    "sideways (rot90)": (lambda i: i.transpose(T.ROTATE_90), None),
    "sideways (rot270)": (lambda i: i.transpose(T.ROTATE_270), None),
    "upside down": (lambda i: i.transpose(T.ROTATE_180), None),
    "exif rotated": (lambda i: i.transpose(T.ROTATE_270), 6),
}
f, b = front_card(), back_card()
for label, (turn, tag) in cases.items():
    out = ocr.extract_fields(jpeg(turn(f), tag), jpeg(turn(b), tag))
    assert out.get("name") == "Ganesh Prabu", (label, out)
    assert out.get("dob") == "1984-06-15", (label, out)  # never the 2017 issue date
    assert out.get("gender") == "Male", (label, out)
    assert out.get("aadhaar_number") == "555511112225", (label, out)
    assert "Anna Nagar" in (out.get("current_address") or "") and "625020" in out["current_address"], (label, out)
    print(f"  {label}: PASSED")

# front and back scanned separately (as the app now does) give the same fields as one combined call
front_only = ocr.extract_fields(jpeg(f), None)
back_only = ocr.extract_fields(None, jpeg(b))
assert front_only.get("name") == "Ganesh Prabu" and front_only.get("dob") == "1984-06-15" and front_only.get("aadhaar_number") == "555511112225", front_only
assert "Anna Nagar" in (back_only.get("current_address") or "") and back_only.get("aadhaar_number") == "555511112225" and "dob" not in back_only, back_only
print("  front-only / back-only: PASSED")

# --- parsing rules, no OCR involved ---
back = ["Unique Identification Authority of India", "Aadhaar issued: 07/04/2017", "Address:", "12, Gandhi Street", "Madurai 625020", "VID: 9123 4567 8901 2345"]
# a garbled "Authority" line must not become the name; the line above DOB is the name
assert ocr._guess_name(["GOVERNMENT OF INDIA", "auther", "Ganesh Prabu", "DOB: 15/06/1984", "MALE"], 3) == "Ganesh Prabu"
assert ocr._guess_name(["auther", "Ganesh Prabu", "MALE"]) == "Ganesh Prabu"
assert ocr._tidy_name("GaneshPrabu") == "Ganesh Prabu"
# dates: labelled wins; an unlabelled date on the back (issue/print date) is never the DOB
assert ocr._guess_dob(["DOB: 15/06/1984"], back) == "1984-06-15"
assert ocr._guess_dob(["Name", "MALE"], back) is None
assert ocr._guess_dob(["Date of Birth", "12/03/1991"], []) == "1991-03-12"
assert ocr._guess_dob(["DOB: 31/02/1984"], []) is None  # not a real date
assert ocr._guess_dob(["DOB: 15/06/2018"], []) is None  # a child's/other date, not a worker's birth date
# the VID's first 12 digits must not beat the real number
assert ocr._guess_aadhaar(["VID : 9123 4567 8901 2345", "5555 1111 2225"]) == "555511112225"
print("verify_ocr_orientation: OK")
