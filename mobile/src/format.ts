// Indian digit grouping (lakhs/crores: 12,34,567) done by hand rather than
// via Intl.NumberFormat("en-IN") -- Hermes (React Native's JS engine) ships
// without full ICU locale data by default, so en-IN grouping can silently
// fall back to plain thousands grouping on-device even though it works in
// a Node/browser dev environment.
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${grouped},${last3}`;
}

// ₹ amount, en-IN grouped, no ".00" on a whole rupee amount -- paise only
// show up when the amount actually has them.
export function formatINR(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const isWhole = Number.isInteger(rounded);
  const [intPart, fracPart] = Math.abs(rounded).toFixed(isWhole ? 0 : 2).split(".");
  const sign = rounded < 0 ? "-" : "";
  return `${sign}${groupIndian(intPart)}${fracPart ? `.${fracPart}` : ""}`;
}
