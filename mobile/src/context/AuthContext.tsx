import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Owner, login as apiLogin } from "../api/client";

const TOKEN_KEY = "labourlens_token";
const OWNER_KEY = "labourlens_owner";

type AuthContextValue = {
  token: string | null;
  owner: Owner | null;
  loading: boolean;
  login: (mobile: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

  async function logout() {
    await AsyncStorage.multiRemove([TOKEN_KEY, OWNER_KEY]);
    setToken(null);
    setOwner(null);
  }

  return (
    <AuthContext.Provider value={{ token, owner, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
