import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { OcrFields } from "../api/client";
import { useAuth } from "../context/AuthContext";
import AttendanceRangeScreen from "../screens/AttendanceRangeScreen";
import DashboardScreen from "../screens/DashboardScreen";
import HomeScreen from "../screens/HomeScreen";
import LoginScreen from "../screens/LoginScreen";
import NewWorkerDetailsScreen from "../screens/NewWorkerDetailsScreen";
import NewWorkerScanScreen from "../screens/NewWorkerScanScreen";
import ReportScreen from "../screens/ReportScreen";
import ShiftSettingsScreen from "../screens/ShiftSettingsScreen";
import StatutoryFormsScreen from "../screens/StatutoryFormsScreen";
import WageProfileScreen from "../screens/WageProfileScreen";
import WorkerComplianceScreen from "../screens/WorkerComplianceScreen";
import WorkerEditScreen from "../screens/WorkerEditScreen";
import { colors } from "../theme";

export type RootStackParamList = {
  Home: undefined;
  Dashboard: undefined;
  AttendanceRange: undefined;
  NewWorkerScan: undefined;
  NewWorkerDetails: { ocrFields: OcrFields };
  WorkerCompliance: { workerId: number; workerName: string; workerDob: string | null };
  WorkerEdit: { workerId: number; workerName: string; workerStatus: string; deactivatedAt: string | null };
  WageProfile: { workerId: number; workerName: string };
  ShiftSettings: undefined;
  StatutoryForms: undefined;
  Report: undefined;
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
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Labour Lens" }} />
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
        <Stack.Screen name="WorkerEdit" component={WorkerEditScreen} options={{ title: "Worker" }} />
        <Stack.Screen name="WageProfile" component={WageProfileScreen} options={{ title: "Wage Rate" }} />
        <Stack.Screen name="ShiftSettings" component={ShiftSettingsScreen} options={{ title: "Shift Settings" }} />
        <Stack.Screen name="StatutoryForms" component={StatutoryFormsScreen} options={{ title: "Forms & Reports" }} />
        <Stack.Screen name="Report" component={ReportScreen} options={{ title: "6-month report" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
