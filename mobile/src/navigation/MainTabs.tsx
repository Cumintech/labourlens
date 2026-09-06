import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import { Text } from "react-native";
import HomeScreen from "../screens/HomeScreen";
import SettingsScreen from "../screens/SettingsScreen";
import StatutoryFormsScreen from "../screens/StatutoryFormsScreen";
import WageCalculationScreen from "../screens/WageCalculationScreen";
import { colors } from "../theme";

const Tab = createBottomTabNavigator();

// Mounted as the root stack's "Home" screen -- Dashboard, WorkerEdit,
// NewWorkerScan, and every other drill-down screen stay registered on
// the outer stack (RootNavigator.tsx) untouched, so pushing into any of
// them from a tab correctly overlays the tab bar (standard nested
// tabs-inside-a-stack behavior), and every existing `navigation.navigate`
// call elsewhere in the app keeps working exactly as it did before this
// was added -- React Navigation resolves an unrecognized route name by
// walking up to the parent stack automatically.
export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.fieldBg },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: "Home", tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🏠</Text> }}
      />
      <Tab.Screen
        name="FormsTab"
        component={StatutoryFormsScreen}
        options={{ title: "Forms & Reports", tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🗂️</Text> }}
      />
      <Tab.Screen
        name="WageCalculationTab"
        component={WageCalculationScreen}
        options={{ title: "Wage Calc", tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>💰</Text> }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{ title: "Settings", tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>⚙️</Text> }}
      />
    </Tab.Navigator>
  );
}
