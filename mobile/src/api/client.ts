// API client for the Labour Lens backend.
//
// API_BASE_URL must point at your machine's LAN IP, not localhost --
// Expo Go runs on a physical phone (or a separate simulator), which
// can't resolve "localhost" as this computer. Find your IP with
// `ipconfig` (Windows) and set it in .env as EXPO_PUBLIC_API_URL, e.g.
// EXPO_PUBLIC_API_URL=http://192.168.1.23:8010 -- see mobile/README.md.

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8010";

export type Owner = {
  id: number;
  name: string;
  mobile: string;
  factory_name: string;
};

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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? `Request failed: ${res.status}`);
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
): Promise<AuthResponse> {
  return request<AuthResponse>("/owners/signup", {
    method: "POST",
    body: JSON.stringify({ name, mobile, password, factory_name: factoryName }),
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
  created_at: string;
};

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
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? `OCR failed: ${res.status}`);
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

export function deactivateWorker(token: string, workerId: number): Promise<Worker> {
  return request<Worker>(`/workers/${workerId}/deactivate`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type AttendanceSlot = "AM" | "PM" | "Evening";
export type AttendanceStatus = "present" | "absent";

export type Attendance = {
  id: number;
  worker_id: number;
  date: string;
  slot: AttendanceSlot;
  status: AttendanceStatus;
  marked_at: string;
};

export function markAttendance(
  token: string,
  workerId: number,
  date: string,
  slot: AttendanceSlot,
  status: AttendanceStatus,
): Promise<Attendance> {
  return request<Attendance>("/attendance", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ worker_id: workerId, date, slot, status }),
  });
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

export type ReportFormat = "excel" | "pdf";

export function emailReport(
  token: string,
  startDate: string,
  endDate: string,
  recipientEmail: string,
  format: ReportFormat,
): Promise<{ status: string }> {
  return request<{ status: string }>("/reports/attendance/email", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      start_date: startDate,
      end_date: endDate,
      recipient_email: recipientEmail,
      format,
    }),
  });
}

export { ApiError };
