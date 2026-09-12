import { DrawerContentComponentProps, createDrawerNavigator } from "@react-navigation/drawer";
import { CommonActions } from "@react-navigation/native";
import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme";
import MainTabs from "./MainTabs";

const Drawer = createDrawerNavigator();

// Wraps MainTabs (Home's bottom-tab content, unchanged) with a left-side
// drawer for the screens that used to sit as small tiles on the Home
// tab itself -- Wage Rate, Worker Types, and Shift Settings (which
// already combines shift config + factory profile, per an earlier
// session, so "Shift" and "Profile" in the request are the one same
// screen). Add Worker isn't named in the request's drawer list, but
// Home is only allowed 2 primary cards, so it's grouped here too under
// Master Data rather than dropped somewhere undiscoverable.
//
// These items are NOT registered as Drawer screens -- they stay exactly
// where they already are, as siblings of "Home" on the root stack
// (RootNavigator.tsx). Each drawer row just calls navigation.navigate()
// with that existing route name; React Navigation walks up from this
// nested Drawer to the parent Stack automatically to resolve it, the
// same auto-resolution MainTabs already relies on. This means adding
// the drawer requires zero changes to where any existing screen lives
// or how any other screen already navigates to them.
function DrawerContent({ navigation }: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();

  function go(route: string, params?: object) {
    navigation.dispatch(CommonActions.navigate({ name: route, params }));
    navigation.closeDrawer();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }}>
      <Text style={styles.appName}>Labour Lens</Text>

      <Text style={styles.sectionHeader}>MASTER DATA</Text>
      <DrawerItem emoji="👷" label="Add Worker" onPress={() => go("NewWorkerScan")} />
      <DrawerItem emoji="🏷️" label="Worker Types" onPress={() => go("WorkerTypes")} />

      <Text style={styles.sectionHeader}>CONFIGURATION</Text>
      <DrawerItem emoji="💰" label="Wage Rate" onPress={() => go("WageRateWorkers")} />
      <DrawerItem emoji="⚙️" label="Shifts & Profile" onPress={() => go("ShiftSettings")} />
    </ScrollView>
  );
}

function DrawerItem({ emoji, label, onPress }: { emoji: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.item} onPress={onPress}>
      <Text style={styles.itemEmoji}>{emoji}</Text>
      <Text style={styles.itemLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function AppDrawer() {
  return (
    <Drawer.Navigator
      screenOptions={{ headerShown: false, drawerStyle: { width: "78%" } }}
      drawerContent={(props) => <DrawerContent {...props} />}
    >
      <Drawer.Screen name="MainTabs" component={MainTabs} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white, paddingHorizontal: spacing.lg },
  appName: { fontSize: 20, fontWeight: "700", color: colors.navy, marginBottom: spacing.lg },
  sectionHeader: { fontSize: 11, fontWeight: "700", color: colors.muted, letterSpacing: 1, marginTop: spacing.md, marginBottom: spacing.sm },
  item: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderRadius: radius.sm, gap: spacing.sm },
  itemEmoji: { fontSize: 20, width: 28, textAlign: "center" },
  itemLabel: { fontSize: 15, fontWeight: "600", color: colors.navy },
});
