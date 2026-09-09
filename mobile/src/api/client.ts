// API client for the Labour Lens backend.
//
// API_BASE_URL must point at your machine's LAN IP, not localhost --
// Expo Go runs on a physical phone (or a separate simulator), which
// can't resolve "localhost" as this computer. Find your IP with
// `ipconfig` (Windows) and set it in .env as EXPO_PUBLIC_API_URL, e.g.
// EXPO_PUBLIC_API_URL=http://192.168.1.23:8010 -- see mobile/README.md.

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8010";

export type Owner = {
  id: number;
  name: string;
  mobile: string;
  factory_name: string;
  factory_address: string | null;
  factory_licence_no: string | null;
  // "trial" | "active" | "payment_overdue" | "suspended" | "churned" --
  // informational only, never blocks anything in this app.
  plan_status: string;
  trial_days_remaining: number | null;
};

export function updateFactoryProfile(
  token: string,
  factoryName: string | undefined,
  factoryAddress: string | undefined,
  factoryLicenceNo: string | undefined,
): Promise<Owner> {
  return request<Owner>("/owners/me/factory-profile", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ factory_name: factoryName, factory_address: factoryAddress, factory_licence_no: factoryLicenceNo }),
  });
}

export type AuthResponse = {
  access_token: string;
  token_type: string;
  owner: Owner;
};

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// AuthContext registers itself here on mount so this module (plain
// functions, not a hook) can force a logout the moment any request
// comes back 401 -- without this, a stale/invalid stored session just
// makes every screen fail silently with a generic error forever, since
// nothing else here ever re-checks whether the token is still good.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function throwForErrorResponse(res: Response, fallbackPrefix: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    unauthorizedHandler?.();
  }
  throw new ApiError(res.status, body.detail ?? `${fallbackPrefix}: ${res.status}`);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    await throwForErrorResponse(res, "Request failed");
  }
  return res.json();
}

export function login(mobile: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/owners/login", {
    method: "POST",
    body: JSON.stringify({ mobile, password }),
  });
}

export function signup(
  name: string,
  mobile: string,
  password: string,
  factoryName: string,
  consentGiven: boolean,
): Promise<AuthResponse> {
  return request<AuthResponse>("/owners/signup", {
    method: "POST",
    body: JSON.stringify({ name, mobile, password, factory_name: factoryName, consent_given: consentGiven }),
  });
}

