import {
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
  useFonts,
} from "@expo-google-fonts/ibm-plex-sans";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
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
  // Signed-in app and lock screen sit on blue header bands -> light status
  // bar icons; the white Login screen needs dark icons.
  return (
    <>
      {isLocked ? <AppLockScreen /> : <RootNavigator />}
      <StatusBar style={isLocked || token ? "light" : "dark"} />
    </>
  );
}

// GestureHandlerRootView is required at the app root for
// react-native-gesture-handler v2 to work at all -- react-navigation's
// native-stack swipe-back gesture and reanimated both depend on it.
export default function App() {
  // Splash stays visible (app.json's own splash config) until this
  // resolves -- the type scale (theme.ts) is entirely IBM Plex Sans;
  // rendering any screen before it's loaded would show the system font
  // for a flash, then visibly swap.
  const [fontsLoaded] = useFonts({
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  // SafeAreaProvider at the true root -- react-native-screens' Screen
  // component gives insets to content *inside* a navigator for free in
  // some configurations, but nothing outside the navigator tree (like
  // ToastProvider, which wraps RootNavigator) ever gets a value without
  // this. Confirmed live: ToastProvider crashed with "No safe area
  // value available" before this was added -- there was no
  // SafeAreaProvider anywhere in the app until now.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <AppLockProvider>
            <ToastProvider>
              <ErrorBoundary>
                <Gate />
              </ErrorBoundary>
            </ToastProvider>
          </AppLockProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
