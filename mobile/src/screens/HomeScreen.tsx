import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  ApiError,
  Attendance,
  DashboardSummary,
  LeaveEntry,
  ShiftConfig,
  Worker,
  getDashboard,
  getWageProfile,
  listAttendance,
  listLeaveForDate,
  listShiftConfigs,
  listWorkers,
  listWorkersMissingCompliance,
} from "../api/client";
import { isoDate } from "../components/DateField";
import HeroCard, { HeroCTA, HeroDivider } from "../components/HeroCard";
import Icon from "../components/Icon";
import { ListCardRow } from "../components/ListCard";
import ProgressRing from "../components/ProgressRing";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { formatDateLongNoYear } from "../format";
import { trialStatusText } from "../planStatus";
import { colors, font, radius, spacing } from "../theme";

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

function todayString() {
  return isoDate(new Date());
}

type QuickAction = { label: string; icon: React.ComponentProps<typeof Icon>["name"]; onPress: () => void };

// The Today tab -- a single-glance "where do things stand right now" plus
// the fastest path into the day's one must-do task (marking attendance).
export default function HomeScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const insets = useSafeAreaInsets();
  const today = useMemo(todayString, []);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [missingDetailsCount, setMissingDetailsCount] = useState(0);
  const [noWageRateCount, setNoWageRateCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, a, l, s, d, missing] = await Promise.all([
      listWorkers(token),
      listAttendance(token, today),
      listLeaveForDate(token, today),
      listShiftConfigs(token),
      getDashboard(token, today),
      listWorkersMissingCompliance(token),
    ]);
    setWorkers(w);
    setAttendance(a);
    setLeave(l);
    setShifts(s);
    setSummary(d);
    setMissingDetailsCount(missing.length);

    const activeWorkers = w.filter((worker) => worker.status === "active");
    const rateChecks = await Promise.all(
      activeWorkers.map(async (worker): Promise<boolean> => {
        try {
          await getWageProfile(token, worker.id);
          return false;
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return true;
          throw e;
        }
      }),
    );
    setNoWageRateCount(rateChecks.filter(Boolean).length);
  }, [token, today]);

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

  const activeWorkers = workers.filter((w) => w.status === "active");
  const total = activeWorkers.length;

  const attendanceByWorker = useMemo(() => {
    const map = new Map<number, Attendance[]>();
    for (const a of attendance) {
      const list = map.get(a.worker_id) ?? [];
      list.push(a);
      map.set(a.worker_id, list);
    }
    return map;
  }, [attendance]);
  const leaveWorkerIds = useMemo(() => new Set(leave.map((l) => l.worker_id)), [leave]);

  // Every active worker lands in exactly one bucket for today -- on
  // leave, present (marked present in at least one shift), absent
  // (marked, but never present), or pending (no record at all yet).
  // "Marked" for the ring is present+absent+leave combined, i.e. anyone
  // with SOME outcome recorded for the day.
  let presentCount = 0;
  let absentCount = 0;
  let onLeaveCount = 0;
  for (const worker of activeWorkers) {
    if (leaveWorkerIds.has(worker.id)) {
      onLeaveCount += 1;
      continue;
    }
    const rows = attendanceByWorker.get(worker.id) ?? [];
    if (rows.some((r) => r.status === "present")) presentCount += 1;
    else if (rows.some((r) => r.status === "absent")) absentCount += 1;
  }
  const markedCount = presentCount + absentCount + onLeaveCount;
  const pendingCount = Math.max(total - markedCount, 0);

  const shiftLabelByKey = useMemo(() => new Map(shifts.map((s) => [s.slot_key, s.label])), [shifts]);
  const itemsNeedingAttention = missingDetailsCount + noWageRateCount;

  const trialEnded = owner?.plan_status === "trial" && (owner.trial_days_remaining ?? 0) <= 0;
  const onTrial = owner?.plan_status === "trial";

  const quickActions: QuickAction[] = [
    { label: "Record payment", icon: "document", onPress: () => navigation.navigate("WagesTab" as never) },
    { label: "Wage slips", icon: "document", onPress: () => navigation.navigate("ReportsTab" as never) },
    { label: "Biometric devices", icon: "people", onPress: () => navigation.navigate("BiometricDevices") },
    { label: "Shift settings", icon: "gear", onPress: () => navigation.navigate("ShiftSettings") },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        <View style={styles.topRow}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Icon name="search" size={16} color={colors.white} />
            </View>
            <Text style={styles.brandName}>Labour Lens</Text>
          </View>
          <TouchableOpacity style={styles.gearButton} onPress={() => navigation.navigate("Settings")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="gear" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <HeroCard style={{ marginTop: spacing.md }}>
          <View style={styles.heroTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroDate}>{formatDateLongNoYear(today)}</Text>
              <Text style={styles.heroFactory} numberOfLines={1}>
                {owner?.factory_name ?? "Labour Lens"}
              </Text>
              <Text style={styles.heroSubtitle}>{total} active worker{total === 1 ? "" : "s"}</Text>
            </View>
            <ProgressRing progress={total > 0 ? markedCount / total : 0} label={`${markedCount}/${total}`} sublabel="marked" />
          </View>

          <HeroDivider />

          <View style={styles.shiftRow}>
            {shifts.length === 0 ? (
              <Text style={styles.shiftText}>No shifts configured yet</Text>
            ) : (
              (summary?.slots ?? []).map((slot, i) => (
                <React.Fragment key={slot.slot}>
                  {i > 0 && <View style={styles.shiftDivider} />}
                  <Text style={styles.shiftText}>
                    {shiftLabelByKey.get(slot.slot) ?? slot.slot} shift{"  "}
                    <Text style={styles.shiftTextStrong}>
                      {slot.present} / {slot.total}
                    </Text>
                  </Text>
                </React.Fragment>
              ))
            )}
          </View>

          <View style={{ marginTop: spacing.md }}>
            <HeroCTA
              label={`Mark attendance · ${pendingCount} left`}
              onPress={() => navigation.navigate("AttendanceTab" as never)}
            />
          </View>
        </HeroCard>

        <View style={styles.statsCard}>
          <StatColumn value={presentCount} label="Present" />
          <View style={styles.statDivider} />
          <StatColumn value={absentCount} label="Absent" />
          <View style={styles.statDivider} />
          <StatColumn value={onLeaveCount} label="On leave" />
          <View style={styles.statDivider} />
          <StatColumn value={pendingCount} label="Pending" />
        </View>

        {(itemsNeedingAttention > 0 || onTrial) && (
          <View style={styles.listCard}>
            {itemsNeedingAttention > 0 && (
              <View>
                <ListCardRow onPress={() => navigation.navigate("WorkersTab" as never)}>
                  <View style={[styles.dot, { backgroundColor: colors.leave }]} />
                  <Text style={styles.attentionText}>
                    {itemsNeedingAttention} item{itemsNeedingAttention === 1 ? "" : "s"} need{itemsNeedingAttention === 1 ? "s" : ""} attention
                  </Text>
                  <Icon name="chevronRight" size={16} color={colors.muted} />
                </ListCardRow>
                {onTrial && <View style={styles.rowDivider} />}
              </View>
            )}
            {onTrial && (
              <ListCardRow onPress={() => navigation.navigate("Settings")}>
                <View style={[styles.dot, { backgroundColor: trialEnded ? colors.absent : colors.primary }]} />
                <Text style={styles.attentionText}>{trialStatusText(owner)}</Text>
                <Icon name="chevronRight" size={16} color={colors.muted} />
              </ListCardRow>
            )}
          </View>
        )}

        <View style={styles.quickActionsHeader}>
          <Text style={styles.sectionLabel}>Quick actions</Text>
          <TouchableOpacity style={styles.addWorkerButton} onPress={() => navigation.navigate("NewWorkerScan")}>
            <Icon name="plus" size={14} color={colors.primary} />
            <Text style={styles.addWorkerButtonText}>Add worker</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tileGrid}>
          {quickActions.map((action) => (
            <TouchableOpacity key={action.label} style={styles.tile} onPress={action.onPress}>
              <View style={styles.tileIconWrap}>
                <Icon name={action.icon} size={18} color={colors.primary} />
              </View>
              <Text style={styles.tileLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function StatColumn({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.statColumn}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandMark: { width: 36, height: 36, borderRadius: radius.control, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  brandName: { fontSize: 18, fontFamily: font.semiBold, color: colors.text },
  gearButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },

  heroTopRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  heroDate: { color: colors.onPrimaryMuted, fontSize: 13, fontFamily: font.medium },
  heroFactory: { color: colors.white, fontSize: 22, fontFamily: font.bold, marginTop: 2 },
  heroSubtitle: { color: colors.onPrimaryMuted, fontSize: 13, fontFamily: font.regular, marginTop: 2 },

  shiftRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  shiftDivider: { width: 1, height: 16, backgroundColor: colors.heroDivider, marginHorizontal: spacing.sm },
  shiftText: { color: colors.onPrimaryMuted, fontSize: 13, fontFamily: font.regular },
  shiftTextStrong: { color: colors.white, fontFamily: font.bold },

  statsCard: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  statColumn: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, backgroundColor: colors.divider },
  statValue: { fontSize: 22, fontFamily: font.bold, color: colors.text },
  statLabel: { fontSize: 11.5, color: colors.muted, marginTop: 2, fontFamily: font.regular, textAlign: "center" },

  listCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  rowDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 14 },
  dot: { width: 9, height: 9, borderRadius: 4.5, marginRight: spacing.sm },
  attentionText: { flex: 1, fontSize: 14, fontFamily: font.semiBold, color: colors.text },

  quickActionsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionLabel: { fontSize: 12, fontFamily: font.semiBold, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  addWorkerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
  },
  addWorkerButtonText: { color: colors.primary, fontSize: 12.5, fontFamily: font.semiBold },

  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
  },
  tileIconWrap: { width: 36, height: 36, borderRadius: radius.control, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  tileLabel: { flex: 1, fontSize: 13.5, fontFamily: font.semiBold, color: colors.text },
});
