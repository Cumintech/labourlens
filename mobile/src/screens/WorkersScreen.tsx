import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  ApiError,
  Attendance,
  LeaveEntry,
  Worker,
  getWageProfile,
  listAttendance,
  listLeaveForDate,
  listWorkers,
  listWorkersMissingCompliance,
} from "../api/client";
import Avatar from "../components/Avatar";
import Button from "../components/Button";
import ErrorState from "../components/ErrorState";
import FilterChip from "../components/FilterChip";
import Icon from "../components/Icon";
import { ListCardRow } from "../components/ListCard";
import ScreenHeader from "../components/ScreenHeader";
import { ListSkeleton } from "../components/Skeleton";
import StatusPill, { PillStatus } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { isoDate } from "../components/DateField";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, font, radius, spacing } from "../theme";

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

type FilterKey = "all" | "missing_details" | "no_wage_rate" | "inactive";

function todayString() {
  return isoDate(new Date());
}

// Browse/search/manage every worker ever registered -- splits out of
// what used to be one combined Workers+Attendance screen (DashboardScreen)
// so "who do I have and what's missing on their record" and "mark today's
// shifts" are two separate, purpose-built screens instead of one
// overloaded list.
export default function WorkersScreen({ navigation }: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const today = useMemo(todayString, []);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [missingComplianceIds, setMissingComplianceIds] = useState<Set<number>>(new Set());
  const [noWageRateIds, setNoWageRateIds] = useState<Set<number>>(new Set());
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, missing, a, l] = await Promise.all([
      listWorkers(token),
      listWorkersMissingCompliance(token),
      listAttendance(token, today),
      listLeaveForDate(token, today),
    ]);
    setWorkers(w);
    setMissingComplianceIds(new Set(missing.map((m) => m.id)));
    setAttendance(a);
    setLeave(l);

    const activeWorkers = w.filter((worker) => worker.status === "active");
    const rateChecks = await Promise.all(
      activeWorkers.map(async (worker): Promise<[number, boolean]> => {
        try {
          await getWageProfile(token, worker.id);
          return [worker.id, false];
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return [worker.id, true];
          throw e;
        }
      }),
    );
    setNoWageRateIds(new Set(rateChecks.filter(([, missingRate]) => missingRate).map(([id]) => id)));
  }, [token, today]);

  useFocusEffect(
    useCallback(() => {
      load()
        .then(() => setLoadError(false))
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      setLoadError(false);
    } catch {
      // Keep whatever's already on screen, same as every other pull-to-refresh in this app.
    } finally {
      setRefreshing(false);
    }
  }

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

  function statusFor(worker: Worker): { status: PillStatus; label?: string } {
    if (worker.status !== "active") return { status: "deactivated" };
    if (leaveWorkerIds.has(worker.id)) return { status: "leave" };
    const rows = attendanceByWorker.get(worker.id) ?? [];
    if (rows.some((r) => r.status === "present")) return { status: "present" };
    if (rows.some((r) => r.status === "absent")) return { status: "absent" };
    return { status: "notMarked" };
  }

  const activeCount = workers.filter((w) => w.status === "active").length;
  const inactiveCount = workers.length - activeCount;
  const missingDetailsCount = missingComplianceIds.size;
  const noWageRateCount = noWageRateIds.size;

  const filtered = workers.filter((w) => {
    if (filter === "missing_details" && !missingComplianceIds.has(w.id)) return false;
    if (filter === "no_wage_rate" && !noWageRateIds.has(w.id)) return false;
    if (filter === "inactive" && w.status === "active") return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      w.name.toLowerCase().includes(q) ||
      (w.numeric_employee_code ?? "").toLowerCase().includes(q) ||
      (w.mobile ?? "").toLowerCase().includes(q)
    );
  });

  function openWorker(worker: Worker) {
    navigation.navigate("WorkerEdit", {
      workerId: worker.id,
      workerName: worker.name,
      workerStatus: worker.status,
      deactivatedAt: worker.deactivated_at,
    });
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={{ padding: spacing.md }}>
          <ListSkeleton rows={6} variant="simple" />
        </View>
      </View>
    );
  }

  if (loadError && workers.length === 0) {
    return (
      <View style={styles.container}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader
        title="Workers"
        subtitle={`${activeCount} active · ${inactiveCount} inactive`}
        right={<Button label="Add worker" variant="primary" icon={<Icon name="plus" size={16} color={colors.white} />} onPress={() => navigation.navigate("NewWorkerScan")} small />}
      />

      <View style={styles.searchRow}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search name, code or mobile"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.chipsRow}>
        <FilterChip label="All" count={workers.length} active={filter === "all"} onPress={() => setFilter("all")} />
        <FilterChip label="Details missing" count={missingDetailsCount} active={filter === "missing_details"} onPress={() => setFilter("missing_details")} />
        <FilterChip label="No wage rate" count={noWageRateCount} active={filter === "no_wage_rate"} onPress={() => setFilter("no_wage_rate")} />
        <FilterChip label="Inactive" count={inactiveCount} active={filter === "inactive"} onPress={() => setFilter("inactive")} />
      </View>

      {filtered.length === 0 ? (
        <Text style={styles.empty}>{search ? "No workers match your search." : "No workers in this filter."}</Text>
      ) : (
        <View style={styles.card}>
          {filtered.map((worker, i) => {
            const missing = missingComplianceIds.has(worker.id);
            const { status, label } = statusFor(worker);
            return (
              <View key={worker.id}>
                <ListCardRow onPress={() => openWorker(worker)}>
                  <Avatar name={worker.name} workerId={worker.id} />
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {worker.name}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {worker.numeric_employee_code ? `#${worker.numeric_employee_code}` : "no code yet"}
                      {missing ? <Text style={styles.metaWarn}> · Details missing</Text> : null}
                    </Text>
                  </View>
                  <StatusPill status={status} label={label} />
                </ListCardRow>
                {i < filtered.length - 1 && <View style={styles.divider} />}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    backgroundColor: colors.card,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm + 4,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: colors.text },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 },
  empty: { textAlign: "center", color: colors.muted, marginTop: spacing.xl, fontFamily: font.regular },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  rowText: { flex: 1, marginLeft: spacing.sm, marginRight: spacing.sm },
  name: { fontSize: 15, fontFamily: font.semiBold, color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  metaWarn: { color: colors.leave, fontFamily: font.semiBold },
  divider: { height: 1, backgroundColor: colors.divider, marginLeft: 14 + 36 + spacing.sm },
});
