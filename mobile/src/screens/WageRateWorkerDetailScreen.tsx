import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  ApiError,
  WageProfile,
  Worker,
  WorkerCompliance,
  WorkerType,
  assignWorkerType,
  getWageProfileHistory,
  getWorker,
  getWorkerCompliance,
  listWorkerTypes,
} from "../api/client";
import ErrorState from "../components/ErrorState";
import SelectField from "../components/SelectField";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "WageRateWorkerDetail">;

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const monthDiff = today.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

// Age and every other field here come straight off the worker's
// existing record (Worker + WorkerCompliance) -- nothing is asked for
// twice, per request. This is also where a Worker Type is assigned and
// where the current wage rate is shown before handing off to the
// existing WageProfile screen to actually set/change it.
export default function WageRateWorkerDetailScreen({ route, navigation }: Props) {
  const { workerId, workerName } = route.params;
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [worker, setWorker] = useState<Worker | null>(null);
  const [compliance, setCompliance] = useState<WorkerCompliance | null>(null);
  const [wageHistory, setWageHistory] = useState<WageProfile[]>([]);
  const [workerTypes, setWorkerTypes] = useState<WorkerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, types, history] = await Promise.all([
      getWorker(token, workerId),
      listWorkerTypes(token),
      getWageProfileHistory(token, workerId),
    ]);
    setWorker(w);
    setWorkerTypes(types);
    setWageHistory(history);
    try {
      setCompliance(await getWorkerCompliance(token, workerId));
    } catch {
      setCompliance(null); // no Form 12 details on file yet -- not an error
    }
  }, [token, workerId]);

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
    try {
      await load();
      setLoadError(false);
    } catch {
      // Keep whatever's already on screen -- see Dashboard's identical note.
    } finally {
      setRefreshing(false);
    }
  }

  const age = useMemo(() => ageFromDob(worker?.dob ?? null), [worker]);
  const currentRate = wageHistory[0]; // getWageProfileHistory returns newest-first

  async function handleAssignType(typeId: string) {
    if (!token) return;
    setAssigning(true);
    try {
      const id = typeId === "none" ? null : parseInt(typeId, 10);
      const updated = await assignWorkerType(token, workerId, id);
      setWorker(updated);
      await load(); // an auto-created wage profile from the type's default may now exist
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server.";
      Alert.alert("Could not assign worker type", message);
    } finally {
      setAssigning(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={2} variant="simple" />
      </View>
    );
  }

  if (loadError || !worker) {
    return (
      <View style={styles.container}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  const typeOptions = [{ label: "No type assigned", value: "none" }, ...workerTypes.map((t) => ({ label: `${t.name} (₹${t.default_rate}/${t.default_rate_type})`, value: String(t.id) }))];
  const currentTypeValue = worker.worker_type_id ? String(worker.worker_type_id) : "none";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
    >
      <Text style={styles.title}>{workerName}</Text>

      <View style={styles.profileCard}>
        <ProfileRow label="Age" value={age !== null ? `${age} years` : "-"} />
        <ProfileRow label="Gender" value={worker.gender ?? "-"} />
        <ProfileRow label="Mobile" value={worker.mobile ?? "-"} />
        <ProfileRow label="Designation" value={compliance?.designation_or_nature_of_work ?? "-"} />
        <ProfileRow label="Aadhaar" value={`•••• •••• ${worker.aadhaar_last4}`} />
      </View>

      <Text style={styles.sectionLabel}>Worker Type</Text>
      <SelectField
        label=""
        value={currentTypeValue}
        options={typeOptions}
        onChange={handleAssignType}
        disabled={assigning}
      />
      <Text style={styles.helper}>Assigning a type sets this worker's rate to the type's default, unless they already have one.</Text>

      <Text style={styles.sectionLabel}>Current Wage Rate</Text>
      {currentRate ? (
        <View style={styles.rateCard}>
          <Text style={styles.rateValue}>
            ₹{currentRate.basic} / {currentRate.rate_type === "daily" ? "day" : "month"}
          </Text>
          <Text style={styles.rateDetail}>Effective from {currentRate.effective_from}</Text>
        </View>
      ) : (
        <Text style={styles.empty}>No wage rate set yet.</Text>
      )}

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate("WageProfile", { workerId, workerName })}
      >
        <Text style={styles.buttonText}>{currentRate ? "Edit Wage Rate" : "Set Wage Rate"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileLabel}>{label}</Text>
      <Text style={styles.profileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  profileCard: { backgroundColor: colors.fieldBg, borderRadius: radius.md, padding: spacing.sm + 4, marginBottom: spacing.md },
  profileRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  profileLabel: { fontSize: 13, color: colors.muted },
  profileValue: { fontSize: 13, fontWeight: "700", color: colors.navy },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.navy, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase" },
  helper: { fontSize: 11, color: colors.muted, marginTop: -spacing.sm, marginBottom: spacing.sm },
  rateCard: { backgroundColor: colors.tealLight, borderRadius: radius.md, padding: spacing.sm + 4 },
  rateValue: { fontSize: 20, fontWeight: "700", color: "#0F6E56" },
  rateDetail: { fontSize: 12, color: "#0F6E56", marginTop: 2 },
  empty: { fontSize: 13, color: colors.muted },
  button: { backgroundColor: colors.teal, borderRadius: radius.sm, padding: 16, alignItems: "center", marginTop: spacing.lg },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
