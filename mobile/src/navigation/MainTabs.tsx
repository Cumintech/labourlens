import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import BottomTabBar from "../components/BottomTabBar";
import DashboardScreen from "../screens/DashboardScreen";
import HomeScreen from "../screens/HomeScreen";
import StatutoryFormsScreen from "../screens/StatutoryFormsScreen";
import WageCalculationScreen from "../screens/WageCalculationScreen";
import WorkersScreen from "../screens/WorkersScreen";

const Tab = createBottomTabNavigator();

// The app's 5 primary destinations, bottom-tabbed -- Today / Workers /
// Attendance / Wages / Reports. Mounted as the root stack's "Home" screen
// (RootNavigator.tsx); every other screen (WorkerEdit, AddWorker,
// BiometricDevices, ...) stays registered as a sibling stack screen, so
// pushing into any of them from a tab still overlays the tab bar the
// normal way, and `navigation.navigate("SomeRootRoute")` from inside a
// tab keeps resolving by walking up to the parent stack automatically.
export default function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <BottomTabBar {...props} />}>
      <Tab.Screen name="TodayTab" component={HomeScreen} options={{ title: "Today" }} />
      <Tab.Screen name="WorkersTab" component={WorkersScreen} options={{ title: "Workers" }} />
      <Tab.Screen name="AttendanceTab" component={DashboardScreen} options={{ title: "Attendance" }} />
      <Tab.Screen name="WagesTab" component={WageCalculationScreen} options={{ title: "Wages" }} />
      <Tab.Screen name="ReportsTab" component={StatutoryFormsScreen} options={{ title: "Reports" }} />
    </Tab.Navigator>
  );
}
