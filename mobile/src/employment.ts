// Worker employment classification helpers -- shared by AddWorkerScreen,
// WorkerProfileScreen, Workers/Attendance lists, and HomeScreen's
// Workforce card, so the label/colour/suggestion rules live in exactly
// one place. is_ism (inter-state migrant) is independent of
// employment_type: a permanent worker can also be ISM.
import { colors } from "./theme";

export type EmploymentType = "permanent" | "temporary" | null;
export type EmploymentWorker = { employment_type: EmploymentType; is_ism: boolean };
export type EmploymentGroup = "perm" | "con" | "ism" | null;

// permanent -> "Permanent" (the profile/list UI adds a small separate
// "ISM" tag when is_ism is also true); temporary+!is_ism -> "Contractor";
// temporary+is_ism -> "ISM"; no employment_type yet -> "Not set".
export function employmentLabel(w: EmploymentWorker): string {
  if (!w.employment_type) return "Not set";
  if (w.employment_type === "permanent") return "Permanent";
  return w.is_ism ? "ISM" : "Contractor";
}

export function isIsm(w: EmploymentWorker): boolean {
  return !!w.is_ism;
}

// Mutually-exclusive bucket for a worker's primary badge colour.
export function groupOf(w: EmploymentWorker): EmploymentGroup {
  if (!w.employment_type) return null;
  if (w.employment_type === "permanent") return "perm";
  return w.is_ism ? "ism" : "con";
}

export const EMPLOYMENT_COLORS: Record<"perm" | "con" | "ism", { fg: string; bg: string }> = {
  perm: { fg: colors.primary, bg: colors.primaryTint },
  con: { fg: colors.skyBlue, bg: colors.skyBlueLight },
  ism: { fg: colors.violet, bg: colors.violetLight },
};

// Suggests "inter-state migrant" on only when both states are known and
// genuinely differ -- never suggests a value from incomplete data.
export function suggestIsm(homeState: string | null | undefined, factoryState: string | null | undefined): boolean {
  if (!homeState || !factoryState) return false;
  return homeState.trim().toLowerCase() !== factoryState.trim().toLowerCase();
}
