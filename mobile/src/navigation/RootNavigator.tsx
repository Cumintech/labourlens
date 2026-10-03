import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import AddWorkerScreen from "../screens/AddWorkerScreen";
import BiometricConsentScreen from "../screens/BiometricConsentScreen";
import BiometricDevicesScreen from "../screens/BiometricDevicesScreen";
import ComplianceCheckScreen from "../screens/ComplianceCheckScreen";
import PlansScreen from "../screens/PlansScreen";
import DeviceUserMappingScreen from "../screens/DeviceUserMappingScreen";
import UnmappedPunchesScreen from "../screens/UnmappedPunchesScreen";
import ForgotPasswordScreen from "../screens/ForgotPasswordScreen";
import HelpSupportScreen from "../screens/HelpSupportScreen";
import LoginScreen from "../screens/LoginScreen";
import MonthEndScreen from "../screens/MonthEndScreen";
import NeedsAttentionScreen from "../screens/NeedsAttentionScreen";
import PrivacyPolicyScreen from "../screens/PrivacyPolicyScreen";
import ProfileScreen from "../screens/ProfileScreen";
import SettingsScreen from "../screens/SettingsScreen";
import ShiftSettingsScreen from "../screens/ShiftSettingsScreen";
import WageProfileScreen from "../screens/WageProfileScreen";
import WorkerEditScreen from "../screens/WorkerEditScreen";
import WorkerProfileScreen from "../screens/WorkerProfileScreen";
import WorkerTypesScreen from "../screens/WorkerTypesScreen";
import { colors } from "../theme";
import MainTabs from "./MainTabs";

export type RootStackParamList = {
  Home: undefined;
  // Route name kept as "NewWorkerScan" (not renamed to "AddWorker")
  // so HomeScreen's existing navigation.navigate("NewWorkerScan") call
  // needs no change -- the component behind it is the new merged
  // AddWorkerScreen (scan + details + compliance + wage in one screen,
  // replacing the old 4-screen flow).
  NewWorkerScan: undefined;
  // returnTo: true means the screen that navigated here (WorkerEdit,
  // DeviceUserMapping, UnmappedPunches) is still on the stack with its
  // own state intact -- confirming just calls goBack() into it rather
  // than navigating forward to WageProfile.
  BiometricConsent: { workerId: number; workerName: string; fromRegistration?: boolean; returnTo?: boolean };
  BiometricDevices: undefined;
  DeviceUserMapping: { deviceId: number; deviceName: string };
  UnmappedPunches: undefined;
  // Replaces the old standalone WorkerAttendance destination -- one hub
  // (header + Form 12 completeness card + Overview/Attendance/Wages/
  // Documents SegmentedControl) instead of separate WorkerAttendance and
  // WageRateWorkerDetail screens. initialTab lets a caller (e.g. Wage
  // Rate's worker list) land directly on a specific tab.
  WorkerProfile: {
    workerId: number;
    workerName: string;
    workerStatus: string;
    deactivatedAt: string | null;
    initialTab?: "overview" | "attendance" | "wages" | "documents";
  };
  WorkerEdit: { workerId: number; workerName: string; workerStatus: string; deactivatedAt: string | null };
  WageProfile: { workerId: number; workerName: string; fromRegistration?: boolean };
  // Always the current calendar month -- see MonthEndScreen.tsx.
  MonthEnd: undefined;
  NeedsAttention: undefined;
  ComplianceCheck: undefined;
  Plans: undefined;
  WorkerTypes: undefined;
  ShiftSettings: undefined;
  Profile: undefined;
  PrivacyPolicy: undefined;
  HelpSupport: undefined;
  // No longer a tab -- reached via the gear IconButton in Today's
  // header (see HomeScreen.tsx). Its own layout is still the pre-v2
  // one until Phase 7; only *where it's reached from* changed here.
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Only two screens exist before login: Login itself, and the real
// Privacy Policy screen (reused as-is, not duplicated) so the DPDP
// consent checkbox on Login can link to the actual policy text instead
// of a summary baked into the login form.
export type AuthStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
  PrivacyPolicy: undefined;
};
const AuthStack = createNativeStackNavigator<AuthStackParamList>();

export default function RootNavigator() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) {
    return (
      <NavigationContainer>
        <AuthStack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerTitleStyle: { color: colors.navy, fontFamily: "IBMPlexSans_700Bold", fontSize: 17 },
            headerTintColor: colors.primary,
          }}
        >
          <AuthStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: "Reset Password" }} />
          <AuthStack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: "Privacy Policy" }} />
        </AuthStack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTitleStyle: { color: colors.surface, fontFamily: "IBMPlexSans_700Bold", fontSize: 18 },
          headerTintColor: colors.surface,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.ground },
        }}
      >
        <Stack.Screen name="Home" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
        <Stack.Screen name="NewWorkerScan" component={AddWorkerScreen} options={{ title: "Add Worker" }} />
        <Stack.Screen name="BiometricConsent" component={BiometricConsentScreen} options={{ title: "Biometric Consent" }} />
        <Stack.Screen name="BiometricDevices" component={BiometricDevicesScreen} options={{ title: "Biometric Devices" }} />
        <Stack.Screen name="DeviceUserMapping" component={DeviceUserMappingScreen} options={{ title: "Map Device Users" }} />
        <Stack.Screen name="UnmappedPunches" component={UnmappedPunchesScreen} options={{ title: "Unmapped Punches" }} />
        <Stack.Screen name="WorkerProfile" component={WorkerProfileScreen} options={{ title: "Worker" }} />
        {/* headerShown: false -- both screens draw their own full-width blue
            header band in-body (avatar/progress, hero rate card); the
            default native header would otherwise double up a second blue
            bar above it. */}
        <Stack.Screen name="WorkerEdit" component={WorkerEditScreen} options={{ headerShown: false }} />
        <Stack.Screen name="WageProfile" component={WageProfileScreen} options={{ headerShown: false }} />
        <Stack.Screen name="MonthEnd" component={MonthEndScreen} options={{ title: "Month-End Checklist" }} />
        <Stack.Screen name="NeedsAttention" component={NeedsAttentionScreen} options={{ title: "Needs Attention" }} />
        <Stack.Screen name="ComplianceCheck" component={ComplianceCheckScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Plans" component={PlansScreen} options={{ headerShown: false }} />
        <Stack.Screen name="WorkerTypes" component={WorkerTypesScreen} options={{ title: "Worker Types" }} />
        <Stack.Screen name="ShiftSettings" component={ShiftSettingsScreen} options={{ title: "Shift Settings" }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: "Privacy Policy" }} />
        <Stack.Screen name="HelpSupport" component={HelpSupportScreen} options={{ title: "Help & Support" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
