"""Reference data for the scheduled employments Labour Lens knows the minimum
wages of. Figures are copied from the notifications supplied by the owner (see
each note); every entry is append-only reference data -- a new notification adds
rows, it never edits these."""
from datetime import date

BASIC_SINCE = date(2000, 1, 1)  # the notifications carry no start date for Basic; a revision adds a row

# ---------------------------------------------------------------------------
# Rice Mills, Flour Mills or Dhall Mills (Tamil Nadu, scheduled employment 65)
# ---------------------------------------------------------------------------
RICE_DA_VERSIONS = [
    # (da per day, effective_from, valid_to, verified, source)
    (291.20, date(2025, 4, 1), date(2026, 3, 31), True, "Notification 2025-26 (supplied by owner)"),
    (292.80, date(2026, 4, 1), None, True, "2026-27 DA, confirmed by owner"),
]

# ---------------------------------------------------------------------------
# Brick and Tiles Manufacturing (Tamil Nadu)
# ---------------------------------------------------------------------------
BRICK_TILES = "tn_brick_tiles"
BRICK_DA_VERSIONS = [
    (236.60, date(2025, 4, 1), date(2026, 3, 31), True, "Notification 2025-26: variable DA Rs 236.60/day (supplied by owner)"),
]

_G1, _G2, _G3, _G4 = "Group I - Skilled", "Group II - Grade I", "Group III - Grade II", "Group IV - Staff"
_MOSAIC, _PIECE = "Mosaic Tiles Manufacturing", "Brick Manufacturing (piece rate / special)"

# (sl_no, group, name, rate_type, unit, basic, note)
BRICK_CLASSES: list[tuple[int, str, str, str, str, float, str | None]] = []


def _add(group, name, rate_type, unit, basic, note=None):
    BRICK_CLASSES.append((len(BRICK_CLASSES) + 1, group, name, rate_type, unit, basic, note))


for _name, _basic in (
    ("Blacksmiths", 6411), ("Carpenters", 6411), ("Fitters", 6501), ("Electricians", 6501), ("Mechanic", 6411),
    ("Masons", 6411), ("Operators", 6411), ("Engine Drivers", 6411), ("Welders", 6411), ("Die Makers", 6501),
):
    _add(_G1, _name, "monthly", "month", _basic)

for _name in (
    "Mould Helpers", "Press man", "Brick makers or Tile makers", "Die pullers", "Clay slicers and Transpiers",
    "Clay mixers", "Kiln loaders and un-loaders", "Burnt goods sorters and packers (including stacking)",
    "Wheel turners", "Tile trimmers", "Artificial drying fire attenders", "Kiln burners", "Security guard or watchman",
):
    _add(_G2, _name, "daily", "day", 225)

for _name in (
    "Material handling workers", "Material carriers", "Helpers", "Tile carriers", "Fuel carriers",
    "Clay transporters and carriers", "Loading, unloading helpers", "Slab cutters and slab carriers", "Clay feeders",
    "General coolies", "Slab placers", "Sweepers", "Raw tiles removers from frame", "Raw bricks and tile carriers",
    "Pallet suppliers", "Pallet collectors", "Water carriers", "Sand and cement mixers (Mosaic)",
    "Head load workers (Mosaic)", "Sand suppliers (Mosaic)", "Tile plasters (Mosaic)", "Box removers (Mosaic)",
    "Colour mixers (Mosaic)", "Chips screeners (Mosaic)", "Other workers not specified in Groups I, II and IV",
):
    _add(_G3, _name, "daily", "day", 215)

for _name, _basic in (
    ("Foreman", 7426), ("Technical Supervisor", 7064), ("Supervisor", 6689), ("Clerk", 6596), ("Accountant", 7064),
    ("Store keeper", 6689), ("Office boy", 6047), ("Maistry", 6596),
    ("Maistry with more than 12 years of service as Maistry", 6759),
):
    _add(_G4, _name, "monthly", "month", _basic)

_add(_MOSAIC, "Tile makers (Mosaic)", "daily", "day", 259)
_add(_MOSAIC, "Mixer (Mosaic)", "daily", "day", 225, "Plus a mixing allowance of Rs 32.50/day -- not part of the minimum")
_add(_MOSAIC, "Helper (Mosaic)", "daily", "day", 225)
_add(_MOSAIC, "Cement tiles pressers (Mosaic)", "daily", "day", 225)
_add(_MOSAIC, "Mould operators (Mosaic)", "daily", "day", 225)

# Piece-rate work: published per quantity, not per day, so the minimum is NOT checked automatically
# (no confirmed rule for adding DA to a piece rate). Fireman, kiln is a daily wage and is checked.
_add(_PIECE, "Chamber bricks", "piece", "1,000 bricks", 610.39)
_add(_PIECE, "Country bricks", "piece", "1,000 bricks", 457.98)
_add(_PIECE, "Transporting bricks in kiln", "piece", "1,000 bricks", 306.71)
_add(_PIECE, "Table mould bricks", "piece", "1,000 bricks", 763.74)
_add(_PIECE, "Loading and unloading from kiln", "piece", "1,000 bricks", 76.76)
_add(_PIECE, "Bringing sand to kiln spread/chamber", "piece", "unit not confirmed", 182.01, "Unit unclear in the notification as supplied -- verify")
_add(_PIECE, "Bringing firewood or coal", "piece", "ton", 155.73)
_add(_PIECE, "Fireman, kiln", "daily", "day", 243)
_add(_PIECE, "Cutting and arranging table mould bricks", "piece", "1,000 bricks", 766.39)
_add(_PIECE, "Chamber bricks (item 8c)", "piece", "1,000 bricks", 610.39, "Listed a second time in the notification as supplied -- verify")
_add(_PIECE, "Standard bricks 9 x 4.5 x 3 in, fetched within 100 feet", "piece", "1,000 bricks", 457.96, "Beyond 100 feet: by mutual agreement")

EMPLOYMENT_NAMES = {BRICK_TILES: "Brick and Tiles Manufacturing"}
