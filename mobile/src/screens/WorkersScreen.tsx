import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Search, UserPlus, Users } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Attendance, LeaveEntry, Worker, listAttendance, listLeaveForDate, listWorkers, listWorkersMissingCompliance } from "../api/client";
import { isoDate } from "../components/DateField";
import { ListSkeleton } from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import { Chip, EmptyState, ExtendedFab, ListRow, StatusChip } from "../components/ui";
import type { WorkerStatus } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, spacing, type } from "../theme";

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

type Filter = "all" | "missing" | "no_wage" | "inactive";

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

  const filtered = useMemo(() => {
    let list = workers;
    if (filter === "missing") list = list.filter((w) => missingComplianceIds.has(w.id));
    else if (filter === "no_wage") list = list.filter((w) => w.status === "active" && !w.worker_type_id);
    else if (filter === "inactive") list = list.filter((w) => w.status !== "active");
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
  }, [workers, filter, search, missingComplianceIds]);

  function openWorker(worker: Worker) {
    navigation.navigate("WorkerAttendance", {
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
      <View style={styles.header}>
        <Text style={type.display}>Workers</Text>
        <Text style={styles.subtitle}>{activeCount} active · {inactiveCount} inactive</Text>
        <View style={styles.searchRow}>
          <Search size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, code, or mobile"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <View style={styles.chipsRow}>
          <Chip label="All" selected={filter === "all"} onPress={() => setFilter("all")} count={workers.length} />
          <Chip label="Details missing" selected={filter === "missing"} onPress={() => setFilter("missing")} count={missingCount} />
          <Chip label="No wage rate" selected={filter === "no_wage"} onPress={() => setFilter("no_wage")} count={noWageCount} />
          <Chip label="Inactive" selected={filter === "inactive"} onPress={() => setFilter("inactive")} count={inactiveCount} />
        </View>
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={workers.length === 0 ? "No workers yet" : "No workers match this filter"}
          subtitle={workers.length === 0 ? "Add your first worker to get started." : undefined}
          ctaLabel={workers.length === 0 ? "Add worker" : undefined}
          onPressCta={workers.length === 0 ? () => navigation.navigate("NewWorkerScan") : undefined}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(w) => String(w.id)}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 + insets.bottom }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={`#${item.numeric_employee_code ?? "no code yet"}${missingComplianceIds.has(item.id) ? " · Details missing" : ""}${item.status === "active" && !item.worker_type_id ? " · No wage rate" : ""}`}
              onPress={() => openWorker(item)}
              right={<StatusChip status={statusFor(item)} />}
              showChevron={false}
            />
          )}
        />
      )}

      <ExtendedFab icon={UserPlus} label="Add worker" onPress={() => navigation.navigate("NewWorkerScan")} bottomOffset={insets.bottom + spacing.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  header: { backgroundColor: colors.surface, padding: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  subtitle: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.ground,
    borderRadius: 10,
    paddingHorizontal: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, fontFamily: "PlusJakartaSans_500Medium", fontSize: 14, color: colors.navy, paddingVertical: 10 },
  chipsRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
});
