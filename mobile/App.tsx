import { StatusBar } from "expo-status-bar";
import React from "react";
import { AppLockProvider, useAppLock } from "./src/context/AppLockContext";
import { AuthProvider } from "./src/context/AuthContext";
import RootNavigator from "./src/navigation/RootNavigator";
import AppLockScreen from "./src/screens/AppLockScreen";

// Locked state fully replaces RootNavigator rather than being an
// overlay on top of it -- no chance of a screen underneath leaking
// content (e.g. a list still visible behind a translucent lock sheet).
function Gate() {
  const { isLocked, loading } = useAppLock();
  if (loading) return null;
  return isLocked ? <AppLockScreen /> : <RootNavigator />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppLockProvider>
        <Gate />
        <StatusBar style="auto" />
      </AppLockProvider>
    </AuthProvider>
  );
}
