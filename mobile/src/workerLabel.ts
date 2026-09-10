import { Worker } from "./api/client";

// One shared "how do we identify a worker on screen" rule, used
// everywhere a worker is picked from a dropdown or shown in a list row
// (Forms & Reports, Wage Rate, Dashboard, Attendance Range, Device
// Mapping, ...) -- name alone is never enough once two workers share a
// first name, so every one of those screens disambiguates the same way.
export function workerLabel(worker: Pick<Worker, "name" | "numeric_employee_code" | "status">): string {
  const code = worker.numeric_employee_code ? `#${worker.numeric_employee_code}` : "no code yet";
  const deactivated = worker.status === "active" ? "" : " (Deactivated)";
  return `${worker.name} (${code})${deactivated}`;
}
