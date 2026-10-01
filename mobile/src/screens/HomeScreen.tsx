import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { ChevronRight, Clock, CreditCard, Fingerprint, FileText, Settings as SettingsIcon, UserPlus, Users } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Attendance,
  HomeAlert,
  LeaveEntry,
  ShiftConfig,
  Worker,
  getHomeAlerts,
  listAttendance,
  listLeaveForDate,
  listShiftConfigs,
  listWorkers,
} from "../api/client";
import { isoDate } from "../components/DateField";
import { ExtendedFab, IconButton, LogoMark } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { trialStatusText } from "../planStatus";
import { colors, radius, spacing, type } from "../theme";

// Rendered as the "Today" tab's content inside MainTabs -- navigation
// here is the composite prop React Navigation hands a screen nested
// inside a tab that itself sits inside the root stack; typing it as a
// plain root-stack nav prop is enough since every call here is a bare
// `.navigate("SomeRootRoute")`, which React Navigation resolves by
// walking up to the parent stack automatically.
type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatLongDate(d: Date): string {
  return `${WEEKDAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

// "Needs attention" surfaces GET /home/alerts as a single summary card
// (tap -> NeedsAttentionScreen for the full list) -- the month-end
// checklist card that used to live here was removed to declutter Home;
// MonthEndScreen itself is unchanged, just no longer linked from here.
export default function HomeScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const insets = useSafeAreaInsets();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [alerts, setAlerts] = useState<HomeAlert[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => isoDate(today), [today]);

  const load = useCallback(async () => {
    if (!token) return;
    // Core data (required) and the newer home-alerts/month-end endpoints
    // (optional -- may 404 against a backend deploy that predates them)
    // are fetched separately: one failing Promise.all used to reject the
    // whole batch and leave workers/attendance stuck at their initial
    // empty state forever, which read as "0 of 0 marked" no matter how
    // many workers actually existed.
    const [w, a, l, s] = await Promise.all([
      listWorkers(token),
      listAttendance(token, todayIso),
      listLeaveForDate(token, todayIso),
      listShiftConfigs(token),
    ]);
    setWorkers(w.filter((x) => x.status === "active"));
    setAttendance(a);
    setLeave(l);
    setShifts(s);

    try {
      const homeAlerts = await getHomeAlerts(token);
      setAlerts(homeAlerts.alerts);
    } catch {
      // older backend deploy without this endpoint -- leave alerts empty
    }
  }, [token, todayIso]);

  // Switches to a sibling tab from a screen that's itself nested inside
  // that same tab navigator -- the documented React Navigation pattern
  // for this is navigating to the *parent stack's* "Home" entry with a
  // { screen } param the nested Tab.Navigator reads to pick a tab. Cast
  // to any because RootStackParamList declares "Home: undefined" (no
  // screen sub-navigation isn't expressible there without a much wider
  // typing change for one call site); this works correctly at runtime
  // regardless.
  function goToTab(tab: "WorkersTab" | "AttendanceTab" | "WagesTab" | "ReportsTab", params?: Record<string, unknown>) {
    (navigation as any).navigate("Home", { screen: tab, params });
  }

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

  const stats = useMemo(() => {
    let present = 0;
    let absent = 0;
    let onLeave = 0;
    let notMarked = 0;
    for (const w of workers) {
      if (leave.some((l) => l.worker_id === w.id)) {
        onLeave++;
        continue;
      }
      const rows = attendance.filter((a) => a.worker_id === w.id);
      if (rows.some((r) => r.status === "present")) present++;
      else if (rows.some((r) => r.status === "absent")) absent++;
      else notMarked++;
    }
    return { present, absent, onLeave, notMarked, total: workers.length };
  }, [workers, attendance, leave]);

  const shiftTiles = useMemo(
    () =>
      shifts.map((shift) => ({
        label: shift.label,
        present: attendance.filter((a) => a.slot === shift.slot_key && a.status === "present").length,
        total: workers.length,
      })),
    [shifts, attendance, workers],
  );

  const markedCount = stats.present + stats.absent + stats.onLeave;

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xl * 2 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View style={styles.brandRow}>
              <LogoMark size={28} />
              <Text style={styles.brandText}>Labour Lens</Text>
            </View>
            <IconButton icon={SettingsIcon} color={colors.surface} accessibilityLabel="Open settings" onPress={() => navigation.navigate("Settings")} />
          </View>
          <Text style={styles.dateText}>{formatLongDate(today)}</Text>
          <Text style={styles.factoryName}>{owner?.factory_name ?? "Labour Lens"}</Text>
          {owner?.plan_status === "trial" && (
            <View style={styles.trialPill}>
              <Text style={styles.trialPillText}>{trialStatusText(owner)}</Text>
            </View>
          )}
        </View>

        <View style={styles.attendanceCard}>
          <Text style={type.section}>
            Today · {markedCount} of {stats.total} marked
          </Text>

          {stats.total > 0 && (
            <View style={styles.stackedBar}>
              {stats.present > 0 && <View style={[styles.barSegment, { flex: stats.present, backgroundColor: colors.present }]} />}
              {stats.absent > 0 && <View style={[styles.barSegment, { flex: stats.absent, backgroundColor: colors.absent }]} />}
              {stats.onLeave > 0 && <View style={[styles.barSegment, { flex: stats.onLeave, backgroundColor: colors.leave }]} />}
              {stats.notMarked > 0 && <View style={[styles.barSegment, { flex: stats.notMarked, backgroundColor: colors.unmarked }]} />}
            </View>
          )}

          <View style={styles.statRow}>
            <StatBlock label="Present" value={stats.present} color={colors.present} />
            <StatBlock label="Absent" value={stats.absent} color={colors.absentTintText} />
            <StatBlock label="On leave" value={stats.onLeave} color={colors.leave} />
            <StatBlock label="Not marked" value={stats.notMarked} color={colors.unmarked} />
          </View>

          {shiftTiles.length > 0 && (
            <View style={styles.shiftRow}>
              {shiftTiles.map((s) => (
                <View key={s.label} style={styles.shiftTile}>
                  <Text style={styles.shiftTileLabel}>{s.label}</Text>
                  <Text style={styles.shiftTileValue}>{s.present} / {s.total}</Text>
                </View>
              ))}
            </View>
          )}

          <Pressable style={styles.markButton} onPress={() => goToTab("AttendanceTab")}>
            <Text style={styles.markButtonText}>
              {stats.notMarked === 0 ? "All marked ✓" : `Mark attendance · ${stats.notMarked} left`}
            </Text>
          </Pressable>
        </View>

        {alerts.length > 0 && (
          <Pressable style={styles.attentionCard} onPress={() => navigation.navigate("NeedsAttention")}>
            <View style={{ flex: 1 }}>
              <Text style={styles.attentionCardTitle}>Needs attention</Text>
              <Text style={styles.attentionCardSubtitle}>
                {alerts.length} {alerts.length === 1 ? "item needs" : "items need"} attention
              </Text>
            </View>
            <ChevronRight size={20} color={colors.textSecondary} />
          </Pressable>
        )}

        <View style={styles.quickActionsWrap}>
          <Text style={[type.caption, styles.quickActionsLabel]}>Quick actions</Text>
          <View style={styles.quickActionsGrid}>
            <QuickAction icon={CreditCard} label="Record payment" onPress={() => goToTab("WagesTab")} />
            <QuickAction icon={FileText} label="Wage slips" onPress={() => goToTab("ReportsTab", { formCode: "wageslip", lockForm: true })} />
            <QuickAction icon={Fingerprint} label="Biometric Devices" onPress={() => navigation.navigate("BiometricDevices")} />
            <QuickAction icon={Clock} label="Shift Settings" onPress={() => navigation.navigate("ShiftSettings")} />
          </View>
        </View>
      </ScrollView>

      <ExtendedFab icon={UserPlus} label="Add worker" onPress={() => navigation.navigate("NewWorkerScan")} bottomOffset={insets.bottom + spacing.xs} />
    </View>
  );
}

function StatBlock({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon: Icon, label, onPress }: { icon: typeof Users; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quickActionTile} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.quickActionIconWrap}>
        <Icon size={20} color={colors.primary} />
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  header: {
    backgroundColor: colors.navy,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    padding: spacing.lg,
    paddingBottom: spacing.xl + spacing.md,
  },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  brandText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 15, color: colors.surface },
  dateText: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: spacing.md },
  factoryName: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 26, color: colors.surface, marginTop: 2 },
  trialPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
    marginTop: spacing.sm,
  },
  trialPillText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 11, color: colors.surface },
  attendanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: -spacing.xl,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  stackedBar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", marginTop: spacing.sm, backgroundColor: colors.divider },
  barSegment: { height: 8 },
  statRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  statBlock: { flex: 1, alignItems: "center" },
  statValue: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 20, fontVariant: ["tabular-nums"] },
  statLabel: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  shiftRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md, flexWrap: "wrap" },
  shiftTile: { flex: 1, minWidth: 80, backgroundColor: colors.ground, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  shiftTileLabel: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 11, color: colors.textSecondary },
  shiftTileValue: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 15, color: colors.navy, marginTop: 2, fontVariant: ["tabular-nums"] },
  markButton: { marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 14, alignItems: "center" },
  markButtonText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 15, color: colors.surface },
  attentionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  attentionCardTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 14, color: colors.surface },
  attentionCardSubtitle: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  quickActionsWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  quickActionsLabel: { color: colors.textSecondary, marginBottom: spacing.sm },
  quickActionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quickActionTile: {
    width: "47%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  quickActionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  quickActionLabel: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 13, color: colors.navy },
});
