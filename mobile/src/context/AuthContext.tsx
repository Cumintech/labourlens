import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Owner, login as apiLogin, signup as apiSignup, setUnauthorizedHandler } from "../api/client";

const TOKEN_KEY = "labourlens_token";
const OWNER_KEY = "labourlens_owner";

type AuthContextValue = {
  token: string | null;
  owner: Owner | null;
  loading: boolean;
  login: (mobile: string, password: string) => Promise<void>;
  signup: (name: string, mobile: string, password: string, factoryName: string, consentGiven: boolean) => Promise<void>;
  logout: () => Promise<void>;
  updateOwner: (updated: Owner) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [storedToken, storedOwner] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(OWNER_KEY),
      ]);
      if (storedToken && storedOwner) {
        setToken(storedToken);
        setOwner(JSON.parse(storedOwner));
      }
      setLoading(false);
    })();
  }, []);

  async function login(mobile: string, password: string) {
    const res = await apiLogin(mobile, password);
    await AsyncStorage.setItem(TOKEN_KEY, res.access_token);
    await AsyncStorage.setItem(OWNER_KEY, JSON.stringify(res.owner));
    setToken(res.access_token);
    setOwner(res.owner);
  }

  // A brand new owner account -- each one is fully isolated server-side
  // by owner_id, so any number of separate factory owners can each sign
  // up and only ever see their own workers/attendance/forms. Only one
  // account is the active session on this device at a time (log out,
  // then log in as a different one to switch), same as login().
  async function signup(name: string, mobile: string, password: string, factoryName: string, consentGiven: boolean) {
    const res = await apiSignup(name, mobile, password, factoryName, consentGiven);
    await AsyncStorage.setItem(TOKEN_KEY, res.access_token);
    await AsyncStorage.setItem(OWNER_KEY, JSON.stringify(res.owner));
    setToken(res.access_token);
    setOwner(res.owner);
  }

  // The factory-profile screen returns the updated Owner directly from
  // the API response -- this just puts it back into the cached session
  // so the Home screen's factory name updates immediately instead of
  // needing a logout/login to pick up the change.
  async function updateOwner(updated: Owner) {
    await AsyncStorage.setItem(OWNER_KEY, JSON.stringify(updated));
    setOwner(updated);
  }

  async function logout() {
    await AsyncStorage.multiRemove([TOKEN_KEY, OWNER_KEY]);
    setToken(null);
    setOwner(null);
  }

  // Registered once so client.ts (plain functions, not a hook) can force
  // a logout the instant any request comes back 401 -- a stale or
  // no-longer-valid stored session should drop back to the Login screen
  // immediately, not fail every screen silently forever.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, owner, loading, login, signup, logout, updateOwner }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
