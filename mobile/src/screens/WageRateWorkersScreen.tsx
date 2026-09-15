import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ApiError, WageProfile, Worker, WorkerType, getWageProfile, listWorkerTypes, listWorkers } from "../api/client";
import ErrorState from "../components/ErrorState";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { workerLabel } from "../workerLabel";

type Props = NativeStackScreenProps<RootStackParamList, "WageRateWorkers">;

// numeric_employee_code is the one stable, unique per-owner identifier
// every worker gets (auto-assigned sequentially at creation, backfilled
// for anyone registered before that existed) -- the right field to sort
// by here. It's a zero-padded string ("0001", "0012"), so this compares
// the numeric value rather than lexically (a plain string sort happens
// to agree up to 4 digits given the padding, but silently breaks once
// an owner passes 9999 workers). A worker with no code yet (shouldn't
// normally happen post-backfill, but not guaranteed) sorts last rather
// than first, since it has no stable position to claim.
function byEmployeeIdAscending(a: Worker, b: Worker): number {
  const aCode = a.numeric_employee_code ? parseInt(a.numeric_employee_code, 10) : Infinity;
  const bCode = b.numeric_employee_code ? parseInt(b.numeric_employee_code, 10) : Infinity;
  return aCode - bCode;
}

// Entry point for the Wage Rate feature (Home tile): pick a labourer,
// see their profile, set/edit their rate -- reuses the worker's
// existing record rather than asking for anything twice. Worker Type
// and Daily Wage (the effective rate -- override if set, else the
// type's default, already resolved server-side by getWageProfile's
// as_of lookup) are shown here so an owner can tell workers apart at a
// glance without opening each one.
export default function WageRateWorkersScreen({ navigation }: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workerTypes, setWorkerTypes] = useState<WorkerType[]>([]);
  const [rates, setRates] = useState<Record<number, WageProfile | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, types] = await Promise.all([listWorkers(token), listWorkerTypes(token)]);
    const active = w.filter((worker) => worker.status === "active").sort(byEmployeeIdAscending);
    setWorkers(active);
    setWorkerTypes(types);
    const rateEntries = await Promise.all(
      active.map(async (worker): Promise<[number, WageProfile | null]> => {
        try {
          return [worker.id, await getWageProfile(token, worker.id)];
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return [worker.id, null]; // no rate set yet -- not an error
          throw e;
        }
      }),
    );
    setRates(Object.fromEntries(rateEntries));
  }, [token]);

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
      // Keep whatever's already on screen -- see Dashboard's identical note.
    } finally {
      setRefreshing(false);
    }
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
    <FlatList
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
      data={workers}
      keyExtractor={(w) => String(w.id)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
      ListHeaderComponent={
        <>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Wage Rate</Text>
            <TouchableOpacity style={styles.typesLink} onPress={() => navigation.navigate("WorkerTypes")}>
              <Text style={styles.typesLinkText}>Worker Types →</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.infoNote}>
            <Text style={styles.infoNoteText}>
              If a worker's device ID isn't mapped yet, their attendance won't be clocked automatically from the fingerprint
              machine — map them from the Biometric Mapping screen.
            </Text>
          </View>
        </>
      }
      ListEmptyComponent={<Text style={styles.empty}>No active workers yet.</Text>}
      renderItem={({ item }) => {
        const type = workerTypes.find((t) => t.id === item.worker_type_id);
        const rate = rates[item.id];
        return (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate("WageRateWorkerDetail", { workerId: item.id, workerName: item.name })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{workerLabel(item)}</Text>
              <Text style={styles.meta}>
                {type ? type.name : "No type"} · {rate ? `₹${rate.basic} / ${rate.rate_type === "daily" ? "day" : "month"}` : "no rate set"}
              </Text>
            </View>
            <View style={[styles.dot, item.device_user_id ? styles.dotGreen : styles.dotAmber]} />
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  typesLink: { paddingVertical: spacing.xs },
  typesLinkText: { color: colors.teal, fontSize: 13, fontWeight: "700" },
  infoNote: { backgroundColor: colors.tealLight, borderRadius: radius.sm, padding: spacing.sm + 4, marginBottom: spacing.md },
  infoNoteText: { color: colors.tealDark, fontSize: 12, lineHeight: 17 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: spacing.sm + 4,
    marginBottom: spacing.xs,
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.navy },
  meta: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  dotGreen: { backgroundColor: colors.teal },
  dotAmber: { backgroundColor: colors.amber },
  arrow: { fontSize: 22, color: colors.muted },
});
