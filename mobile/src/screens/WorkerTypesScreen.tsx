import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ApiError, WorkerType, createWorkerType, deleteWorkerType, listWorkerTypes, updateWorkerType } from "../api/client";
import ErrorState from "../components/ErrorState";
import KeyboardScreen from "../components/KeyboardScreen";
import SelectField from "../components/SelectField";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "WorkerTypes">;

// 500-3000 in steps of 50, for quickly picking a common rate rather
// than typing one -- the manual text field right below stays the
// actual source of truth (this is a convenience picker, not the only
// way in), so any custom value typed there just doesn't match a preset
// and the picker shows its placeholder instead of a wrong selection.
const RATE_PRESETS = Array.from({ length: (3000 - 500) / 50 + 1 }, (_, i) => String(500 + i * 50));
const RATE_PRESET_OPTIONS = RATE_PRESETS.map((r) => ({ label: `₹${r}`, value: r }));

// Categories like Skilled/Unskilled/Helper, each with a default rate --
// assigning one to a worker (from the Wage Rate worker detail screen)
// sets their rate to this default unless they already have their own.
export default function WorkerTypesScreen({}: Props) {
  const { token } = useAuth();
  const [types, setTypes] = useState<WorkerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [rateType, setRateType] = useState<"daily" | "monthly">("daily");
  const [rate, setRate] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setTypes(await listWorkerTypes(token));
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

  function resetForm() {
    setEditingId(null);
    setName("");
    setRateType("daily");
    setRate("");
  }

  function startEdit(type: WorkerType) {
    setEditingId(type.id);
    setName(type.name);
    setRateType(type.default_rate_type);
    setRate(String(type.default_rate));
  }

  async function handleSave() {
    if (!token) return;
    const rateValue = parseFloat(rate);
    if (!name.trim() || isNaN(rateValue) || rateValue <= 0) {
      Alert.alert("Missing fields", "Give the type a name and a default rate greater than 0.");
      return;
    }
    setSaving(true);
    try {
      const input = { name: name.trim(), default_rate_type: rateType, default_rate: rateValue };
      if (editingId) {
        await updateWorkerType(token, editingId, input);
      } else {
        await createWorkerType(token, input);
      }
      resetForm();
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server.";
      Alert.alert("Could not save worker type", message);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(type: WorkerType) {
    Alert.alert("Remove worker type", `Remove "${type.name}"? Workers assigned to it will keep their current rate but lose the type label.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          if (!token) return;
          try {
            await deleteWorkerType(token, type.id);
            await load();
          } catch {
            Alert.alert("Could not remove", "Please try again.");
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
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
    >
      <Text style={styles.title}>Worker Types</Text>
      <Text style={styles.subtitle}>Categories like Skilled, Unskilled, or Helper, each with a default wage rate.</Text>

      {types.length === 0 ? (
        <Text style={styles.empty}>No worker types yet -- add one below.</Text>
      ) : (
        types.map((type) => (
          <View key={type.id} style={styles.typeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.typeName}>{type.name}</Text>
              <Text style={styles.typeRate}>
                ₹{type.default_rate} / {type.default_rate_type === "daily" ? "day" : "month"}
              </Text>
            </View>
            <TouchableOpacity onPress={() => startEdit(type)}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(type)}>
              <Text style={styles.removeLink}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <Text style={styles.sectionLabel}>{editingId ? "Edit type" : "Add a type"}</Text>
      <View style={styles.fieldWrap}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Skilled"
          placeholderTextColor={colors.muted}
        />
      </View>
      <SelectField
        label="Rate type"
        value={rateType}
        options={[
          { label: "Daily rate", value: "daily" },
          { label: "Monthly rate", value: "monthly" },
        ]}
        onChange={(v) => setRateType(v as "daily" | "monthly")}
      />
      <SelectField
        label="Default rate -- quick pick"
        value={RATE_PRESETS.includes(rate) ? rate : null}
        options={RATE_PRESET_OPTIONS}
        onChange={setRate}
        placeholder="Choose a common rate, or type your own below"
      />
      <View style={styles.fieldWrap}>
        <Text style={styles.label}>Default rate -- or type your own</Text>
        <TextInput
          style={styles.input}
          value={rate}
          onChangeText={setRate}
          placeholder="700"
          placeholderTextColor={colors.muted}
          keyboardType="numeric"
        />
      </View>

      <View style={styles.buttonRow}>
        {editingId && (
          <TouchableOpacity style={styles.cancelButton} onPress={resetForm}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.saveButton, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>{editingId ? "Save changes" : "Add type"}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  empty: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  typeRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: spacing.sm + 4, marginBottom: spacing.xs, gap: spacing.sm },
  typeName: { fontSize: 14, fontWeight: "700", color: colors.navy },
  typeRate: { fontSize: 12, color: colors.muted, marginTop: 2 },
  editLink: { color: colors.teal, fontSize: 12, fontWeight: "700" },
  removeLink: { color: colors.danger, fontSize: 12, fontWeight: "700" },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.navy, marginTop: spacing.lg, marginBottom: spacing.sm },
  fieldWrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, fontSize: 16, color: colors.navy },
  buttonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancelButton: { flex: 1, paddingVertical: 16, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  cancelText: { color: colors.muted, fontWeight: "700" },
  saveButton: { flex: 2, backgroundColor: colors.teal, borderRadius: radius.sm, padding: 16, alignItems: "center" },
  buttonDisabled: { opacity: 0.6 },
  saveText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
