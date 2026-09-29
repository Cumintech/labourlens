import { Owner } from "./api/client";

// Factory.status on the backend is one of "trial" | "active" |
// "payment_overdue" | "suspended" | "churned" -- collapsed here to the
// 3 states an owner actually needs to see, shared by Settings and the
// Home trial banner so they can never disagree about what to show.
export function displayPlanStatus(status: string | undefined): "Trial" | "Paid" | "Not Active" {
  if (status === "trial") return "Trial";
  if (status === "active") return "Paid";
  return "Not Active"; // payment_overdue | suspended | churned | undefined
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "D MMM YYYY", e.g. "2 Oct 2026" -- parses the "YYYY-MM-DD" string
// directly rather than via `new Date()`, so there's no UTC/local
// timezone shift to worry about for what's just a calendar date.
function formatIsoShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_ABBR[m - 1]} ${y}`;
}

// Shared by both the Home banner and Settings' Plan row so they can
// never disagree. trial_ends_at is a fixed point in time (enrolled_at +
// TRIAL_DAYS, computed once server-side in main.py's _owner_out) --
// unlike trial_days_remaining, it doesn't move as days elapse.
export function trialStatusText(owner: Pick<Owner, "trial_days_remaining" | "trial_ends_at"> | null | undefined): string {
  if (!owner?.trial_ends_at) {
    return "Your free trial has ended -- contact us to move to a paid plan";
  }
  const ends = formatIsoShort(owner.trial_ends_at);
  const remaining = owner.trial_days_remaining ?? 0;
  if (remaining > 0) {
    return `Free trial ends on ${ends} (${remaining} day${remaining === 1 ? "" : "s"} left)`;
  }
  return `Your free trial ended on ${ends} -- contact us to move to a paid plan`;
}
