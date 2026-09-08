import React, { createContext, useContext, useState } from "react";

// Token lives in sessionStorage (cleared when the tab closes) rather
// than localStorage -- this account can see every factory's data, so
// it shouldn't persist indefinitely on a shared machine. There's only
// ever one admin account (see backend/seed_admin.py), so there's
// nothing here beyond "logged in or not."

const STORAGE_KEY = "labourlens_admin_token";

type AuthContextValue = {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY));

  function login(newToken: string) {
    sessionStorage.setItem(STORAGE_KEY, newToken);
    setToken(newToken);
  }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setToken(null);
  }

  return <AuthContext.Provider value={{ token, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
