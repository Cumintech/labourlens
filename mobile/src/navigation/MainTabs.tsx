import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { CalendarCheck, FileText, IndianRupee, LayoutDashboard, LucideIcon, Users } from "lucide-react-native";
import React from "react";
import { StyleSheet, View } from "react-native";
import AttendanceScreen from "../screens/AttendanceScreen";
import HomeScreen from "../screens/HomeScreen";
import StatutoryFormsScreen from "../screens/StatutoryFormsScreen";
import WagesScreen from "../screens/WagesScreen";
import WorkersScreen from "../screens/WorkersScreen";
import { colors } from "../theme";

const Tab = createBottomTabNavigator();

function TabIcon({ Icon, color, focused }: { Icon: LucideIcon; color: string; focused: boolean }) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapFocused]}>
      <Icon size={20} color={color} />
    </View>
  );
}

// Mounted as the root stack's "Home" screen directly (the drawer that
// used to wrap this is gone -- Settings, Worker Types, Wage Rate, and
// Shifts & Profile all moved out of the drawer into either a tab, a
// tab's own section, or the Settings hub reached via Today's gear
// icon; see RootNavigator.tsx and SettingsScreen.tsx). Every other
// drill-down screen stays registered on the outer stack, so pushing
// into any of them from a tab correctly overlays the tab bar, and
// every existing navigation.navigate call elsewhere keeps working --
// React Navigation resolves an unrecognized route name by walking up
// to the parent stack automatically.
export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { borderTopColor: colors.divider, height: 60, paddingBottom: 8, paddingTop: 4 },
        tabBarLabelStyle: { fontSize: 11, fontFamily: "PlusJakartaSans_700Bold" },
      }}
    >
      <Tab.Screen
        name="TodayTab"
        component={HomeScreen}
        options={{
          title: "Today",
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={LayoutDashboard} color={color} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="WorkersTab"
        component={WorkersScreen}
        options={{
          title: "Workers",
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={Users} color={color} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="AttendanceTab"
        component={AttendanceScreen}
        options={{
          title: "Attendance",
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={CalendarCheck} color={color} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="WagesTab"
        component={WagesScreen}
        options={{
          title: "Wages",
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={IndianRupee} color={color} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="ReportsTab"
        component={StatutoryFormsScreen}
        options={{
          title: "Reports",
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={FileText} color={color} focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconWrap: { width: 40, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  iconWrapFocused: { backgroundColor: colors.primaryTint },
});
