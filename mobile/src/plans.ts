export type Plan = {
  id: "starter" | "growth" | "pro";
  name: string;
  monthly: number;
  popular?: boolean;
  limit: string;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthly: 499,
    limit: "Up to 20 workers · 1 site",
    features: ["Attendance (app + 1 biometric device)", "Wages & wage slips", "Compliance check & score"],
  },
  {
    id: "growth",
    name: "Growth",
    monthly: 1000,
    popular: true,
    limit: "Up to 50 workers · 1 site",
    features: [
      "Everything in Starter",
      "Form 15 & Form 25 downloads",
      "Unlimited biometric devices",
      "Inspection pack (one tap)",
      "WhatsApp reminders",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 1599,
    limit: "Unlimited workers · multiple sites",
    features: [
      "Everything in Growth",
      "All statutory forms (12, 15, 25, 25-B)",
      "Multiple sites, one login",
      "Supervisor logins",
      "Priority support",
    ],
  },
];

// Yearly billing is 10 months' worth of the monthly price (2 months free),
// shown to the owner as an equivalent per-month figure.
export function yearlyTotal(monthly: number): number {
  return monthly * 10;
}

export function yearlyPerMonth(monthly: number): number {
  return Math.round(yearlyTotal(monthly) / 12);
}
