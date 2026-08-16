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

export { ApiError };
