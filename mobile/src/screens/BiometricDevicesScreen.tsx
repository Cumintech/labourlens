import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Fingerprint, Plus, RefreshCw, UserPlus } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  ApiError,
  BiometricDevice,
  createBiometricDevice,
  listBiometricDevices,
  listUnmappedPunches,
  listWorkers,
  triggerBiometricSync,
} from "../api/client";
import { TerminalArt } from "../components/BiometricArt";
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
  const [unmappedWorkerCount, setUnmappedWorkerCount] = useState(0);
  const [activeWorkerCount, setActiveWorkerCount] = useState(0);
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
    const [d, u, w] = await Promise.all([listBiometricDevices(token), listUnmappedPunches(token), listWorkers(token)]);
    setDevices(d);
    setUnmappedCount(u.length);
    // The leading stat on this screen (per explicit request) -- "how
    // many workers still need mapping" is the actionable number an
    // owner cares about first; unmapped punches are secondary, only
    // meaningful once workers are already mapped and punches from
    // someone who ISN'T need resolving individually (see UnmappedPunches).
    setUnmappedWorkerCount(w.filter((worker) => worker.status === "active" && !worker.device_user_id).length);
    setActiveWorkerCount(w.filter((worker) => worker.status === "active").length);
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

  // The banner's own CTA is the primary, most-visible entry point into
  // mapping -- previously "Map users" only existed buried inside a
  // per-device card below, disconnected from the alert telling the
  // owner to go do it. No unified "map across every device" screen
  // exists yet (DeviceUserMapping is per-device), so this jumps straight
  // into the one device when there's only one (the common case), or the
  // first device when there are several -- a real unified screen is a
  // bigger follow-up, not something to build as a side effect of this fix.
  function handleMapUsersFromBanner() {
    if (devices.length === 0) return;
    const target = devices[0];
    navigation.navigate("DeviceUserMapping", { deviceId: target.id, deviceName: target.name });
  }

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
      <View style={styles.hero}>
        <View style={styles.heroArt} pointerEvents="none">
          <TerminalArt />
        </View>
        <Text style={styles.heroTitle}>Attendance terminals</Text>
        <Text style={styles.heroSub}>Attendance clocks in automatically, e.g. one device per gate.</Text>
      </View>

      <View style={styles.body}>
      <TouchableOpacity
        style={styles.progressCard}
        onPress={handleMapUsersFromBanner}
        disabled={devices.length === 0}
        accessibilityRole="button"
      >
        <View style={styles.progressTop}>
          <Text style={styles.progressTitle}>
            {activeWorkerCount - unmappedWorkerCount} of {activeWorkerCount} workers mapped
          </Text>
          {unmappedWorkerCount > 0 ? (
            <View style={styles.pendingPill}>
              <Text style={styles.pendingPillText}>{unmappedWorkerCount} pending</Text>
            </View>
          ) : (
            <View style={styles.okPill}>
              <Text style={styles.okPillText}>All mapped</Text>
            </View>
          )}
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${activeWorkerCount ? Math.round(((activeWorkerCount - unmappedWorkerCount) / activeWorkerCount) * 100) : 0}%` as `${number}%` },
            ]}
          />
        </View>
        <Text style={styles.progressHint}>
          {unmappedWorkerCount > 0
            ? "Unmapped workers won't clock in from the device until mapped."
            : "All active workers are mapped to a device."}
        </Text>
        {unmappedCount > 0 && (
          <TouchableOpacity style={styles.punchLinkRow} onPress={() => navigation.navigate("UnmappedPunches")}>
            <Text style={styles.punchLinkText}>
              {unmappedCount} unmapped punch{unmappedCount === 1 ? "" : "es"} need attention ›
            </Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>Devices</Text>
      {devices.length === 0 ? (
        <Text style={styles.empty}>No devices added yet.</Text>
      ) : (
        devices.map((d) => (
          <View key={d.id} style={styles.deviceCard}>
            <View style={styles.deviceHeaderRow}>
              <View style={styles.deviceIcon}>
                <Fingerprint size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.deviceName} numberOfLines={1}>{d.name}</Text>
                <Text style={styles.deviceMeta} numberOfLines={1}>{d.ip_address} · port {d.port}</Text>
              </View>
              <View style={[styles.statusPill, d.is_stale ? styles.statusPillStale : styles.statusPillOk]}>
                <View style={[styles.statusDot, d.is_stale ? styles.statusDotStale : styles.statusDotOk]} />
                <Text style={[styles.statusPillText, d.is_stale ? styles.statusPillTextStale : styles.statusPillTextOk]}>
                  {d.is_stale ? "Not syncing" : "Online"}
                </Text>
              </View>
            </View>
            <View style={styles.syncRow}>
              <RefreshCw size={14} color={colors.textSecondary} />
              <Text style={styles.syncText}>
                {d.last_synced_at
                  ? `Last synced ${new Date(d.last_synced_at).toLocaleString()} (${d.last_sync_status})`
                  : "Never synced yet"}
              </Text>
            </View>
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
                  <View style={styles.btnInner}>
                    <RefreshCw size={16} color={colors.white} />
                    <Text style={styles.actionButtonText}>Sync now</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButtonGhost}
                onPress={() => navigation.navigate("DeviceUserMapping", { deviceId: d.id, deviceName: d.name })}
              >
                <View style={styles.btnInner}>
                  <UserPlus size={16} color={colors.primary} />
                  <Text style={styles.actionButtonGhostText}>Map users</Text>
                </View>
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
          <View style={styles.btnInner}>
            <Plus size={18} color={colors.primary} />
            <Text style={styles.addLinkText}>Add device</Text>
          </View>
        </TouchableOpacity>
      )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  content: { paddingBottom: spacing.xl },
  hero: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 48, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: "hidden", minHeight: 150 },
  heroArt: { position: "absolute", right: 18, bottom: 30 },
  heroTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 22, color: colors.surface, paddingRight: 100 },
  heroSub: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, lineHeight: 18, color: colors.onPrimaryMuted, marginTop: 4, paddingRight: 110 },
  body: { paddingHorizontal: spacing.md, marginTop: -30, gap: 12 },
  progressCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 10, elevation: 4, shadowColor: colors.primaryDark, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  progressTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  progressTitle: { flex: 1, fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  pendingPill: { backgroundColor: colors.leaveTint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  pendingPillText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.leave },
  okPill: { backgroundColor: colors.presentTint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  okPillText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.present },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.present },
  progressHint: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary },
  sectionLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", color: colors.textSecondary, marginTop: 4 },
  deviceIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primaryTint, alignItems: "center", justifyContent: "center" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillOk: { backgroundColor: colors.presentTint },
  statusPillStale: { backgroundColor: colors.leaveTint },
  statusPillText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 11 },
  statusPillTextOk: { color: colors.present },
  statusPillTextStale: { color: colors.leave },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.ground, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  syncText: { flex: 1, fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  empty: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  leadStat: { backgroundColor: colors.amberLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, alignItems: "center" },
  leadStatNumber: { fontSize: 32, fontWeight: "800", color: colors.amberDark },
  leadStatLabel: { fontSize: 13, fontWeight: "600", color: colors.amberDark, marginTop: 2 },
  leadStatOk: { backgroundColor: colors.presentTint, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, alignItems: "center" },
  leadStatOkText: { fontSize: 13, fontWeight: "700", color: colors.present },
  bannerMapButton: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: "center",
    width: "100%",
    marginTop: spacing.md,
  },
  bannerMapButtonText: { color: colors.white, fontWeight: "700", fontSize: 14 },
  punchLinkRow: {
    marginTop: spacing.sm + 2,
    paddingTop: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: colors.warningBorder,
    width: "100%",
    alignItems: "center",
  },
  punchLinkText: { color: colors.amberDark, fontWeight: "700", fontSize: 12.5 },
  warningText: { color: colors.amberDark, fontWeight: "700", fontSize: 13, marginTop: spacing.sm },
  deviceCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 },
  deviceHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  deviceName: { fontSize: 16, fontWeight: "700", color: colors.navy },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotOk: { backgroundColor: colors.present },
  statusDotStale: { backgroundColor: colors.leave },
  deviceMeta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  staleWarning: { fontSize: 12, color: colors.danger, marginTop: 6, fontWeight: "600" },
  deviceActions: { flexDirection: "row", gap: 10 },
  actionButton: { flex: 1, backgroundColor: colors.primary, borderRadius: 12, height: 44, alignItems: "center", justifyContent: "center" },
  actionButtonText: { color: colors.white, fontWeight: "700", fontSize: 13 },
  actionButtonGhost: { flex: 1, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  actionButtonGhostText: { color: colors.teal, fontWeight: "700", fontSize: 13 },
  addLink: { height: 56, borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#90CAF9", alignItems: "center", justifyContent: "center" },
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
