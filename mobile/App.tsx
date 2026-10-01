import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
  useFonts,
} from "@expo-google-fonts/ibm-plex-sans";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ErrorBoundary from "./src/components/ErrorBoundary";
import { AppLockProvider, useAppLock } from "./src/context/AppLockContext";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { useAutoBiometricSync } from "./src/hooks/useAutoBiometricSync";
import RootNavigator from "./src/navigation/RootNavigator";
import AppLockScreen from "./src/screens/AppLockScreen";
import { colors } from "./src/theme";

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
// react-native-gesture-handler v2 to work at all -- the Drawer
// navigator (AppDrawer.tsx) depends on it for the swipe-to-open/close
// gesture. Without it, gestures inside the drawer either don't fire or
// only work inside a small default-sized view instead of the whole
// screen, per the library's own documented requirement.
export default function App() {
  // Blocks first render until IBM Plex Sans's 4 weights are ready --
  // every screen's StyleSheet references font.regular/medium/semiBold/bold
  // (see theme.ts) unconditionally, so those names must already be
  // registered with the native font renderer before anything mounts,
  // not swapped in after an initial system-font flash.
  const [fontsLoaded] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AppLockProvider>
          <ErrorBoundary>
            <Gate />
          </ErrorBoundary>
          <StatusBar style="auto" />
        </AppLockProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
