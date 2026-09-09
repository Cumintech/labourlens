import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ApiError, UnmappedPunch, Worker, listUnmappedPunches, listWorkers, resolveUnmappedPunch } from "../api/client";
import ErrorState from "../components/ErrorState";
import SelectField from "../components/SelectField";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "UnmappedPunches">;

// A punch from a device_user_id with no resolvable mapping is never
// silently dropped -- it's stored (worker_id left null) and surfaces
// here so an unresolved enrollment stays visible instead of quietly
// lost. Resolving one also backfills every other still-unmapped punch
// on that device with the same raw ID (see biometric_api.py), since a
// real-world miss like this usually isn't a one-off.
export default function UnmappedPunchesScreen({}: Props) {
  const { token } = useAuth();
  const [punches, setPunches] = useState<UnmappedPunch[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Record<number, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [p, w] = await Promise.all([listUnmappedPunches(token), listWorkers(token)]);
    setPunches(p);
    setWorkers(w);
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

  async function handleResolve(punch: UnmappedPunch) {
    const workerId = selectedWorkerIds[punch.id];
    if (!token || !workerId) {
      Alert.alert("Choose a worker", "Pick which worker this device user ID actually belongs to.");
      return;
    }
    setResolvingId(punch.id);
    try {
      await resolveUnmappedPunch(token, punch.id, workerId);
      await load();
    } catch (e) {
      Alert.alert("Could not resolve", e instanceof ApiError ? e.message : "Couldn't reach the server.");
    } finally {
      setResolvingId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={3} variant="simple" />
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

  const workerOptions = workers.map((w) => ({
    label: `${w.name} (${w.numeric_employee_code ? `#${w.numeric_employee_code}` : "no code yet"})${w.status === "active" ? "" : " (Deactivated)"}`,
    value: String(w.id),
  }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Unmapped Punches</Text>
      <Text style={styles.subtitle}>These device user IDs punched in but aren't mapped to a worker yet.</Text>

      {punches.length === 0 ? (
        <Text style={styles.empty}>Nothing pending -- every punch is mapped.</Text>
      ) : (
        punches.map((p) => (
          <View key={p.id} style={styles.punchCard}>
            <Text style={styles.punchDevice}>{p.device_name}</Text>
            <Text style={styles.punchMeta}>
              Device user ID: {p.raw_device_user_id} · {p.punch_type} · {new Date(p.timestamp).toLocaleString()}
            </Text>
            <SelectField
              label=""
              value={selectedWorkerIds[p.id] !== undefined && selectedWorkerIds[p.id] !== null ? String(selectedWorkerIds[p.id]) : null}
              options={workerOptions}
              onChange={(v) => setSelectedWorkerIds((prev) => ({ ...prev, [p.id]: parseInt(v, 10) }))}
              placeholder="Which worker is this?"
            />
            <TouchableOpacity
              style={[styles.resolveButton, resolvingId === p.id && styles.resolveButtonDisabled]}
              onPress={() => handleResolve(p)}
              disabled={resolvingId === p.id}
            >
              {resolvingId === p.id ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.resolveButtonText}>Map & resolve</Text>}
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  empty: { fontSize: 13, color: colors.muted },
  punchCard: { backgroundColor: colors.fieldBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  punchDevice: { fontSize: 15, fontWeight: "700", color: colors.navy },
  punchMeta: { fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: spacing.sm },
  resolveButton: { backgroundColor: colors.teal, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center", marginTop: spacing.xs },
  resolveButtonDisabled: { opacity: 0.6 },
  resolveButtonText: { color: colors.white, fontWeight: "700", fontSize: 13 },
});
