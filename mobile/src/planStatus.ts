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

export function trialBannerText(owner: Pick<Owner, "trial_days_remaining"> | null | undefined): string {
  return owner?.trial_days_remaining && owner.trial_days_remaining > 0
    ? `Free trial -- ${owner.trial_days_remaining} day${owner.trial_days_remaining === 1 ? "" : "s"} left`
    : "Your free trial has ended -- contact us to move to a paid plan";
}
