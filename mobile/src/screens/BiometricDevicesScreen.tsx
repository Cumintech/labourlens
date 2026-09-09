import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  ApiError,
  BiometricDevice,
  createBiometricDevice,
  listBiometricDevices,
  listUnmappedPunches,
  triggerBiometricSync,
} from "../api/client";
import ErrorState from "../components/ErrorState";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "BiometricDevices">;

// No physical device exists yet for this project -- every sync here
// runs against the mock connector (BIOMETRIC_CONNECTOR env var on the
// backend controls that; see biometric.py). Swapping in a real ZKTeco
// unit later needs no change on this screen at all -- "Sync now" calls
// the exact same endpoint either way.
export default function BiometricDevicesScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [devices, setDevices] = useState<BiometricDevice[]>([]);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [d, u] = await Promise.all([listBiometricDevices(token), listUnmappedPunches(token)]);
    setDevices(d);
    setUnmappedCount(u.length);
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
    try {
      await load();
      setLoadError(false);
    } catch {
      // Keep whatever's already on screen -- see other list screens' identical note.
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAddDevice() {
    if (!token || !name.trim() || !ipAddress.trim()) {
      Alert.alert("Missing fields", "Give the device a name and its IP address.");
      return;
    }
    setAdding(true);
    try {
      await createBiometricDevice(token, { name: name.trim(), ip_address: ipAddress.trim() });
      setName("");
      setIpAddress("");
      setShowAddForm(false);
      await load();
    } catch (e) {
      Alert.alert("Could not add device", e instanceof ApiError ? e.message : "Couldn't reach the server.");
    } finally {
      setAdding(false);
    }
  }

  async function handleSync(device: BiometricDevice) {
    if (!token) return;
    setSyncingId(device.id);
    try {
      const result = await triggerBiometricSync(token, device.id);
      if (result.status === "ok") {
        Alert.alert(
          "Sync complete",
          `${result.new_punches} new punch${result.new_punches === 1 ? "" : "es"}` +
            (result.unmapped_punches ? `, ${result.unmapped_punches} unmapped` : "") +
            (result.duplicate_punches ? `, ${result.duplicate_punches} already synced` : ""),
        );
      } else {
        Alert.alert("Sync did not complete", result.error ?? `Device reported: ${result.status}`);
      }
      await load();
    } catch (e) {
      Alert.alert("Sync failed", e instanceof ApiError ? e.message : "Couldn't reach the server.");
    } finally {
      setSyncingId(null);
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
    >
      <Text style={styles.title}>Biometric Devices</Text>
      <Text style={styles.subtitle}>Fingerprint attendance terminals, e.g. one per gate.</Text>

      {unmappedCount > 0 && (
        <TouchableOpacity style={styles.warningBanner} onPress={() => navigation.navigate("UnmappedPunches")}>
          <Text style={styles.warningText}>
            {unmappedCount} unmapped punch{unmappedCount === 1 ? "" : "es"} need attention →
          </Text>
        </TouchableOpacity>
      )}

      {devices.length === 0 ? (
        <Text style={styles.empty}>No devices added yet.</Text>
      ) : (
        devices.map((d) => (
          <View key={d.id} style={styles.deviceCard}>
            <View style={styles.deviceHeaderRow}>
              <Text style={styles.deviceName}>{d.name}</Text>
              <View style={[styles.statusDot, d.is_stale ? styles.statusDotStale : styles.statusDotOk]} />
            </View>
            <Text style={styles.deviceMeta}>{d.ip_address}:{d.port}</Text>
            <Text style={styles.deviceMeta}>
              {d.last_synced_at
                ? `Last synced: ${new Date(d.last_synced_at).toLocaleString()} (${d.last_sync_status})`
                : "Never synced yet"}
            </Text>
            {d.is_stale && <Text style={styles.staleWarning}>Hasn't synced recently -- check the device is powered and reachable.</Text>}

            <View style={styles.deviceActions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleSync(d)}
                disabled={syncingId === d.id}
              >
                {syncingId === d.id ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.actionButtonText}>Sync now</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButtonGhost}
                onPress={() => navigation.navigate("DeviceUserMapping", { deviceId: d.id, deviceName: d.name })}
              >
                <Text style={styles.actionButtonGhostText}>Map users</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      {showAddForm ? (
        <View style={styles.addForm}>
          <Text style={styles.label}>Device name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Main Gate" placeholderTextColor={colors.muted} />
          <Text style={styles.label}>IP address</Text>
          <TextInput
            style={styles.input}
            value={ipAddress}
            onChangeText={setIpAddress}
            placeholder="e.g. 192.168.1.50"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
          />
          <View style={styles.addFormButtons}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowAddForm(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={handleAddDevice} disabled={adding}>
              {adding ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>Add device</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addLink} onPress={() => setShowAddForm(true)}>
          <Text style={styles.addLinkText}>+ Add device</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  empty: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  warningBanner: { backgroundColor: colors.amberLight, borderRadius: radius.sm, padding: spacing.sm + 4, marginBottom: spacing.md },
  warningText: { color: "#8A5A14", fontWeight: "700", fontSize: 13 },
  deviceCard: { backgroundColor: colors.fieldBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  deviceHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  deviceName: { fontSize: 16, fontWeight: "700", color: colors.navy },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusDotOk: { backgroundColor: "#1e7a3d" },
  statusDotStale: { backgroundColor: colors.danger },
  deviceMeta: { fontSize: 12, color: colors.muted, marginTop: 4 },
  staleWarning: { fontSize: 12, color: colors.danger, marginTop: 6, fontWeight: "600" },
  deviceActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flex: 1, backgroundColor: colors.teal, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center" },
  actionButtonText: { color: colors.white, fontWeight: "700", fontSize: 13 },
  actionButtonGhost: { flex: 1, borderWidth: 1.5, borderColor: colors.teal, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center" },
  actionButtonGhostText: { color: colors.teal, fontWeight: "700", fontSize: 13 },
  addLink: { marginTop: spacing.sm, paddingVertical: spacing.sm },
  addLinkText: { color: colors.teal, fontWeight: "700", fontSize: 14 },
  addForm: { backgroundColor: colors.fieldBg, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { backgroundColor: colors.white, borderRadius: radius.sm, padding: 12, fontSize: 15, color: colors.navy },
  addFormButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  cancelButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.white },
  cancelText: { color: colors.muted, fontWeight: "700" },
  saveButton: { flex: 2, backgroundColor: colors.teal, borderRadius: radius.sm, padding: 12, alignItems: "center" },
  saveText: { color: colors.white, fontWeight: "700" },
});
