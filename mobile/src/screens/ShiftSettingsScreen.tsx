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
  updateFactoryProfile,
  updateShiftConfig,
} from "../api/client";
import ErrorState from "../components/ErrorState";
import KeyboardScreen from "../components/KeyboardScreen";
import SelectField from "../components/SelectField";
import { ListSkeleton } from "../components/Skeleton";
import TimeField from "../components/TimeField";
import { useAuth } from "../context/AuthContext";
import { INDIAN_STATE_OPTIONS } from "../indianStates";
import { INDUSTRY_OPTIONS } from "../industries";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ShiftSettings">;

// No dedicated Settings surface exists elsewhere in the app yet -- this
// screen doubles as the factory-profile editor too, rather than adding a
// second new screen just for two fields.
export default function ShiftSettingsScreen({}: Props) {
  const { token, owner, updateOwner } = useAuth();
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [factoryName, setFactoryName] = useState(owner?.factory_name ?? "");
  const [factoryAddress, setFactoryAddress] = useState(owner?.factory_address ?? "");
  const [factoryLicenceNo, setFactoryLicenceNo] = useState(owner?.factory_licence_no ?? "");
  const [state, setState] = useState(owner?.state ?? "");
  const [industry, setIndustry] = useState(owner?.industry ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

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

  async function handleSaveProfile() {
    if (!token) return;
    if (!factoryName.trim()) {
      Alert.alert("Factory name required", "This is the name shown on your Home screen and every statutory form.");
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await updateFactoryProfile(
        token,
        factoryName.trim(),
        factoryAddress.trim() || undefined,
        factoryLicenceNo.trim() || undefined,
        state || undefined,
        industry || undefined,
      );
      await updateOwner(updated);
      Alert.alert("Saved", "Factory profile updated.");
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Please try again.");
    } finally {
      setSavingProfile(false);
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
      <Text style={styles.sectionLabel}>Factory profile</Text>
      <Text style={styles.label}>Factory name</Text>
      <TextInput
        style={styles.input}
        value={factoryName}
        onChangeText={setFactoryName}
        placeholder="Your factory's name"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.label}>Factory address</Text>
      <TextInput
        style={styles.input}
        value={factoryAddress}
        onChangeText={setFactoryAddress}
        placeholder="42 Industrial Estate, Madurai"
        placeholderTextColor={colors.muted}
        multiline
      />
      <Text style={styles.label}>Factory licence / registration no.</Text>
      <TextInput
        style={styles.input}
        value={factoryLicenceNo}
        onChangeText={setFactoryLicenceNo}
        placeholder="e.g. TN/MDU/1234"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
      />
      <SelectField
        label="State (for statutory forms)"
        value={state || null}
        options={INDIAN_STATE_OPTIONS}
        onChange={setState}
        placeholder="Select your factory's state"
      />
      <SelectField
        label="Industry (sets your Home screen's background)"
        value={industry || null}
        options={INDUSTRY_OPTIONS}
        onChange={setIndustry}
        placeholder="Select your factory's industry"
      />
      <TouchableOpacity
        style={[styles.button, savingProfile && styles.buttonDisabled]}
        onPress={handleSaveProfile}
        disabled={savingProfile}
      >
        {savingProfile ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save profile</Text>}
      </TouchableOpacity>

      <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Shifts</Text>
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
