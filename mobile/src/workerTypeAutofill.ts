import { WorkerType } from "./api/client";

// Mirrors backend main.py's DEFAULT_PF_RATE_PERCENT -- EPF's statutory
// employee contribution rate, used here purely for the auto-fill
// convenience below (still an editable field afterward, same as the
// backend's own auto-created default). Keep both in sync if it changes.
export const DEFAULT_PF_RATE_PERCENT = "12";

function toNumber(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// One shared "what happens when a worker type is picked" rule, used by
// both WageProfileScreen (editing an existing worker's rate) and
// AddWorkerScreen's wage step (setting one up at creation time) -- a
// selected type pre-fills rate type + basic wage + PF rate from its
// defaults, but only into fields still blank/zero, so it never clobbers
// a custom value already typed. One place to change if the fill rule
// (or the default PF rate) ever changes, instead of two screens drifting.
export function autofillFromWorkerType(
  type: WorkerType,
  current: { basic: string; pfRate: string },
): { rateType: "daily" | "monthly"; basic: string; pfRate: string } {
  return {
    rateType: type.default_rate_type,
    basic: !current.basic.trim() || toNumber(current.basic) === 0 ? String(type.default_rate) : current.basic,
    pfRate: !current.pfRate.trim() || toNumber(current.pfRate) === 0 ? DEFAULT_PF_RATE_PERCENT : current.pfRate,
  };
}
