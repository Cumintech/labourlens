"""Small shared date helpers (previously copy-pasted in main.py and ask.py)."""
from datetime import date


def age_years(dob: date, as_of: date) -> int:
    years = as_of.year - dob.year
    if (as_of.month, as_of.day) < (dob.month, dob.day):
        years -= 1
    return years