export function getMe(token: string): Promise<Owner> {
  return request<Owner>("/owners/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type OcrFields = {
  name: string | null;
  dob: string | null; // YYYY-MM-DD
  gender: string | null;
  aadhaar_number: string | null;
  current_address: string | null;
};

export type Worker = {
  id: number;
  owner_id: number;
  name: string;
  mobile: string | null;
  dob: string | null;
  gender: string | null;
  aadhaar_last4: string;
  status: string;
  deactivated_at: string | null;
  deactivated_reason: string | null;
  worker_type_id: number | null;
  numeric_employee_code: string | null;
  created_at: string;
};

export type WorkerType = {
  id: number;
  name: string;
  default_rate_type: "daily" | "monthly";
  default_rate: number;
};

export function listWorkerTypes(token: string): Promise<WorkerType[]> {
  return request<WorkerType[]>("/worker-types", { headers: { Authorization: `Bearer ${token}` } });
}

export function createWorkerType(token: string, input: { name: string; default_rate_type: "daily" | "monthly"; default_rate: number }): Promise<WorkerType> {
  return request<WorkerType>("/worker-types", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function updateWorkerType(
  token: string,
  id: number,
  input: { name: string; default_rate_type: "daily" | "monthly"; default_rate: number },
): Promise<WorkerType> {
  return request<WorkerType>(`/worker-types/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export async function deleteWorkerType(token: string, id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/worker-types/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await throwForErrorResponse(res, "Request failed");
}

export function assignWorkerType(token: string, workerId: number, workerTypeId: number | null): Promise<Worker> {
  return request<Worker>(`/workers/${workerId}/worker-type`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ worker_type_id: workerTypeId }),
  });
}

export type WorkerCreateInput = {
  name: string;
  mobile?: string;
  dob?: string;
  gender?: string;
  aadhaar_number: string;
  current_address?: string;
  current_district?: string;
  native_address?: string;
  native_district?: string;
};

// Multipart upload -- not JSON, so this bypasses the request() helper
// above (which always sends Content-Type: application/json).
export async function scanAadhaar(
  token: string,
  frontUri: string,
  backUri: string | null,
): Promise<OcrFields> {
  const formData = new FormData();
  formData.append("front_image", {
    uri: frontUri,
    name: "front.jpg",
    type: "image/jpeg",
  } as any);
  if (backUri) {
    formData.append("back_image", {
      uri: backUri,
      name: "back.jpg",
      type: "image/jpeg",
    } as any);
  }

  const res = await fetch(`${API_BASE_URL}/workers/ocr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    await throwForErrorResponse(res, "OCR failed");
  }
  return res.json();
}

export function createWorker(token: string, input: WorkerCreateInput): Promise<Worker> {
  return request<Worker>("/workers", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function listWorkers(token: string): Promise<Worker[]> {
  return request<Worker[]>("/workers", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getWorker(token: string, workerId: number): Promise<Worker> {
  return request<Worker>(`/workers/${workerId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function deactivateWorker(token: string, workerId: number): Promise<Worker> {
  return request<Worker>(`/workers/${workerId}/deactivate`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Shifts are owner-configurable (Phase 3 Day 1) -- slot is whatever
// slot_key the owner's ShiftConfig defines, no longer a fixed literal.
export type AttendanceSlot = string;
export type AttendanceStatus = "present" | "absent" | "leave";

export type Attendance = {
  id: number;
  worker_id: number;
  date: string;
  slot: AttendanceSlot;
  status: AttendanceStatus;
  overtime_hours: number;
  marked_at: string;
  // "manual" | "biometric" | null (rows from before this existed)
  source: string | null;
  source_detail: string | null;
};

export function markAttendance(
  token: string,
  workerId: number,
  date: string,
  slot: AttendanceSlot,
  status: AttendanceStatus,
  overtimeHours: number = 0,
): Promise<Attendance> {
  return request<Attendance>("/attendance", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ worker_id: workerId, date, slot, status, overtime_hours: overtimeHours }),
  });
}

export type ShiftConfig = {
  id: number;
  slot_key: string;
  label: string;
  start_time: string | null;
  end_time: string | null;
  rest_interval: string | null;
  sort_order: number;
};

export function listShiftConfigs(token: string): Promise<ShiftConfig[]> {
  return request<ShiftConfig[]>("/shift-configs", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createShiftConfig(
  token: string,
  slotKey: string,
  label: string,
  startTime?: string,
  endTime?: string,
  restInterval?: string,
): Promise<ShiftConfig> {
  return request<ShiftConfig>("/shift-configs", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ slot_key: slotKey, label, start_time: startTime, end_time: endTime, rest_interval: restInterval }),
  });
}

export function updateShiftConfig(
  token: string,
  id: number,
  slotKey: string,
  label: string,
  startTime?: string,
  endTime?: string,
  restInterval?: string,
): Promise<ShiftConfig> {
  return request<ShiftConfig>(`/shift-configs/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ slot_key: slotKey, label, start_time: startTime, end_time: endTime, rest_interval: restInterval }),
  });
}

export async function deleteShiftConfig(token: string, id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/shift-configs/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    await throwForErrorResponse(res, "Request failed");
  }
}

export function listAttendance(token: string, date: string): Promise<Attendance[]> {
  return request<Attendance[]>(`/attendance?date=${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type SlotSummary = { slot: AttendanceSlot; present: number; total: number };

export type DashboardSummary = {
  date: string;
  total_workers: number;
  present_today: number;
  slots: SlotSummary[];
};

export function getDashboard(token: string, date: string): Promise<DashboardSummary> {
  return request<DashboardSummary>(`/dashboard?date=${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// PDF only -- Excel support was removed from this report.
export function emailReport(
  token: string,
  startDate: string,
  endDate: string,
  recipientEmail: string,
): Promise<{ status: string }> {
  return request<{ status: string }>("/reports/attendance/email", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      start_date: startDate,
      end_date: endDate,
      recipient_email: recipientEmail,
    }),
  });
}

export function getReportDownloadUrl(startDate: string, endDate: string): string {
  return `${API_BASE_URL}/reports/attendance?start_date=${startDate}&end_date=${endDate}`;
}

export type WorkerComplianceInput = {
  worker_code?: string;
  father_or_spouse_name?: string;
  designation_or_nature_of_work?: string;
  epf_uan_no?: string;
  esic_no?: string;
  fitness_cert_no?: string;
  fitness_cert_valid_till?: string;
  date_of_joining?: string;
  date_made_permanent?: string;
  suspension_period?: string;
};

export type WorkerCompliance = {
  id: number;
  worker_id: number;
  worker_code: string | null;
  father_or_spouse_name: string | null;
  designation_or_nature_of_work: string | null;
  epf_uan_no: string | null;
  esic_no: string | null;
  category: "adult" | "young_person";
  fitness_cert_no: string | null;
  fitness_cert_valid_till: string | null;
  date_of_joining: string | null;
  date_made_permanent: string | null;
  suspension_period: string | null;
  registered_at: string;
  under_minimum_age_warning: boolean;
};

export function createWorkerCompliance(
  token: string,
  workerId: number,
  input: WorkerComplianceInput,
): Promise<WorkerCompliance> {
  return request<WorkerCompliance>(`/workers/${workerId}/compliance`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function getWorkerCompliance(token: string, workerId: number): Promise<WorkerCompliance> {
  return request<WorkerCompliance>(`/workers/${workerId}/compliance`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function updateWorkerCompliance(
  token: string,
  workerId: number,
  input: WorkerComplianceInput,
): Promise<WorkerCompliance> {
  return request<WorkerCompliance>(`/workers/${workerId}/compliance`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function listWorkersMissingCompliance(token: string): Promise<Worker[]> {
  return request<Worker[]>("/workers/missing-compliance", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type WageRateType = "daily" | "monthly";

export type WageProfileInput = {
  rate_type: WageRateType;
  basic: number;
  hra?: number;
  da?: number;
  other_allowances?: number;
  pf_rate?: number;
  esi_rate?: number;
  lwf_amount?: number;
  effective_from: string;
};

export type WageProfile = {
  id: number;
  worker_id: number;
  rate_type: WageRateType;
  basic: number;
  hra: number;
  da: number;
  other_allowances: number;
  pf_rate: number;
  esi_rate: number;
  lwf_amount: number;
  effective_from: string;
  created_at: string;
};

// Append-only -- there is deliberately no "update" function here. A rate
// correction is always a new POST with a new effective_from, never an
// edit of an existing row (see PHASE3_STATUTORY_FORMS_PLAN.md's Day 2
// section for why).
export function createWageProfile(token: string, workerId: number, input: WageProfileInput): Promise<WageProfile> {
  return request<WageProfile>(`/workers/${workerId}/wage-profile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

// The one currently-effective rate (as_of defaults to today server-side)
// -- a worker's own latest WageProfile row if they have one, which
// already reflects their WorkerType's default the moment it was
// assigned (see WorkerTypesScreen), so there's no separate override-vs-
// default merge needed here. Throws a 404 ApiError when nothing has
// ever been set for this worker.
export function getWageProfile(token: string, workerId: number, asOf?: string): Promise<WageProfile> {
  const qs = asOf ? `?as_of=${asOf}` : "";
  return request<WageProfile>(`/workers/${workerId}/wage-profile${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getWageProfileHistory(token: string, workerId: number): Promise<WageProfile[]> {
  return request<WageProfile[]>(`/workers/${workerId}/wage-profile/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type LeaveType = "earned" | "national_festival_special" | "other";

export type LeaveEntryInput = {
  leave_type: LeaveType;
  date_from: string;
  date_to: string;
  days: number;
  wages_paid?: number;
};

export type LeaveEntry = {
  id: number;
  worker_id: number;
  leave_type: LeaveType;
  date_from: string;
  date_to: string;
  days: number;
  wages_paid: number | null;
  created_at: string;
};

export function createLeaveEntry(token: string, workerId: number, input: LeaveEntryInput): Promise<LeaveEntry> {
  return request<LeaveEntry>(`/workers/${workerId}/leave`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}


export function listLeaveForDate(token: string, date: string): Promise<LeaveEntry[]> {
  return request<LeaveEntry[]>(`/leave?date=${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function listWorkerLeaveRange(token: string, workerId: number, startDate: string, endDate: string): Promise<LeaveEntry[]> {
  return request<LeaveEntry[]>(`/workers/${workerId}/leave?start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function listWorkerAttendanceMonth(token: string, workerId: number, month: number, year: number): Promise<Attendance[]> {
  return request<Attendance[]>(`/workers/${workerId}/attendance-month?month=${month}&year=${year}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function deleteLeaveEntry(token: string, leaveId: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/leave/${leaveId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    await throwForErrorResponse(res, "Request failed");
  }
}

export type WagePaymentInput = {
  month: number;
  year: number;
  date_of_payment?: string;
  payment_reference?: string;
};

export type WagePayment = {
  id: number;
  worker_id: number;
  month: number;
  year: number;
  date_of_payment: string | null;
  payment_reference: string | null;
  created_at: string;
};

export function recordWagePayment(token: string, workerId: number, input: WagePaymentInput): Promise<WagePayment> {
  return request<WagePayment>(`/workers/${workerId}/wage-payment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export type WorkerWage = {
  worker_id: number;
  worker_name: string;
  has_rate: boolean;
  days_worked: number;
  days_absent: number;
  gross_wage: number;
  net_wage: number;
  paid: boolean;
  rate_amount: number;
  rate_type: string;
  basic_wage: number;
  da: number;
  hra: number;
  other_allowances: number;
  ot_wages: number;
  leave_wages: number;
  pf: number;
  pf_rate: number;
  pf_base: number;
  esi: number;
  esi_rate: number;
  esi_base: number;
  lwf: number;
  total_deductions: number;
};

export type WageSummary = {
  period_label: string;
  total_workers: number;
  total_gross: number;
  total_net: number;
  workers: WorkerWage[];
};

export function getWorkerWageComputation(token: string, workerId: number, month: number, year: number): Promise<WorkerWage> {
  return request<WorkerWage>(`/workers/${workerId}/wage-computation?month=${month}&year=${year}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getWageSummary(token: string, month: number, year: number): Promise<WageSummary> {
  return request<WageSummary>(`/wage-summary?month=${month}&year=${year}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type DailyWorkerWage = {
  worker_id: number;
  worker_name: string;
  has_rate: boolean;
  present: boolean;
  daily_cost: number;
};

export type DailyWageSummary = {
  date: string;
  total_workers_present: number;
  total_daily_cost: number;
  workers: DailyWorkerWage[];
};

export function getDailyWageSummary(token: string, date: string): Promise<DailyWageSummary> {
  return request<DailyWageSummary>(`/wage-summary/daily?date=${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type FormCode = "attendance" | "form25" | "form25b" | "form12" | "form15" | "wageslip";

// Generic download picker (any employee, any form) -- backs
// StatutoryFormsScreen, which also folds the Attendance Report in as
// just another Form Type rather than a separate screen. Form 25,
// Form 15, and the Attendance Report are factory-wide (no worker_id);
// Form 12 is a running register of every worker but can optionally be
// narrowed to one worker's own row via /forms/form12/{worker_id}; Form
// 25-B and Wage Slip are always per-worker. Every period-scoped form
// takes a real start/end date range, not a single month -- the backend
// generates one complete statutory section per calendar month the
// range touches, combined into one PDF (see backend/forms.py). Form 12
// carries no period at all. PDF only -- Excel export was removed from
// every form per explicit request.
export function getFormDownloadUrl(
  formCode: FormCode,
  params: { workerId?: number; startDate?: string; endDate?: string },
): string {
  if (formCode === "attendance") {
    return getReportDownloadUrl(params.startDate!, params.endDate!);
  }
  if (formCode === "form12") {
    return params.workerId
      ? `${API_BASE_URL}/forms/form12/${params.workerId}`
      : `${API_BASE_URL}/forms/form12`;
  }

  const qs = new URLSearchParams();
  if (params.startDate) qs.set("start_date", params.startDate);
  if (params.endDate) qs.set("end_date", params.endDate);
  if ((formCode === "form25b" || formCode === "wageslip") && params.workerId) {
    qs.set("worker_id", String(params.workerId));
  }
  return `${API_BASE_URL}/forms/${formCode}?${qs.toString()}`;
}

export function emailForm(
  token: string,
  formCode: FormCode,
  input: { worker_id?: number; startDate?: string; endDate?: string; recipient_email: string },
): Promise<{ status: string }> {
  if (formCode === "attendance") {
    return emailReport(token, input.startDate!, input.endDate!, input.recipient_email);
  }
  return request<{ status: string }>(`/forms/${formCode}/email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      worker_id: input.worker_id,
      start_date: formCode === "form12" ? undefined : input.startDate,
      end_date: formCode === "form12" ? undefined : input.endDate,
      recipient_email: input.recipient_email,
    }),
  });
}

// --- Biometric attendance sync (see backend/biometric.py) ---

export type BiometricDevice = {
  id: number;
  name: string;
  ip_address: string;
  port: number;
  force_udp: boolean;
  status: "active" | "inactive";
  last_sync_status: string | null;
  last_synced_at: string | null;
  is_stale: boolean;
};

export function listBiometricDevices(token: string): Promise<BiometricDevice[]> {
  return request<BiometricDevice[]>("/biometric/devices", { headers: { Authorization: `Bearer ${token}` } });
}

export function createBiometricDevice(
  token: string,
  input: { name: string; ip_address: string; port?: number; force_udp?: boolean; comm_password?: string },
): Promise<BiometricDevice> {
  return request<BiometricDevice>("/biometric/devices", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function updateBiometricDevice(
  token: string,
  deviceId: number,
  input: Partial<{ name: string; ip_address: string; port: number; force_udp: boolean; comm_password: string; status: "active" | "inactive" }>,
): Promise<BiometricDevice> {
  return request<BiometricDevice>(`/biometric/devices/${deviceId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export type SyncResult = {
  device_id: number;
  status: string;
  new_punches: number;
  duplicate_punches: number;
  unmapped_punches: number;
  error: string | null;
};

export function triggerBiometricSync(token: string, deviceId: number): Promise<SyncResult> {
  return request<SyncResult>(`/biometric/devices/${deviceId}/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type DeviceUserMapping = {
  id: number;
  device_id: number;
  device_user_id: string;
  worker_id: number;
  worker_name: string;
  worker_employee_code: string | null;
  enrolled_at: string;
};

export function listDeviceMappings(token: string, deviceId?: number): Promise<DeviceUserMapping[]> {
  const qs = deviceId ? `?device_id=${deviceId}` : "";
  return request<DeviceUserMapping[]>(`/biometric/device-mappings${qs}`, { headers: { Authorization: `Bearer ${token}` } });
}

export function createDeviceMapping(
  token: string,
  input: { device_id: number; device_user_id: string; worker_id: number },
): Promise<DeviceUserMapping> {
  return request<DeviceUserMapping>("/biometric/device-mappings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export async function deleteDeviceMapping(token: string, mappingId: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/biometric/device-mappings/${mappingId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await throwForErrorResponse(res, "Request failed");
}

export type UnmappedPunch = {
  id: number;
  device_id: number;
  device_name: string;
  raw_device_user_id: string;
  timestamp: string;
  punch_type: string;
};

export function listUnmappedPunches(token: string): Promise<UnmappedPunch[]> {
  return request<UnmappedPunch[]>("/biometric/unmapped-punches", { headers: { Authorization: `Bearer ${token}` } });
}

export function resolveUnmappedPunch(token: string, punchId: number, workerId: number): Promise<DeviceUserMapping> {
  return request<DeviceUserMapping>(`/biometric/unmapped-punches/${punchId}/resolve?worker_id=${workerId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type BiometricHealth = {
  devices: BiometricDevice[];
  unmapped_punch_count: number;
};

export function getBiometricHealth(token: string): Promise<BiometricHealth> {
  return request<BiometricHealth>("/biometric/health", { headers: { Authorization: `Bearer ${token}` } });
}

export type VerifyPunchResult = {
  resolved: boolean;
  worker_id: number | null;
  worker_name: string | null;
  worker_employee_code: string | null;
  timestamp: string | null;
  message: string;
};

export function verifyPunch(token: string, deviceId: number, deviceUserId: string): Promise<VerifyPunchResult> {
  return request<VerifyPunchResult>(
    `/biometric/devices/${deviceId}/verify-punch?device_user_id=${encodeURIComponent(deviceUserId)}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
}

export function getOrCreateEmployeeCode(token: string, workerId: number): Promise<{ worker_id: number; numeric_employee_code: string }> {
  return request(`/workers/${workerId}/employee-code`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type BiometricConsent = {
  worker_id: number;
  consented_at: string;
  consented_by: number;
  notice_text: string;
};

export function getBiometricConsent(token: string, workerId: number): Promise<BiometricConsent | null> {
  return request<BiometricConsent | null>(`/workers/${workerId}/biometric-consent`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function captureBiometricConsent(token: string, workerId: number, noticeText: string): Promise<BiometricConsent> {
  return request<BiometricConsent>(`/workers/${workerId}/biometric-consent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ notice_text: noticeText }),
  });
}

export { ApiError };
