import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight, Fingerprint, ListChecks, Search, ShieldAlert, UserPlus, Users } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Attendance, HomeAlert, LeaveEntry, Worker, getHomeAlerts, listAttendance, listLeaveForDate, listWorkers, listWorkersMissingCompliance } from "../api/client";
import { isoDate } from "../components/DateField";
import { ListSkeleton } from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import WorkerHeroArt from "../components/WorkerHeroArt";
import { Avatar, BlueHeader, Chip, EmptyState, ListRow, StatusChip } from "../components/ui";
import type { WorkerStatus } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing, type } from "../theme";

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

type Filter = "all" | "missing" | "no_wage" | "inactive" | "underage" | "unmapped";

const WORKER_ALERT_CODES = ["missing_compliance", "underage_workers", "unmapped_devices"];

// Matches the backend's MINIMUM_WORKING_AGE (main.py) and WorkerProfileScreen's own age helper.
const MINIMUM_WORKING_AGE = 14;
function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const monthDiff = today.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

const ALERT_ICON: Record<string, typeof ListChecks> = {
  missing_compliance: ListChecks,
  unmapped_devices: Fingerprint,
  underage_workers: ShieldAlert,
};

// The list view Phase 1's tab bar needs to exist at all -- there was no
// "every worker in one place" screen before this (Dashboard only ever
// showed today's attendance rows). Pulled forward from the redesign's
// Phase 3 spec since the bottom tab bar can't be built without it.
export default function WorkersScreen({ navigation }: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<Attendance[]>([]);
  const [todayLeave, setTodayLeave] = useState<LeaveEntry[]>([]);
  const [missingComplianceIds, setMissingComplianceIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [workerAlerts, setWorkerAlerts] = useState<HomeAlert[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    const today = isoDate(new Date());
    const [w, a, l, missing] = await Promise.all([
      listWorkers(token),
      listAttendance(token, today),
      listLeaveForDate(token, today),
      listWorkersMissingCompliance(token),
    ]);
    setWorkers(w);
    setTodayAttendance(a);
    setTodayLeave(l);
    setMissingComplianceIds(new Set(missing.map((m) => m.id)));
    // Worker-related notices from the same feed as Today's "Needs attention"
    // (read-only; a failure just hides the card).
    getHomeAlerts(token)
      .then((r) => setWorkerAlerts(r.alerts.filter((x) => WORKER_ALERT_CODES.includes(x.code) && x.count > 0)))
      .catch(() => setWorkerAlerts([]));
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .then(() => setLoadError(false))
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  function statusFor(worker: Worker): WorkerStatus {
    if (worker.status !== "active") return "inactive";
    if (todayLeave.some((l) => l.worker_id === worker.id)) return "leave";
    const rows = todayAttendance.filter((a) => a.worker_id === worker.id);
    if (rows.some((r) => r.status === "present")) return "present";
    if (rows.some((r) => r.status === "absent")) return "absent";
    return "unmarked";
  }

  const activeCount = workers.filter((w) => w.status === "active").length;
  const inactiveCount = workers.length - activeCount;
  const noWageCount = workers.filter((w) => w.status === "active" && !w.worker_type_id).length;
  const missingCount = workers.filter((w) => missingComplianceIds.has(w.id)).length;

  const underageWorkers = useMemo(
    () => workers.filter((w) => w.status === "active" && w.dob && (ageFromDob(w.dob) as number) < MINIMUM_WORKING_AGE),
    [workers],
  );
  const unmappedWorkers = useMemo(
    () => workers.filter((w) => w.status === "active" && !w.device_user_id),
    [workers],
  );

  function workersForAlertCode(code: string): Worker[] {
    if (code === "missing_compliance") return workers.filter((w) => missingComplianceIds.has(w.id));
    if (code === "underage_workers") return underageWorkers;
    if (code === "unmapped_devices") return unmappedWorkers;
    return [];
  }

  function handleAlertPress(alert: HomeAlert) {
    const matches = workersForAlertCode(alert.code);
    if (matches.length === 1) {
      const w = matches[0];
      if (alert.code === "unmapped_devices") {
        navigation.navigate("BiometricDevices");
      } else {
        navigation.navigate("WorkerEdit", { workerId: w.id, workerName: w.name, workerStatus: w.status, deactivatedAt: w.deactivated_at });
      }
      return;
    }
    if (matches.length > 1) {
      if (alert.code === "missing_compliance") setFilter("missing");
      else if (alert.code === "underage_workers") setFilter("underage");
      else if (alert.code === "unmapped_devices") setFilter("unmapped");
    }
  }

  const filtered = useMemo(() => {
    let list = workers;
    if (filter === "missing") list = list.filter((w) => missingComplianceIds.has(w.id));
    else if (filter === "no_wage") list = list.filter((w) => w.status === "active" && !w.worker_type_id);
    else if (filter === "inactive") list = list.filter((w) => w.status !== "active");
    else if (filter === "underage") list = underageWorkers;
    else if (filter === "unmapped") list = unmappedWorkers;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          (w.numeric_employee_code ?? "").toLowerCase().includes(q) ||
          (w.mobile ?? "").includes(q),
      );
    }
    return list;
  }, [workers, filter, search, missingComplianceIds, underageWorkers, unmappedWorkers]);

  function openWorker(worker: Worker) {
    navigation.navigate("WorkerProfile", {
      workerId: worker.id,
      workerName: worker.name,
      workerStatus: worker.status,
      deactivatedAt: worker.deactivated_at,
    });
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={5} variant="simple" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.heroArt} pointerEvents="none">
          <WorkerHeroArt width={124} height={116} hat="orange" />
        </View>
        <Text style={styles.heroTitle} accessibilityRole="header">Workers</Text>
        <Text style={styles.heroSubtitle}>{activeCount} active · {inactiveCount} inactive</Text>
        <Text style={styles.heroTagline}>Every worker. Every record. Every compliance detail. One place.</Text>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <Search size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, code or mobile"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(w) => String(w.id)}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {([
                ["all", "All", workers.length],
                ["missing", "Details missing", missingCount],
                ["no_wage", "No wage rate", noWageCount],
                ["inactive", "Inactive", inactiveCount],
              ] as [Filter, string, number][]).map(([key, label, count]) => {
                const selected = filter === key;
                return (
                  <Pressable
                    key={key}
                    style={[styles.filterChip, selected && styles.filterChipSelected]}
                    onPress={() => setFilter(key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>{label}</Text>
                    <View style={[styles.countBadge, selected && styles.countBadgeSelected]}>
                      <Text style={[styles.countBadgeText, selected && styles.countBadgeTextSelected]}>{count}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            {workerAlerts.length > 0 && (
              <View style={styles.complianceCard}>
                <Text style={styles.complianceBannerText}>Worker compliance - attention needed</Text>
                {workerAlerts.map((al) => {
                  const Icon = ALERT_ICON[al.code] ?? ListChecks;
                  return (
                    <Pressable
                      key={al.code}
                      style={styles.complianceRow}
                      accessibilityRole="button"
                      onPress={() => handleAlertPress(al)}
                    >
                      <Icon size={18} color={colors.warningTintText} />
                      <Text style={styles.alertLine}>{al.message}</Text>
                      <ChevronRight size={16} color={colors.warning} />
                    </Pressable>
                  );
                })}
              </View>
            )}

            {(filter === "underage" || filter === "unmapped") && (
              <Pressable style={styles.dismissChip} onPress={() => setFilter("all")} accessibilityRole="button">
                <Text style={styles.dismissChipText}>
                  Showing {filtered.length} worker{filtered.length === 1 ? "" : "s"}{" "}
                  {filter === "underage" ? "under minimum age" : "not mapped to a device"}
                </Text>
                <Text style={styles.dismissChipClose}>✕</Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={Users}
            title={workers.length === 0 ? "No workers yet" : "No workers match this filter"}
            subtitle={workers.length === 0 ? "Add your first worker to get started." : undefined}
            ctaLabel={workers.length === 0 ? "Add worker" : undefined}
            onPressCta={workers.length === 0 ? () => navigation.navigate("NewWorkerScan") : undefined}
          />
        }
        renderItem={({ item, index }) => {
          const first = index === 0;
          const last = index === filtered.length - 1;
          const flags = [
            missingComplianceIds.has(item.id) ? "Details missing" : null,
            item.status === "active" && !item.worker_type_id ? "No wage rate" : null,
          ].filter(Boolean);
          return (
            <Pressable
              style={[styles.row, first && styles.rowFirst, last && styles.rowLast, !first && styles.rowDivider]}
              onPress={() => openWorker(item)}
              accessibilityRole="button"
            >
              <Avatar workerId={item.id} name={item.name} size={40} />
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  #{item.numeric_employee_code ?? "no code yet"}
                  {flags.length ? ` · ${flags.join(" · ")}` : ""}
                </Text>
              </View>
              <StatusChip status={statusFor(item)} />
              <ChevronRight size={16} color={colors.disabled} />
            </Pressable>
          );
        }}
      />

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

const styles = StyleSheet.create({
  complianceCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningTint,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 2,
  },
  complianceBannerText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.warningTintText, marginBottom: 4 },
  complianceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.warningBorder,
  },
  alertLine: { flex: 1, fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.navy },
  dismissChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
  },
  dismissChipText: { flex: 1, fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, color: colors.primary },
  dismissChipClose: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.primary },
  container: { flex: 1, backgroundColor: colors.ground },
  hero: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
  },
  heroArt: { position: "absolute", right: spacing.sm, bottom: 0 },
  heroTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 26, color: colors.surface },
  heroSubtitle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.onPrimaryMuted, marginTop: 2 },
  heroTagline: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, lineHeight: 17, color: "#FFE0B2", marginTop: spacing.sm, maxWidth: 210 },
  searchWrap: { paddingHorizontal: spacing.md, marginTop: -24 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 48,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    elevation: 4,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  searchInput: { flex: 1, fontFamily: "IBMPlexSans_500Medium", fontSize: 14, color: colors.navy, paddingVertical: 0 },
  listHeader: { paddingTop: 14, paddingBottom: 12, gap: 12 },
  chipsRow: { flexDirection: "row", gap: spacing.sm },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingLeft: 14, paddingRight: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.navy },
  filterChipTextSelected: { color: colors.surface },
  countBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryTint },
  countBadgeSelected: { backgroundColor: "rgba(255,255,255,0.22)" },
  countBadgeText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 11, color: colors.primary },
  countBadgeTextSelected: { color: colors.surface },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  rowSub: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 1 },
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
