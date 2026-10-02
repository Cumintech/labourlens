import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CheckCircle2, ChevronDown, ChevronRight, Fingerprint, Trash2 } from "lucide-react-native";
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
import { LinkArt } from "../components/BiometricArt";
import ErrorState from "../components/ErrorState";
import { Avatar } from "../components/ui";
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
export default function DeviceUserMappingScreen({ route, navigation }: Props) {
  const { deviceId, deviceName } = route.params;
  const { token } = useAuth();
  const [mappings, setMappings] = useState<DeviceUserMapping[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [deviceUserId, setDeviceUserId] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [verifyOpen, setVerifyOpen] = useState(false);
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
      // The only 422 this endpoint returns is the missing-consent gate --
      // offer to go capture it right here instead of just reporting the
      // error, since consent was previously uncapturable from anywhere in
      // the app (see BiometricConsentScreen.tsx). deviceUserId/
      // selectedWorkerId survive untouched: navigating away and back via
      // goBack() never unmounts this screen.
      if (e instanceof ApiError && e.status === 422) {
        const worker = workers.find((w) => w.id === selectedWorkerId);
        Alert.alert("Consent required", e.message, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Capture consent",
            onPress: () =>
              navigation.navigate("BiometricConsent", {
                workerId: selectedWorkerId,
                workerName: worker?.name ?? "this worker",
                returnTo: true,
              }),
          },
        ]);
      } else {
        Alert.alert("Could not map", e instanceof ApiError ? e.message : "Couldn't reach the server.");
      }
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
  // every other worker picker in the app. Excludes workers who already
  // have a mapping on THIS device -- they belong in Current Mappings
  // below, not offered again as if unmapped.
  const mappedWorkerIds = new Set(mappings.map((m) => m.worker_id));
  const workerOptions = workers
    .filter((w) => !mappedWorkerIds.has(w.id))
    .map((w) => ({ label: workerLabel(w), value: String(w.id) }));

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <View style={styles.heroArt} pointerEvents="none">
          <LinkArt />
        </View>
        <Text style={styles.heroTitle} numberOfLines={1}>{deviceName}</Text>
        <Text style={styles.heroSub}>Link each worker to their ID on this device, or generate a direct employee code.</Text>
      </View>

      <View style={styles.body}>
      <View style={styles.addCard}>
      <Text style={styles.cardTitle}>Add a mapping</Text>
      <SelectField
        label="Worker"
        value={selectedWorkerId !== null ? String(selectedWorkerId) : null}
        options={workerOptions}
        onChange={(v) => setSelectedWorkerId(parseInt(v, 10))}
        placeholder={workerOptions.length === 0 ? "All workers already mapped" : "Choose a worker"}
        disabled={workerOptions.length === 0}
      />
      <Text style={styles.label}>Device user ID</Text>
      <TextInput
        style={styles.input}
        value={deviceUserId}
        onChangeText={setDeviceUserId}
        placeholder="ID shown on the device at enrolment"
        placeholderTextColor={colors.muted}
      />
      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleCreateMapping} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save mapping</Text>}
      </TouchableOpacity>
      {selectedWorkerId && (
        <TouchableOpacity onPress={() => handleGenerateCode(selectedWorkerId)}>
          <Text style={styles.altLink}>Or generate a direct employee code for this worker instead →</Text>
        </TouchableOpacity>
      )}
      </View>

      <Text style={styles.sectionLabel}>Mapped · {mappings.length}</Text>
      {mappings.length === 0 ? (
        <Text style={styles.empty}>No manual mappings yet on this device.</Text>
      ) : (
        <View style={styles.listCard}>
          {mappings.map((m, i) => (
            <View key={m.id} style={[styles.mappingRow, i > 0 && styles.mappingDivider]}>
              <Avatar workerId={m.worker_id} name={m.worker_name} size={36} />
              <Text style={styles.mappingLine} numberOfLines={1}>
                {m.worker_name}
                {m.worker_employee_code ? <Text style={styles.mappingCode}>{`  #${m.worker_employee_code}`}</Text> : null}
              </Text>
              <View style={styles.idChip}>
                <Fingerprint size={12} color={colors.primary} />
                <Text style={styles.idChipText}>{m.device_user_id}</Text>
              </View>
              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => handleRemoveMapping(m)}
                accessibilityLabel={`Remove mapping for ${m.worker_name}`}
              >
                <Trash2 size={18} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={styles.verifyCard}>
      <TouchableOpacity style={styles.collapsibleHead} onPress={() => setVerifyOpen((v) => !v)} accessibilityState={{ expanded: verifyOpen }}>
        <View style={styles.verifyIcon}>
          <CheckCircle2 size={18} color={colors.present} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.collapsibleHeadText}>Verify a punch</Text>
          <Text style={styles.verifySub}>Check the latest punch for a worker</Text>
        </View>
        {verifyOpen ? <ChevronDown size={18} color={colors.disabled} /> : <ChevronRight size={18} color={colors.disabled} />}
      </TouchableOpacity>
      {verifyOpen && (
        <View style={styles.collapsibleBody}>
          <Text style={styles.helper}>
            After enrolling someone on the physical device, have them punch once and check it resolves to the right
            person before moving to the next worker.
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
        </View>
      )}
      </View>
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.ground, flexGrow: 1, paddingBottom: spacing.xl },
  hero: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 44, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: "hidden", minHeight: 130 },
  heroArt: { position: "absolute", right: 14, bottom: 26 },
  heroTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 22, color: colors.surface, paddingRight: 130 },
  heroSub: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, lineHeight: 18, color: colors.onPrimaryMuted, marginTop: 4, paddingRight: 130 },
  body: { paddingHorizontal: spacing.md, marginTop: -26, gap: 12 },
  addCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, elevation: 4, shadowColor: colors.primaryDark, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  cardTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy, marginBottom: spacing.sm },
  sectionLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, letterSpacing: 0.6, color: colors.textSecondary, textTransform: "uppercase", marginTop: 4 },
  empty: { fontSize: 13, color: colors.muted },
  listCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  mappingRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingLeft: 14, paddingRight: 6, paddingVertical: 8 },
  mappingDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  mappingLine: { flex: 1, fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  mappingCode: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary },
  idChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  idChipText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.primary },
  removeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  verifyCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  collapsibleHead: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60 },
  verifyIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.presentTint, alignItems: "center", justifyContent: "center" },
  collapsibleHeadText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  verifySub: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary },
  collapsibleBody: { paddingBottom: 14 },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: { backgroundColor: colors.ground, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 15, color: colors.navy, marginBottom: spacing.md },
  helper: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
  button: { backgroundColor: colors.primary, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontWeight: "700", fontSize: 15 },
  buttonGhost: { borderWidth: 1.5, borderColor: colors.teal, borderRadius: radius.sm, padding: 14, alignItems: "center" },
  buttonGhostText: { color: colors.teal, fontWeight: "700", fontSize: 15 },
  altLink: { color: colors.teal, fontSize: 13, fontWeight: "600", marginTop: spacing.sm, textAlign: "center" },
  verifyMessage: { fontSize: 13, color: colors.navy, marginTop: spacing.sm, fontWeight: "600" },
});
