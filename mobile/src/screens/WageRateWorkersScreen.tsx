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
    const active = w.filter((worker) => worker.status === "active");
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
        <View style={styles.headerRow}>
          <Text style={styles.title}>Wage Rate</Text>
          <TouchableOpacity style={styles.typesLink} onPress={() => navigation.navigate("WorkerTypes")}>
            <Text style={styles.typesLinkText}>Worker Types →</Text>
          </TouchableOpacity>
        </View>
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
              <Text style={styles.meta}>{type ? type.name : "No type assigned"}</Text>
              <Text style={styles.meta}>
                {rate ? `₹${rate.basic} / ${rate.rate_type === "daily" ? "day" : "month"}` : "No wage rate set"}
              </Text>
              <Text style={styles.meta}>Aadhaar •••• •••• {item.aadhaar_last4}</Text>
            </View>
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
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  typesLink: { paddingVertical: spacing.xs },
  typesLinkText: { color: colors.teal, fontSize: 13, fontWeight: "700" },
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
  meta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  arrow: { fontSize: 22, color: colors.muted },
});
