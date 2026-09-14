import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  ShiftConfig,
  createShiftConfig,
  deleteShiftConfig,
  listShiftConfigs,
  updateShiftConfig,
} from "../api/client";
import ErrorState from "../components/ErrorState";
import KeyboardScreen from "../components/KeyboardScreen";
import { ListSkeleton } from "../components/Skeleton";
import TimeField from "../components/TimeField";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ShiftSettings">;

// Factory profile fields (name, address, licence, state, industry) used
// to live on this screen too, despite it being named for shift
// management -- moved to a real Profile screen (Section 4) so that data
// exists in exactly one editable place. The helper link below is for
// anyone who lands here out of habit looking for those fields.
export default function ShiftSettingsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newRestInterval, setNewRestInterval] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setShifts(await listShiftConfigs(token));
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

  async function handleAddShift() {
    if (!token) return;
    if (!newLabel.trim()) {
      Alert.alert("Name required", "Give the shift a name, e.g. \"Night\".");
      return;
    }
    setAdding(true);
    try {
      // slot_key is derived from the label -- an internal identifier, not
      // shown to the owner, but must stay stable once attendance history
      // references it, so it's set once at creation and never renamed.
      const slotKey = newLabel.trim().replace(/\s+/g, "_");
      await createShiftConfig(
        token,
        slotKey,
        newLabel.trim(),
        newStart.trim() || undefined,
        newEnd.trim() || undefined,
        newRestInterval.trim() || undefined,
      );
      setNewLabel("");
      setNewStart("");
      setNewEnd("");
      setNewRestInterval("");
      setShowAddForm(false);
      await load();
    } catch (e: any) {
      Alert.alert("Could not add shift", e?.message ?? "Please try again.");
    } finally {
      setAdding(false);
    }
  }

  function handleDeleteShift(shift: ShiftConfig) {
    Alert.alert("Remove shift", `Remove "${shift.label}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          if (!token) return;
          try {
            await deleteShiftConfig(token, shift.id);
            await load();
          } catch (e: any) {
            Alert.alert(
              "Could not remove shift",
              e?.message ?? "This shift may already have attendance marked against it.",
            );
          }
        },
      },
    ]);
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
    <KeyboardScreen
      style={styles.container}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
    >
      <TouchableOpacity style={styles.helpbox} onPress={() => navigation.navigate("Profile")}>
        <Text style={styles.helpboxText}>
          Looking for factory name, address, licence, state, or industry? Edit those from{" "}
          <Text style={styles.helpboxLink}>Profile ›</Text>
        </Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>Shifts</Text>
      <Text style={styles.helper}>
        Up to 3 shifts is typical, but there's no hard limit. Workers can be marked present in more than one
        shift on the same day.
      </Text>
      {shifts.map((shift) => (
        <View key={shift.id} style={styles.shiftRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.shiftLabel}>{shift.label}</Text>
            {(shift.start_time || shift.end_time) && (
              <Text style={styles.shiftTime}>
                {shift.start_time ?? "?"} – {shift.end_time ?? "?"}
              </Text>
            )}
            {shift.rest_interval && <Text style={styles.shiftTime}>Rest: {shift.rest_interval}</Text>}
          </View>
          <TouchableOpacity onPress={() => handleDeleteShift(shift)}>
            <Text style={styles.removeLink}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}

      {showAddForm ? (
        <>
          <Text style={[styles.label, { marginTop: spacing.md }]}>Add a shift</Text>
          <TextInput
            style={styles.input}
            value={newLabel}
            onChangeText={setNewLabel}
            placeholder="Shift name, e.g. Night"
            placeholderTextColor={colors.muted}
          />
          <View style={styles.timeRow}>
            <TimeField label="Start time" value={newStart} onChange={setNewStart} />
            <TimeField label="End time" value={newEnd} onChange={setNewEnd} />
          </View>
          <TextInput
            style={styles.input}
            value={newRestInterval}
            onChangeText={setNewRestInterval}
            placeholder="Rest interval, e.g. 1:00 PM - 1:30 PM"
            placeholderTextColor={colors.muted}
          />
          <View style={styles.addFormButtonRow}>
            <TouchableOpacity
              style={styles.cancelAddButton}
              onPress={() => {
                setShowAddForm(false);
                setNewLabel("");
                setNewStart("");
                setNewEnd("");
                setNewRestInterval("");
              }}
            >
              <Text style={styles.cancelAddButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.addFormButton, adding && styles.buttonDisabled]}
              onPress={handleAddShift}
              disabled={adding}
            >
              {adding ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Add shift</Text>}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <TouchableOpacity style={[styles.button, { marginTop: spacing.md }]} onPress={() => setShowAddForm(true)}>
          <Text style={styles.buttonText}>+ Add Shift</Text>
        </TouchableOpacity>
      )}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  helpbox: { backgroundColor: colors.skyBlueLight, borderRadius: radius.sm, padding: spacing.sm + 4, marginBottom: spacing.md },
  helpboxText: { fontSize: 12, color: colors.navy, lineHeight: 17 },
  helpboxLink: { fontWeight: "700", color: colors.skyBlue },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.navy, marginBottom: spacing.xs },
  helper: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.navy,
  },
  timeRow: { flexDirection: "row", gap: spacing.sm },
  timeInput: { flex: 1 },
  button: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 14, fontWeight: "700" },
  addFormButtonRow: { flexDirection: "row", gap: spacing.sm },
  addFormButton: { flex: 1 },
  cancelAddButton: { flex: 1, paddingVertical: spacing.sm + 4, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.fieldBg, marginTop: spacing.md },
  cancelAddButtonText: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  shiftRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
    marginBottom: spacing.xs,
  },
  shiftLabel: { fontSize: 14, fontWeight: "700", color: colors.navy },
  shiftTime: { fontSize: 11, color: colors.muted, marginTop: 1 },
  removeLink: { color: colors.danger, fontSize: 12, fontWeight: "700" },
});
