import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { ChevronRight, Clock, MapPin, CreditCard, Fingerprint, FileText, Settings as SettingsIcon, Sparkles, UserPlus, Users } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Attendance,
  LeaveEntry,
  ShiftConfig,
  Worker,
  listAttendance,
  listLeaveForDate,
  listShiftConfigs,
  listWorkers,
  getComplianceCheck,
  subscribeAttendanceSynced,
} from "../api/client";
import PendingSyncBanner from "../components/PendingSyncBanner";
import { isoDate } from "../components/DateField";
import WorkerHeroArt from "../components/WorkerHeroArt";
import { IconButton, LogoMark } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { groupOf } from "../employment";
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

// Needs-attention / compliance alerts moved to the Workers tab (see
// WorkersScreen.tsx) -- Home no longer fetches or shows GET /home/alerts.
// The month-end checklist card that used to live here was removed to
// declutter Home; MonthEndScreen itself is unchanged, just no longer
// linked from here.
export default function HomeScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const insets = useSafeAreaInsets();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [compliance, setCompliance] = useState<{ score: number; toFix: number } | null>(null);

  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => isoDate(today), [today]);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, a, l, s] = await Promise.all([
      listWorkers(token),
      listAttendance(token, todayIso),
      listLeaveForDate(token, todayIso),
      listShiftConfigs(token),
    ]);
    setWorkers(w.filter((x) => x.status === "active"));
    setAttendance(a);
    // Isolated from the Promise.all above -- a failure here just hides
    // the compliance card, not the whole Today screen.
    getComplianceCheck(token)
      .then((c) => setCompliance({ score: c.score, toFix: c.items.filter((i) => !i.passed).length }))
      .catch(() => setCompliance(null));
    setLeave(l);
    setShifts(s);
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

  // Refresh Today's numbers once queued offline marks have uploaded.
  useEffect(() => subscribeAttendanceSynced(() => { load().catch(() => {}); }), [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  // ISM contractors = temporary + is_ism (permanent+ISM excluded).
  const ismContractorIds = useMemo(() => workers.filter((w) => groupOf(w) === "ism").map((w) => w.id), [workers]);

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
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.heroArt} pointerEvents="none">
            <WorkerHeroArt width={104} height={98} />
          </View>
          <View style={styles.headerTopRow}>
            <View style={styles.brandRow}>
              <LogoMark size={30} inverted />
              <View>
                <Text style={styles.brandText}>Labour Lens</Text>
                <Text style={styles.brandTagline}>Manage · Track · Empower</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <Pressable style={styles.askPill} onPress={() => navigation.navigate("Ask")} accessibilityRole="button" accessibilityLabel="Ask Labour Lens">
                <Sparkles size={14} color={colors.surface} />
                <Text style={styles.askPillText}>Ask</Text>
              </Pressable>
              <IconButton icon={SettingsIcon} color={colors.surface} accessibilityLabel="Open settings" onPress={() => navigation.navigate("Settings")} />
            </View>
          </View>
          <Text style={styles.dateText}>{formatLongDate(today)}</Text>
          <Text style={styles.factoryName}>{owner?.factory_name ?? "Labour Lens"}</Text>
          {!!owner?.factory_address && (
            <View style={styles.addressRow}>
              <MapPin size={13} color={colors.onPrimaryMuted} />
              <Text style={styles.addressText} numberOfLines={2}>{owner.factory_address}</Text>
            </View>
          )}
        </View>

        <PendingSyncBanner />
        <View style={styles.attendanceCard}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Today</Text>
            <Text style={styles.cardMeta}>{markedCount} of {stats.total} marked</Text>
          </View>

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
                  <Text style={styles.shiftTileLabel}>
                    {s.label} <Text style={styles.shiftTileValue}>{s.present}/{s.total}</Text>
                  </Text>
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

        {compliance && (
          <Pressable style={styles.complianceCard} onPress={() => navigation.navigate("ComplianceCheck")} accessibilityRole="button">
            <View style={styles.complianceRingWrap}>
              <Svg width={36} height={36} viewBox="0 0 36 36" style={{ transform: [{ rotate: "-90deg" }] }}>
                <Circle cx={18} cy={18} r={15} stroke={colors.divider} strokeWidth={4} fill="none" />
                <Circle
                  cx={18}
                  cy={18}
                  r={15}
                  stroke={compliance.score >= 90 ? colors.present : compliance.score >= 70 ? colors.primary : colors.warning}
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(2 * Math.PI * 15 * compliance.score) / 100} ${2 * Math.PI * 15}`}
                />
              </Svg>
            </View>
            <Text style={styles.complianceText}>
              Compliance {compliance.score}/100 · {compliance.toFix} to fix
            </Text>
            <ChevronRight size={18} color={colors.textSecondary} />
          </Pressable>
        )}

        <View style={styles.quickActionsWrap}>
          <View style={styles.quickActionsHeaderRow}>
            <Text style={[type.caption, styles.quickActionsLabel]}>Quick actions</Text>
          </View>
          <View style={styles.quickActionsGrid}>
            <QuickAction icon={CreditCard} label="Record payment" onPress={() => goToTab("WagesTab")} />
            <QuickAction icon={FileText} label="Wage slips" onPress={() => goToTab("ReportsTab", { formCode: "wageslip", lockForm: true })} />
            <QuickAction icon={Fingerprint} label="Biometric" onPress={() => navigation.navigate("BiometricDevices")} />
            <QuickAction icon={Clock} label="Shifts" onPress={() => navigation.navigate("ShiftSettings")} />
            <QuickAction
              icon={Users}
              label={`ISM contractors (${ismContractorIds.length})`}
              onPress={() => goToTab("WorkersTab", { filterIds: ismContractorIds, filterLabel: "ISM contractors" })}
            />
          </View>
        </View>

        {owner?.plan_status === "trial" && (
          <View style={styles.planCard}>
            <View style={styles.planIcon}>
              <Clock size={16} color={colors.primary} />
            </View>
            <Text style={styles.planText}>{trialStatusText(owner)}</Text>
            <Pressable style={styles.planButton} onPress={() => navigation.navigate("Plans")} accessibilityRole="button">
              <Text style={styles.planButtonText}>View plans</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <Pressable
        style={styles.addFab}
        onPress={() => navigation.navigate("NewWorkerScan")}
        accessibilityRole="button"
        accessibilityLabel="Add worker"
      >
        <UserPlus size={20} color={colors.surface} />
        <Text style={styles.addFabText}>Add worker</Text>
      </Pressable>
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
        <Icon size={22} color={colors.primary} />
      </View>
      <Text style={styles.quickActionLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  header: {
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
    padding: spacing.lg,
    paddingBottom: 52,
  },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  askPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  askPillText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.surface },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 18, color: colors.surface },
  brandTagline: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.onPrimaryMuted },
  // Sits above the summary card, which overlaps the header bottom by spacing.xl.
  heroArt: { position: "absolute", right: spacing.sm, bottom: 38 },
  dateText: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.onPrimaryMuted, marginTop: spacing.md },
  factoryName: { fontFamily: "IBMPlexSans_700Bold", fontSize: 26, color: colors.surface, marginTop: 2, paddingRight: 100 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, paddingRight: 100 },
  addressText: { flexShrink: 1, fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.onPrimaryMuted },
  attendanceCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    marginHorizontal: spacing.md,
    marginTop: -36,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardTitleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  cardTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 16, color: colors.navy },
  cardMeta: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.textSecondary },
  stackedBar: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: colors.divider },
  barSegment: { height: 6 },
  statRow: { flexDirection: "row" },
  statBlock: { flex: 1, alignItems: "center" },
  statValue: { fontFamily: "IBMPlexSans_700Bold", fontSize: 20, fontVariant: ["tabular-nums"] },
  statLabel: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.textSecondary },
  shiftRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  shiftTile: { flex: 1, minWidth: 100, backgroundColor: colors.ground, borderRadius: 10, paddingVertical: 6, alignItems: "center" },
  shiftTileLabel: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, color: colors.textSecondary },
  shiftTileValue: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.navy, fontVariant: ["tabular-nums"] },
  markButton: { backgroundColor: colors.action, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center" },
  markButtonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.surface },
  complianceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  complianceRingWrap: { width: 36, height: 36 },
  complianceText: { flex: 1, fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.navy },
  quickActionsWrap: { paddingHorizontal: spacing.md, marginTop: spacing.lg },
  quickActionsHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  quickActionsLabel: { color: colors.textSecondary },
  quickActionsGrid: { flexDirection: "row", gap: spacing.sm },
  quickActionTile: { flex: 1, alignItems: "center", gap: 6 },
  quickActionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.navy, textAlign: "center" },
  planCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  planIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primaryTint, alignItems: "center", justifyContent: "center" },
  planText: { flex: 1, fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, lineHeight: 17, color: colors.navy },
  planButton: { height: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.primaryTint, justifyContent: "center" },
  planButtonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.primary },
  addFab: {
    position: "absolute",
    right: spacing.md,
    bottom: 12,
    height: 52,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    elevation: 6,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  addFabText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.surface },
});
