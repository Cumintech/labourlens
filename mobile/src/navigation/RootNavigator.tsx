import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import AddWorkerScreen from "../screens/AddWorkerScreen";
import AttendanceRangeScreen from "../screens/AttendanceRangeScreen";
import BiometricConsentScreen from "../screens/BiometricConsentScreen";
import BiometricDevicesScreen from "../screens/BiometricDevicesScreen";
import DeviceUserMappingScreen from "../screens/DeviceUserMappingScreen";
import UnmappedPunchesScreen from "../screens/UnmappedPunchesScreen";
import DashboardScreen from "../screens/DashboardScreen";
import HelpSupportScreen from "../screens/HelpSupportScreen";
import LoginScreen from "../screens/LoginScreen";
import PrivacyPolicyScreen from "../screens/PrivacyPolicyScreen";
import ProfileScreen from "../screens/ProfileScreen";
import ShiftSettingsScreen from "../screens/ShiftSettingsScreen";
import StatutoryFormsScreen from "../screens/StatutoryFormsScreen";
import WageProfileScreen from "../screens/WageProfileScreen";
import WageRateWorkerDetailScreen from "../screens/WageRateWorkerDetailScreen";
import WageRateWorkersScreen from "../screens/WageRateWorkersScreen";
import WorkerAttendanceScreen from "../screens/WorkerAttendanceScreen";
import WorkerEditScreen from "../screens/WorkerEditScreen";
import WorkerTypesScreen from "../screens/WorkerTypesScreen";
import { colors } from "../theme";
import AppDrawer from "./AppDrawer";

export type RootStackParamList = {
  Home: undefined;
  Dashboard: undefined;
  AttendanceRange: undefined;
  // Route name kept as "NewWorkerScan" (not renamed to "AddWorker")
  // so HomeScreen's existing navigation.navigate("NewWorkerScan") call
  // needs no change -- the component behind it is the new merged
  // AddWorkerScreen (scan + details + compliance + wage in one screen,
  // replacing the old 4-screen flow).
  NewWorkerScan: undefined;
  BiometricConsent: { workerId: number; workerName: string; fromRegistration?: boolean };
  BiometricDevices: undefined;
  DeviceUserMapping: { deviceId: number; deviceName: string };
  UnmappedPunches: undefined;
  WorkerAttendance: { workerId: number; workerName: string; workerStatus: string; deactivatedAt: string | null };
  WorkerEdit: { workerId: number; workerName: string; workerStatus: string; deactivatedAt: string | null };
  WageProfile: { workerId: number; workerName: string; fromRegistration?: boolean };
  WageRateWorkers: undefined;
  WageRateWorkerDetail: { workerId: number; workerName: string };
  WorkerTypes: undefined;
  ShiftSettings: undefined;
  Profile: undefined;
  StatutoryForms: undefined;
  PrivacyPolicy: undefined;
  HelpSupport: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Only two screens exist before login: Login itself, and the real
// Privacy Policy screen (reused as-is, not duplicated) so the DPDP
// consent checkbox on Login can link to the actual policy text instead
// of a summary baked into the login form.
export type AuthStackParamList = {
  Login: undefined;
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
            headerStyle: { backgroundColor: colors.white },
            headerTitleStyle: { color: colors.navy, fontWeight: "700" },
            headerTintColor: colors.teal,
          }}
        >
          <AuthStack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
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
          headerStyle: { backgroundColor: colors.white },
          headerTitleStyle: { color: colors.navy, fontWeight: "700" },
          headerTintColor: colors.teal,
        }}
      >
        <Stack.Screen name="Home" component={AppDrawer} options={{ headerShown: false }} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Labour Attendance" }} />
        <Stack.Screen name="AttendanceRange" component={AttendanceRangeScreen} options={{ title: "Edit Multiple Days" }} />
        <Stack.Screen name="NewWorkerScan" component={AddWorkerScreen} options={{ title: "Add Worker" }} />
        <Stack.Screen name="BiometricConsent" component={BiometricConsentScreen} options={{ title: "Biometric Consent" }} />
        <Stack.Screen name="BiometricDevices" component={BiometricDevicesScreen} options={{ title: "Biometric Devices" }} />
        <Stack.Screen name="DeviceUserMapping" component={DeviceUserMappingScreen} options={{ title: "Map Device Users" }} />
        <Stack.Screen name="UnmappedPunches" component={UnmappedPunchesScreen} options={{ title: "Unmapped Punches" }} />
        <Stack.Screen name="WorkerAttendance" component={WorkerAttendanceScreen} options={{ title: "Worker" }} />
        <Stack.Screen name="WorkerEdit" component={WorkerEditScreen} options={{ title: "Edit Worker" }} />
        <Stack.Screen name="WageProfile" component={WageProfileScreen} options={{ title: "Wage Rate" }} />
        <Stack.Screen name="WageRateWorkers" component={WageRateWorkersScreen} options={{ title: "Wage Rate" }} />
        <Stack.Screen name="WageRateWorkerDetail" component={WageRateWorkerDetailScreen} options={{ title: "Wage Rate" }} />
        <Stack.Screen name="WorkerTypes" component={WorkerTypesScreen} options={{ title: "Worker Types" }} />
        <Stack.Screen name="ShiftSettings" component={ShiftSettingsScreen} options={{ title: "Shift Settings" }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
        <Stack.Screen name="StatutoryForms" component={StatutoryFormsScreen} options={{ title: "Forms & Reports" }} />
        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: "Privacy Policy" }} />
        <Stack.Screen name="HelpSupport" component={HelpSupportScreen} options={{ title: "Help & Support" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
