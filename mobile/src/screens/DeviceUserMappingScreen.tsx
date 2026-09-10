import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  ApiError,
  DeviceUserMapping,
  Worker,
  createDeviceMapping,
  deleteDeviceMapping,
  getOrCreateEmployeeCode,
  listDeviceMappings,
  listWorkers,
  verifyPunch,
} from "../api/client";
import ErrorState from "../components/ErrorState";
import KeyboardScreen from "../components/KeyboardScreen";
import SelectField from "../components/SelectField";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { workerLabel } from "../workerLabel";

type Props = NativeStackScreenProps<RootStackParamList, "DeviceUserMapping">;

// Fallback/safety net (Section 4): the preferred path is entering a
// worker's own numeric_employee_code directly as the device's User ID
// at enrollment time, which needs no mapping row here at all -- see
// "Generate employee code" below and biometric_sync.py's direct-ID
// resolution. This screen exists for whenever that wasn't done, or
// needs correcting, plus the verification-punch check every real
// enrollment should end with.
export default function DeviceUserMappingScreen({ route }: Props) {
  const { deviceId, deviceName } = route.params;
  const { token } = useAuth();
  const [mappings, setMappings] = useState<DeviceUserMapping[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [deviceUserId, setDeviceUserId] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [verifyDeviceUserId, setVerifyDeviceUserId] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [m, w] = await Promise.all([listDeviceMappings(token, deviceId), listWorkers(token)]);
    setMappings(m);
    setWorkers(w);
  }, [token, deviceId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .then(() => setLoadError(false))
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }, [load]),
  );

  async function handleGenerateCode(workerId: number) {
    if (!token) return;
    try {
      const { numeric_employee_code } = await getOrCreateEmployeeCode(token, workerId);
      Alert.alert(
        "Employee code",
        `Enter ${numeric_employee_code} as this worker's User ID directly on the device at enrollment time -- no mapping needed here for them.`,
      );
      await load();
    } catch (e) {
      Alert.alert("Could not generate code", e instanceof ApiError ? e.message : "Couldn't reach the server.");
    }
  }

  async function handleCreateMapping() {
    if (!token || !deviceUserId.trim() || !selectedWorkerId) {
      Alert.alert("Missing fields", "Enter the device user ID and choose a worker.");
      return;
    }
    setSaving(true);
    try {
      await createDeviceMapping(token, { device_id: deviceId, device_user_id: deviceUserId.trim(), worker_id: selectedWorkerId });
      setDeviceUserId("");
      setSelectedWorkerId(null);
      await load();
    } catch (e) {
      Alert.alert("Could not map", e instanceof ApiError ? e.message : "Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMapping(mapping: DeviceUserMapping) {
    if (!token) return;
    Alert.alert("Remove mapping", `Unmap device user "${mapping.device_user_id}" from ${mapping.worker_name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDeviceMapping(token, mapping.id);
            await load();
          } catch {
            Alert.alert("Could not remove", "Please try again.");
          }
        },
      },
    ]);
  }

  async function handleVerify() {
    if (!token || !verifyDeviceUserId.trim()) return;
    setVerifying(true);
    setVerifyMessage(null);
    try {
      const result = await verifyPunch(token, deviceId, verifyDeviceUserId.trim());
      setVerifyMessage(result.message);
    } catch (e) {
      setVerifyMessage(e instanceof ApiError ? e.message : "Couldn't reach the server.");
    } finally {
      setVerifying(false);
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

  // Never name alone -- a worker list disambiguated by employee code
  // (and "(Deactivated)" for anyone no longer active), same rule as
  // every other worker picker in the app.
  const workerOptions = workers.map((w) => ({
    label: workerLabel(w),
    value: String(w.id),
  }));

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>{deviceName}</Text>
      <Text style={styles.subtitle}>Map device users to workers, or generate a direct employee code instead.</Text>

      <Text style={styles.sectionLabel}>Current mappings</Text>
      {mappings.length === 0 ? (
        <Text style={styles.empty}>No manual mappings yet on this device.</Text>
      ) : (
        mappings.map((m) => (
          <View key={m.id} style={styles.mappingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.mappingWorker}>
                {m.worker_name}
                {m.worker_employee_code ? ` (#${m.worker_employee_code})` : ""}
              </Text>
              <Text style={styles.mappingDeviceId}>Device user ID: {m.device_user_id}</Text>
            </View>
            <TouchableOpacity onPress={() => handleRemoveMapping(m)}>
              <Text style={styles.removeLink}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <Text style={styles.sectionLabel}>Add a manual mapping</Text>
      <Text style={styles.label}>Device user ID</Text>
      <TextInput
        style={styles.input}
        value={deviceUserId}
        onChangeText={setDeviceUserId}
        placeholder="ID shown on the device at enrollment"
        placeholderTextColor={colors.muted}
      />
      <SelectField
        label="Worker"
        value={selectedWorkerId !== null ? String(selectedWorkerId) : null}
        options={workerOptions}
        onChange={(v) => setSelectedWorkerId(parseInt(v, 10))}
        placeholder="Choose a worker"
      />
      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleCreateMapping} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save mapping</Text>}
      </TouchableOpacity>
      {selectedWorkerId && (
        <TouchableOpacity onPress={() => handleGenerateCode(selectedWorkerId)}>
          <Text style={styles.altLink}>Or generate a direct employee code for this worker instead →</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionLabel}>Verify a punch</Text>
      <Text style={styles.helper}>
        After enrolling someone on the physical device, have them punch once and check it resolves to the right person
        before moving to the next worker.
      </Text>
      <TextInput
        style={styles.input}
        value={verifyDeviceUserId}
        onChangeText={setVerifyDeviceUserId}
        placeholder="Device user ID just enrolled"
        placeholderTextColor={colors.muted}
      />
      <TouchableOpacity style={[styles.buttonGhost, verifying && styles.buttonDisabled]} onPress={handleVerify} disabled={verifying}>
        {verifying ? <ActivityIndicator color={colors.teal} /> : <Text style={styles.buttonGhostText}>Check latest punch</Text>}
      </TouchableOpacity>
      {verifyMessage && <Text style={styles.verifyMessage}>{verifyMessage}</Text>}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.navy, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase" },
  empty: { fontSize: 13, color: colors.muted, marginBottom: spacing.sm },
  mappingRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: spacing.sm + 4,
    marginBottom: spacing.xs,
  },
  mappingWorker: { fontSize: 14, fontWeight: "700", color: colors.navy },
  mappingDeviceId: { fontSize: 12, color: colors.muted, marginTop: 2 },
  removeLink: { color: colors.danger, fontSize: 12, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, fontSize: 15, color: colors.navy, marginBottom: spacing.md },
  helper: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
  button: { backgroundColor: colors.teal, borderRadius: radius.sm, padding: 14, alignItems: "center" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontWeight: "700", fontSize: 15 },
  buttonGhost: { borderWidth: 1.5, borderColor: colors.teal, borderRadius: radius.sm, padding: 14, alignItems: "center" },
  buttonGhostText: { color: colors.teal, fontWeight: "700", fontSize: 15 },
  altLink: { color: colors.teal, fontSize: 13, fontWeight: "600", marginTop: spacing.sm, textAlign: "center" },
  verifyMessage: { fontSize: 13, color: colors.navy, marginTop: spacing.sm, fontWeight: "600" },
});
