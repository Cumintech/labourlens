import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { Owner, login as apiLogin, signup as apiSignup, setUnauthorizedHandler } from "../api/client";

const TOKEN_KEY = "labourlens_token";
const OWNER_KEY = "labourlens_owner";

// Security audit finding: the session token and owner profile were the
// only pieces of sensitive local state still in AsyncStorage (plain,
// unencrypted) instead of SecureStore (Keychain/Keystore-backed) --
// inconsistent with AppLockContext.tsx's own PIN storage, which already
// uses this exact pattern including the web fallback shim (expo-secure-store
// has no web backend; Platform.OS === "web" only happens in the web
// preview used for documentation screenshots, never a real build).
const Store = Platform.OS === "web"
  ? {
      getItemAsync: async (key: string) => localStorage.getItem(key),
      setItemAsync: async (key: string, value: string) => localStorage.setItem(key, value),
      deleteItemAsync: async (key: string) => localStorage.removeItem(key),
    }
  : SecureStore;

type AuthContextValue = {
  token: string | null;
  owner: Owner | null;
  loading: boolean;
  login: (mobile: string, password: string) => Promise<void>;
  signup: (name: string, mobile: string, password: string, factoryName: string, consentGiven: boolean) => Promise<Owner>;
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
        Store.getItemAsync(TOKEN_KEY),
        Store.getItemAsync(OWNER_KEY),
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
    await Store.setItemAsync(TOKEN_KEY, res.access_token);
    await Store.setItemAsync(OWNER_KEY, JSON.stringify(res.owner));
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
    await Store.setItemAsync(TOKEN_KEY, res.access_token);
    await Store.setItemAsync(OWNER_KEY, JSON.stringify(res.owner));
    setToken(res.access_token);
    setOwner(res.owner);
    return res.owner;
  }

  // The factory-profile screen returns the updated Owner directly from
  // the API response -- this just puts it back into the cached session
  // so the Home screen's factory name updates immediately instead of
  // needing a logout/login to pick up the change.
  async function updateOwner(updated: Owner) {
    await Store.setItemAsync(OWNER_KEY, JSON.stringify(updated));
    setOwner(updated);
  }

  async function logout() {
    await Promise.all([Store.deleteItemAsync(TOKEN_KEY), Store.deleteItemAsync(OWNER_KEY)]);
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
