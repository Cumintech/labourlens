import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { OcrFields } from "../api/client";
import { useAuth } from "../context/AuthContext";
import AttendanceRangeScreen from "../screens/AttendanceRangeScreen";
import DashboardScreen from "../screens/DashboardScreen";
import HelpSupportScreen from "../screens/HelpSupportScreen";
import LoginScreen from "../screens/LoginScreen";
import NewWorkerDetailsScreen from "../screens/NewWorkerDetailsScreen";
import NewWorkerScanScreen from "../screens/NewWorkerScanScreen";
import PrivacyPolicyScreen from "../screens/PrivacyPolicyScreen";
import ReportScreen from "../screens/ReportScreen";
import ShiftSettingsScreen from "../screens/ShiftSettingsScreen";
import StatutoryFormsScreen from "../screens/StatutoryFormsScreen";
import WageProfileScreen from "../screens/WageProfileScreen";
import WageRateWorkerDetailScreen from "../screens/WageRateWorkerDetailScreen";
import WageRateWorkersScreen from "../screens/WageRateWorkersScreen";
import WorkerAttendanceScreen from "../screens/WorkerAttendanceScreen";
import WorkerComplianceScreen from "../screens/WorkerComplianceScreen";
import WorkerEditScreen from "../screens/WorkerEditScreen";
import WorkerTypesScreen from "../screens/WorkerTypesScreen";
import { colors } from "../theme";
import MainTabs from "./MainTabs";

export type RootStackParamList = {
  Home: undefined;
  Dashboard: undefined;
  AttendanceRange: undefined;
  NewWorkerScan: undefined;
  NewWorkerDetails: { ocrFields: OcrFields };
  WorkerCompliance: { workerId: number; workerName: string; workerDob: string | null };
  WorkerAttendance: { workerId: number; workerName: string; workerStatus: string; deactivatedAt: string | null };
  WorkerEdit: { workerId: number; workerName: string; workerStatus: string; deactivatedAt: string | null };
  WageProfile: { workerId: number; workerName: string; fromRegistration?: boolean };
  WageRateWorkers: undefined;
  WageRateWorkerDetail: { workerId: number; workerName: string };
  WorkerTypes: undefined;
  ShiftSettings: undefined;
  StatutoryForms: undefined;
  Report: undefined;
  PrivacyPolicy: undefined;
  HelpSupport: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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
    return <LoginScreen />;
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
        <Stack.Screen name="Home" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Labour Attendance" }} />
        <Stack.Screen name="AttendanceRange" component={AttendanceRangeScreen} options={{ title: "Edit Multiple Days" }} />
        <Stack.Screen name="NewWorkerScan" component={NewWorkerScanScreen} options={{ title: "New Worker" }} />
        <Stack.Screen
          name="NewWorkerDetails"
          component={NewWorkerDetailsScreen}
          options={{ title: "Worker Details" }}
        />
        <Stack.Screen
          name="WorkerCompliance"
          component={WorkerComplianceScreen}
          options={{ title: "Form 12 Details" }}
        />
        <Stack.Screen name="WorkerAttendance" component={WorkerAttendanceScreen} options={{ title: "Worker" }} />
        <Stack.Screen name="WorkerEdit" component={WorkerEditScreen} options={{ title: "Edit Worker" }} />
        <Stack.Screen name="WageProfile" component={WageProfileScreen} options={{ title: "Wage Rate" }} />
        <Stack.Screen name="WageRateWorkers" component={WageRateWorkersScreen} options={{ title: "Wage Rate" }} />
        <Stack.Screen name="WageRateWorkerDetail" component={WageRateWorkerDetailScreen} options={{ title: "Wage Rate" }} />
        <Stack.Screen name="WorkerTypes" component={WorkerTypesScreen} options={{ title: "Worker Types" }} />
        <Stack.Screen name="ShiftSettings" component={ShiftSettingsScreen} options={{ title: "Shift Settings" }} />
        <Stack.Screen name="StatutoryForms" component={StatutoryFormsScreen} options={{ title: "Forms & Reports" }} />
        <Stack.Screen name="Report" component={ReportScreen} options={{ title: "Attendance Report" }} />
        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: "Privacy Policy" }} />
        <Stack.Screen name="HelpSupport" component={HelpSupportScreen} options={{ title: "Help & Support" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
