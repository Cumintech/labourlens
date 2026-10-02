import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, Modal, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ApiError, WorkerType, createWorkerType, deleteWorkerType, listWorkerTypes, updateWorkerType } from "../api/client";
import { ChevronRight, Plus } from "lucide-react-native";
import ErrorState from "../components/ErrorState";
import TradeIcon from "../components/TradeIcon";
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
  const [sheetOpen, setSheetOpen] = useState(false);

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
    setSheetOpen(false);
  }

  function startEdit(type: WorkerType) {
    setEditingId(type.id);
    setName(type.name);
    setRateType(type.default_rate_type);
    setRate(String(type.default_rate));
    setSheetOpen(true);
  }

  function startAdd() {
    setEditingId(null);
    setName("");
    setRateType("daily");
    setRate("");
    setSheetOpen(true);
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
            resetForm();
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
      <View style={styles.hero}>
        <View style={styles.heroIcons} pointerEvents="none">
          <TradeIcon typeName="Carpenter" size={40} />
          <TradeIcon typeName="Plumber" size={40} />
          <TradeIcon typeName="Watchman" size={40} />
        </View>
        <Text style={styles.title}>Trades &amp; default rates</Text>
        <Text style={styles.subtitle}>Group workers by trade, each with a default wage rate.</Text>
      </View>

      <View style={styles.body}>
        {types.length === 0 ? (
          <Text style={styles.empty}>No worker types yet -- add one below.</Text>
        ) : (
          <View style={styles.listCard}>
            {types.map((type, i) => (
              <TouchableOpacity key={type.id} style={[styles.typeRow, i > 0 && styles.typeRowDivider]} onPress={() => startEdit(type)} accessibilityRole="button">
                <TradeIcon typeName={type.name} size={44} />
                <Text style={styles.typeName} numberOfLines={1}>{type.name}</Text>
                <View style={styles.ratePill}>
                  <Text style={styles.typeRate}>
                    ₹{type.default_rate}
                    <Text style={styles.typeRateUnit}> /{type.default_rate_type === "daily" ? "day" : "month"}</Text>
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.disabled} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!sheetOpen && (
          <TouchableOpacity style={styles.button} onPress={startAdd} accessibilityRole="button">
            <Plus size={18} color={colors.white} />
            <Text style={styles.buttonText}>Add worker type</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={resetForm}>
        <View style={styles.backdrop}>
          {/* Sibling to the sheet, not a wrapper around it -- a backdrop
              that WRAPS the sheet lets DOM click events from the nested
              TextInputs bubble up and dismiss the modal on react-native-web
              (a real bug hit and fixed elsewhere in this app). */}
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={resetForm} />
          <View style={styles.sheet}>
            <Text style={styles.sectionLabel}>{editingId ? "Edit Worker Type" : "Add Worker Type"}</Text>
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
              <TouchableOpacity style={styles.cancelButton} onPress={resetForm}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveButton, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>{editingId ? "Save changes" : "Add type"}</Text>}
              </TouchableOpacity>
            </View>

            {editingId && (
              <TouchableOpacity
                style={styles.removeTypeLink}
                onPress={() => {
                  const type = types.find((t) => t.id === editingId);
                  if (type) handleDelete(type);
                }}
              >
                <Text style={styles.removeLink}>Remove this type</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.ground, flexGrow: 1, paddingBottom: spacing.xl },
  hero: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 40, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  heroIcons: { flexDirection: "row", gap: 8, marginBottom: spacing.sm + 4 },
  title: { fontFamily: "IBMPlexSans_700Bold", fontSize: 22, color: colors.surface },
  subtitle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.onPrimaryMuted, marginTop: 4 },
  body: { paddingHorizontal: spacing.md, marginTop: -22, gap: 12 },
  empty: { fontSize: 13, color: colors.muted, backgroundColor: colors.surface, borderRadius: 16, padding: spacing.md },
  listCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden", elevation: 3, shadowColor: colors.primaryDark, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  typeRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68, paddingHorizontal: 14, paddingVertical: 12 },
  typeRowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  typeName: { flex: 1, fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  ratePill: { backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  typeRate: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.primaryDark },
  typeRateUnit: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.textSecondary },
  removeLink: { color: colors.danger, fontSize: 12, fontWeight: "700" },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    maxHeight: "85%",
  },
  fieldWrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, fontSize: 16, color: colors.navy },
  buttonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancelButton: { flex: 1, paddingVertical: 16, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  cancelText: { color: colors.muted, fontWeight: "700" },
  saveButton: { flex: 2, backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: "center" },
  buttonDisabled: { opacity: 0.6 },
  saveText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  button: { flexDirection: "row", gap: 8, justifyContent: "center", backgroundColor: colors.primary, borderRadius: 12, height: 50, alignItems: "center" },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  removeTypeLink: { alignItems: "center", marginTop: spacing.md },
});
