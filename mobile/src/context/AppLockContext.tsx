import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";

const PIN_KEY = "labourlens_app_lock_pin";

type AppLockContextValue = {
  isPinSet: boolean;
  isLocked: boolean;
  loading: boolean;
  setPin: (pin: string) => Promise<void>;
  clearPin: () => Promise<void>;
  verifyPin: (pin: string) => boolean;
  tryUnlock: (pin: string) => boolean;
};

const AppLockContext = createContext<AppLockContextValue | undefined>(undefined);

// Stored in SecureStore (Keychain/Keystore-backed), not AsyncStorage --
// this is guarding access to the app itself, not just app preference
// data. Locks on cold start whenever a PIN exists, and again any time
// the app goes to background/inactive and comes back, so switching
// apps and returning doesn't leave it open.
export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [storedPin, setStoredPin] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    (async () => {
      const pin = await SecureStore.getItemAsync(PIN_KEY);
      setStoredPin(pin);
      setIsLocked(!!pin);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current === "active" && next !== "active" && storedPin) {
        setIsLocked(true);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [storedPin]);

  async function setPin(pin: string) {
    await SecureStore.setItemAsync(PIN_KEY, pin);
    setStoredPin(pin);
    setIsLocked(false);
  }

  async function clearPin() {
    await SecureStore.deleteItemAsync(PIN_KEY);
    setStoredPin(null);
    setIsLocked(false);
  }

  function verifyPin(pin: string) {
    return pin === storedPin;
  }

  function tryUnlock(pin: string) {
    const ok = verifyPin(pin);
    if (ok) setIsLocked(false);
    return ok;
  }

  return (
    <AppLockContext.Provider value={{ isPinSet: !!storedPin, isLocked, loading, setPin, clearPin, verifyPin, tryUnlock }}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used inside AppLockProvider");
  return ctx;
}
