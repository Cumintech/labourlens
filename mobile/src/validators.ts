// Shared Aadhaar/mobile validation rules -- applied here for instant
// UI feedback, and mirrored exactly in backend/schemas.py (Verhoeff
// table for table, digit for digit) so the API can't be bypassed by a
// different client sending something this screen would have rejected.

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffValid(digits: string): boolean {
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][parseInt(reversed[i], 10)]];
  }
  return c === 0;
}

// Strips everything but digits, capped at maxLength -- used in an
// onChangeText handler so the field itself only ever holds digits,
// whether typed, pasted, or filled in from an OCR scan.
export function stripToDigits(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

// UIDAI never issues an Aadhaar number starting 0 or 1, and the 12th
// digit is a Verhoeff check digit over the first 11 -- both are real
// structural properties of a genuine number, not an arbitrary rule.
export function isValidAadhaar(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValid(digits);
}

// Reduces a pasted +91XXXXXXXXXX or 0XXXXXXXXXX down to the bare 10
// digits -- a real, common paste pattern, not user error, so this
// belongs in the onChangeText handler itself rather than only in
// validation (the field should show the clean number, not the prefix).
export function normalizeIndianMobile(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export function isValidIndianMobile(value: string): boolean {
  return /^[6-9]\d{9}$/.test(value);
}
