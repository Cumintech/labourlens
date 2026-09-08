// API client for the Labour Lens admin portal -- talks to the same
// FastAPI backend the mobile app uses, but only ever hits /admin/*
// routes with the admin's own Bearer token (see auth.tsx). Deliberately
// a plain set of functions, not a generated client -- there are only a
// handful of endpoints.

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8010";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type AdminTokenResponse = { access_token: string; token_type: string };

export function adminLogin(email: string, password: string): Promise<AdminTokenResponse> {
  return request<AdminTokenResponse>("/admin/login", null, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export type FactoryStatus = "trial" | "active" | "payment_overdue" | "suspended" | "churned";

export type Factory = {
  id: number;
  owner_id: number;
  name: string;
  owner_name: string;
  owner_contact: string;
  status: FactoryStatus;
  plan_tier: string | null;
  enrolled_at: string;
  notes: string | null;
  active_employee_count: number;
};

export type FactoryPayment = {
  id: number;
  factory_id: number;
  amount: number;
  due_date: string;
  paid_date: string | null;
  status: "paid" | "pending" | "overdue";
  is_overdue: boolean;
};

export type EmployeeSnapshot = {
  month: string;
  active_employee_count: number;
  is_current_month: boolean;
};

export type FactoryDetail = {
  factory: Factory;
  payments: FactoryPayment[];
  employee_trend: EmployeeSnapshot[];
};

export type AdminDashboard = {
  total_factories: number;
  counts_by_status: Record<string, number>;
  total_active_employees: number;
};

export function listFactories(token: string, status?: string): Promise<Factory[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<Factory[]>(`/admin/factories${qs}`, token);
}

export function getFactoryDetail(token: string, id: number): Promise<FactoryDetail> {
  return request<FactoryDetail>(`/admin/factories/${id}`, token);
}

export function updateFactory(
  token: string,
  id: number,
  input: { status?: FactoryStatus; plan_tier?: string | null; notes?: string | null },
): Promise<Factory> {
  return request<Factory>(`/admin/factories/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getDashboard(token: string): Promise<AdminDashboard> {
  return request<AdminDashboard>("/admin/dashboard", token);
}

export type FactoryPaymentInput = {
  amount: number;
  due_date: string;
  paid_date?: string | null;
  status: "paid" | "pending" | "overdue";
};

export function createFactoryPayment(token: string, factoryId: number, input: FactoryPaymentInput): Promise<FactoryPayment> {
  return request<FactoryPayment>(`/admin/factories/${factoryId}/payments`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFactoryPayment(
  token: string,
  factoryId: number,
  paymentId: number,
  input: FactoryPaymentInput,
): Promise<FactoryPayment> {
  return request<FactoryPayment>(`/admin/factories/${factoryId}/payments/${paymentId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
