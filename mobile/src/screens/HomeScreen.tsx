import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { DashboardSummary, getDashboard, listLeaveForDate } from "../api/client";
import { isoDate } from "../components/DateField";
import HomeBackground from "../components/HomeBackground";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { trialBannerText } from "../planStatus";
import { colors, radius, spacing } from "../theme";

// Rendered as the "Home" tab's content inside MainTabs -- navigation
// here is the composite prop React Navigation hands a screen nested
// inside a tab that itself sits inside the root stack; typing it as a
// plain root-stack nav prop is enough since every call here is a bare
// `.navigate("SomeRootRoute")`, which React Navigation resolves by
// walking up to the parent stack automatically.
type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

// Home shows exactly two primary cards -- Labour Attendance (the daily
// task) and Biometric Mapping -- per explicit request to declutter a
// Home page that had 6 competing actions. Everything else that used to
// live here as a small tile (Add Worker, Wage Rate, Shifts & Profile)
// moved to the left drawer (see AppDrawer.tsx), reachable via the menu
// button below. Logout is on the Settings tab.
export default function HomeScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [leaveCount, setLeaveCount] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const today = isoDate(new Date());
    const [s, l] = await Promise.all([getDashboard(token, today), listLeaveForDate(token, today)]);
    setSummary(s);
    setLeaveCount(l.length);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  return (
    <View style={styles.container}>
      <HomeBackground industry={owner?.industry} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
      >
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => navigation.dispatch({ type: "OPEN_DRAWER" })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.menuButtonText}>☰</Text>
          </TouchableOpacity>
          <View style={styles.heroTopRowRight}>
            <Text style={styles.heroEmoji}>🏭</Text>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>FACTORY</Text>
            </View>
          </View>
        </View>
        <Text style={styles.factoryName}>{owner?.factory_name ?? "Labour Lens"}</Text>
        <Text style={styles.heroSubtitle}>Everything for today's shift floor, in one place.</Text>
        <View style={styles.heroAccentBar} />
      </View>

      {owner?.plan_status === "trial" && (
        <View style={styles.trialBanner}>
          <Text style={styles.trialBannerText}>{trialBannerText(owner)}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.bigTile, { backgroundColor: colors.tealLight }]}
        onPress={() => navigation.navigate("Dashboard")}
      >
        <Text style={styles.bigTileEmoji}>📋</Text>
        <View style={styles.tileTextWrap}>
          <Text style={[styles.bigTileTitle, { color: colors.tealDark }]}>Labour Attendance</Text>
          <Text style={styles.tileSubtitle}>
            {summary
              ? `${summary.present_today}/${summary.total_workers} present today${leaveCount ? ` · ${leaveCount} on leave` : ""}`
              : "Mark today's shifts, leave, and overtime"}
          </Text>
        </View>
        <Text style={[styles.tileArrow, { color: colors.tealDark }]}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.bigTile, { backgroundColor: colors.tealLight }]}
        onPress={() => navigation.navigate("BiometricDevices")}
      >
        <Text style={styles.bigTileEmoji}>🖐️</Text>
        <View style={styles.tileTextWrap}>
          <Text style={[styles.bigTileTitle, { color: colors.tealDark }]}>Biometric Mapping</Text>
          <Text style={styles.tileSubtitle}>Devices, sync, and worker-to-device mapping</Text>
        </View>
        <Text style={[styles.tileArrow, { color: colors.tealDark }]}>›</Text>
      </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  hero: {
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  menuButton: { padding: 4 },
  menuButtonText: { fontSize: 24, color: colors.white },
  heroTopRowRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  heroEmoji: { fontSize: 32 },
  heroBadge: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  heroBadgeText: { color: colors.tealPale, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  factoryName: { color: colors.white, fontSize: 24, fontWeight: "700", marginTop: spacing.sm },
  heroSubtitle: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 4 },
  heroAccentBar: { height: 4, backgroundColor: colors.teal, borderRadius: 2, marginTop: spacing.md, width: 56 },
  trialBanner: {
    backgroundColor: colors.amberLight,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginBottom: spacing.md,
  },
  trialBannerText: { color: colors.amberDark, fontSize: 13, fontWeight: "700", textAlign: "center" },
  bigTile: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bigTileEmoji: { fontSize: 34, marginRight: spacing.md },
  tileTextWrap: { flex: 1 },
  bigTileTitle: { fontSize: 17, fontWeight: "700" },
  tileSubtitle: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tileArrow: { fontSize: 28, fontWeight: "700", marginLeft: spacing.sm },
});
