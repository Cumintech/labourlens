// Shared formatting helpers -- currency and date display, used by every
// screen so numbers and dates never drift into a second, slightly
// different format somewhere else in the app.

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseIsoLocal(iso: string): Date {
  // Built from local Y/M/D components, not `new Date(iso)` -- the latter
  // parses a bare "YYYY-MM-DD" string as UTC midnight, which can roll
  // over to the previous/next calendar day once rendered in a
  // UTC+5:30 (or any non-zero offset) local time. Every ISO date in this
  // app is already a local calendar date (see DateField's isoDate()), so
  // round-tripping through local Date components is the correct inverse.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// "1 Oct 2026"
export function formatDateShort(iso: string): string {
  const d = parseIsoLocal(iso);
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

// "Thu, 1 Oct 2026"
export function formatDateWithWeekday(iso: string): string {
  const d = parseIsoLocal(iso);
  return `${WEEKDAY_SHORT[d.getDay()]}, ${d.getDate()} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

// "Thursday, 1 October" -- no year, for the Today hero's large date line.
export function formatDateLongNoYear(iso: string): string {
  const d = parseIsoLocal(iso);
  return `${WEEKDAY_LONG[d.getDay()]}, ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`;
}

// "Oct 2026"
export function formatMonthYear(month: number, year: number): string {
  return `${MONTH_ABBR[month - 1]} ${year}`;
}

export function monthName(month: number): string {
  return MONTH_LONG[month - 1];
}

// Indian digit grouping (lakh/crore -- groups of 2 after the first 3
// digits from the right), done by hand rather than via
// Intl.NumberFormat("en-IN"): React Native's JS engine doesn't reliably
// ship full ICU locale data on every platform/build, and a silently
// wrong grouping on real money is worse than a few lines of manual
// digit-grouping that behaves the same everywhere.
function groupIndian(intDigits: string): string {
  if (intDigits.length <= 3) return intDigits;
  const last3 = intDigits.slice(-3);
  const rest = intDigits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

// ₹ with en-IN thousands separators, and no ".00" on a whole-rupee
// amount (".50" still shows when the amount actually has paise).
export function formatINR(amount: number): string {
  const negative = amount < 0;
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const fixed = rounded.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const grouped = groupIndian(intPart);
  const value = decPart === "00" ? grouped : `${grouped}.${decPart}`;
  return `${negative ? "-" : ""}₹${value}`;
}

// Plain integer with en-IN grouping, no currency symbol or decimals --
// counts (worker counts, day counts), never money.
export function formatCount(n: number): string {
  const negative = n < 0;
  return `${negative ? "-" : ""}${groupIndian(String(Math.round(Math.abs(n))))}`;
}
