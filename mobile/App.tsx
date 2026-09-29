import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ErrorBoundary from "./src/components/ErrorBoundary";
import { ToastProvider } from "./src/components/ui";
import { AppLockProvider, useAppLock } from "./src/context/AppLockContext";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { useAutoBiometricSync } from "./src/hooks/useAutoBiometricSync";
import RootNavigator from "./src/navigation/RootNavigator";
import AppLockScreen from "./src/screens/AppLockScreen";

// Must run at module scope, before the component tree ever mounts --
// calling this inside a component (even in an effect) races the
// native splash's own default auto-hide-on-first-paint behavior.
SplashScreen.preventAutoHideAsync();

// Locked state fully replaces RootNavigator rather than being an
// overlay on top of it -- no chance of a screen underneath leaking
// content (e.g. a list still visible behind a translucent lock sheet).
// Auto-sync runs here (not lower in the tree) so it fires regardless of
// which screen the owner is actually on, not just while
// BiometricDevicesScreen happens to be focused -- see the hook's own
// comment for why it's app-side only, not a backend-scheduled job.
function Gate() {
  const { isLocked, loading } = useAppLock();
  const { token } = useAuth();
  useAutoBiometricSync(isLocked ? null : token);
  if (loading) return null;
  return isLocked ? <AppLockScreen /> : <RootNavigator />;
}

// GestureHandlerRootView is required at the app root for
// react-native-gesture-handler v2 to work at all -- react-navigation's
// native-stack swipe-back gesture and reanimated both depend on it.
export default function App() {
  // Splash stays visible (app.json's own splash config) until this
  // resolves -- the v2 redesign's type scale (theme.ts) is entirely
  // Plus Jakarta Sans; rendering any screen before it's loaded would
  // show the system font for a flash, then visibly swap.
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AppLockProvider>
          <ToastProvider>
            <ErrorBoundary>
              <Gate />
            </ErrorBoundary>
            <StatusBar style="auto" />
          </ToastProvider>
        </AppLockProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
