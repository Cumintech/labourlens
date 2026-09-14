import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  ApiError,
  WageProfile,
  Worker,
  WorkerCompliance,
  WorkerType,
  assignWorkerType,
  createWorkerCompliance,
  getWageProfileHistory,
  getWorker,
  getWorkerCompliance,
  listWorkerTypes,
  updateWorkerCompliance,
} from "../api/client";
import ErrorState from "../components/ErrorState";
import { ListSkeleton } from "../components/Skeleton";
import WorkerTypeSelect from "../components/WorkerTypeSelect";
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
  const [designation, setDesignation] = useState("");
  const [editingDesignation, setEditingDesignation] = useState(false);
  const [savingDesignation, setSavingDesignation] = useState(false);

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
      const c = await getWorkerCompliance(token, workerId);
      setCompliance(c);
      setDesignation(c.designation_or_nature_of_work ?? "");
    } catch {
      setCompliance(null); // no Form 12 details on file yet -- not an error
      setDesignation("");
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

  async function handleAssignType(typeId: number | null) {
    if (!token) return;
    setAssigning(true);
    try {
      const updated = await assignWorkerType(token, workerId, typeId);
      setWorker(updated);
      await load(); // an auto-created wage profile from the type's default may now exist
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server.";
      Alert.alert("Could not assign worker type", message);
    } finally {
      setAssigning(false);
    }
  }

  // designation_or_nature_of_work lives on WorkerCompliance (Form 12),
  // not Worker -- a worker created without filling in the optional
  // Compliance section during Add Worker has no WorkerCompliance row
  // yet at all, so this creates one on first save rather than assuming
  // update always applies.
  async function handleSaveDesignation() {
    if (!token) return;
    setSavingDesignation(true);
    try {
      const save = compliance ? updateWorkerCompliance : createWorkerCompliance;
      const updated = await save(token, workerId, { designation_or_nature_of_work: designation.trim() });
      setCompliance(updated);
      setEditingDesignation(false);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server.";
      Alert.alert("Could not save designation", message);
    } finally {
      setSavingDesignation(false);
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
        <ProfileRow label="Device ID" value={worker.device_user_id ?? "(no device id mapped yet)"} warn={!worker.device_user_id} />
        {editingDesignation ? (
          <View style={styles.designationRow}>
            <Text style={styles.profileLabel}>Designation</Text>
            <View style={styles.designationEditRow}>
              <TextInput
                style={styles.designationInput}
                value={designation}
                onChangeText={setDesignation}
                placeholder="e.g. Electrician"
                placeholderTextColor={colors.muted}
                autoFocus
              />
              <TouchableOpacity
                style={[styles.designationSaveButton, savingDesignation && styles.buttonDisabled]}
                onPress={handleSaveDesignation}
                disabled={savingDesignation}
              >
                {savingDesignation ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.designationSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.profileRow}>
            <Text style={styles.profileLabel}>Designation</Text>
            <TouchableOpacity style={styles.designationValueRow} onPress={() => setEditingDesignation(true)}>
              <Text style={styles.profileValue}>{compliance?.designation_or_nature_of_work || "-"}</Text>
              <Text style={styles.editIcon}>✎</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.wageCard}>
        <View style={styles.wageCardHead}>
          <Text style={styles.wageCardTitle}>Wage</Text>
          <TouchableOpacity onPress={() => navigation.navigate("WageProfile", { workerId, workerName })}>
            <Text style={styles.wageCardEdit}>✎ Edit</Text>
          </TouchableOpacity>
        </View>
        <WorkerTypeSelect
          label="Worker type"
          token={token ?? ""}
          workerTypes={workerTypes}
          value={worker.worker_type_id}
          onChange={handleAssignType}
          onCreated={(created) => setWorkerTypes((prev) => [...prev, created])}
          noneLabel="No type assigned"
          disabled={assigning}
        />
        <Text style={styles.helper}>Assigning a type sets this worker's rate to the type's default, unless they already have one.</Text>

        {currentRate ? (
          <View style={styles.rateCard}>
            <Text style={styles.rateValue}>
              ₹{currentRate.basic} / {currentRate.rate_type === "daily" ? "day" : "month"}
            </Text>
            <Text style={styles.rateDetail}>Effective from {currentRate.effective_from}</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.rateCardEmpty} onPress={() => navigation.navigate("WageProfile", { workerId, workerName })}>
            <Text style={styles.empty}>No wage rate set yet -- tap Edit to set one.</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

function ProfileRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileLabel}>{label}</Text>
      <Text style={[styles.profileValue, warn && styles.profileValueWarn]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  profileCard: { backgroundColor: colors.fieldBg, borderRadius: radius.md, padding: spacing.sm + 4, marginBottom: spacing.md },
  profileRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  profileLabel: { fontSize: 13, color: colors.muted },
  profileValue: { fontSize: 13, fontWeight: "700", color: colors.navy },
  profileValueWarn: { fontSize: 11.5, fontWeight: "700", color: colors.amberDark },
  designationValueRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  editIcon: { fontSize: 13, color: colors.muted },
  designationRow: { paddingVertical: 6 },
  designationEditRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  designationInput: { flex: 1, backgroundColor: colors.white, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: colors.navy },
  designationSaveButton: { backgroundColor: colors.teal, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 8 },
  designationSaveText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  buttonDisabled: { opacity: 0.6 },
  wageCard: { backgroundColor: colors.fieldBg, borderRadius: radius.md, padding: spacing.md },
  wageCardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  wageCardTitle: { fontSize: 13, fontWeight: "800", color: colors.navy, textTransform: "uppercase" },
  wageCardEdit: { fontSize: 12.5, fontWeight: "700", color: colors.teal },
  helper: { fontSize: 11, color: colors.muted, marginTop: -spacing.sm, marginBottom: spacing.sm },
  rateCard: { backgroundColor: colors.tealLight, borderRadius: radius.md, padding: spacing.sm + 4 },
  rateValue: { fontSize: 20, fontWeight: "700", color: colors.tealDark },
  rateDetail: { fontSize: 12, color: colors.tealDark, marginTop: 2 },
  rateCardEmpty: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.sm + 4, alignItems: "center" },
  empty: { fontSize: 13, color: colors.muted },
});
