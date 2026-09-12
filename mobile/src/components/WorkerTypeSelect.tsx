import React, { useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { WorkerType, createWorkerType } from "../api/client";
import { colors, radius, spacing } from "../theme";

type Props = {
  label: string;
  token: string;
  workerTypes: WorkerType[];
  value: number | null;
  onChange: (id: number | null) => void;
  onCreated: (type: WorkerType) => void;
  noneLabel: string;
  disabled?: boolean;
};

// SelectField's fixed-list dropdown, extended with a search box and a
// "+ Add '<query>'" fallback row -- typing a worker type that doesn't
// exist yet (e.g. "Welder") lets it be created and assigned in one
// step instead of needing a separate trip to the Worker Types screen
// first. Kept as its own component rather than a generic option added
// to SelectField, since SelectField is reused for several unrelated
// fixed-choice fields (Gender, rate type, the Forms picker) that have
// no "create new" concept at all.
export default function WorkerTypeSelect({ label, token, workerTypes, value, onChange, onCreated, noneLabel, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newRateType, setNewRateType] = useState<"daily" | "monthly">("daily");
  const [newRate, setNewRate] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = workerTypes.find((t) => t.id === value);
  const selectedLabel = selected ? `${selected.name} (₹${selected.default_rate}/${selected.default_rate_type === "daily" ? "day" : "month"})` : noneLabel;

  const filtered = workerTypes.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));
  const exactMatch = workerTypes.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());
  const canOfferCreate = query.trim().length > 0 && !exactMatch;

  function reset() {
    setOpen(false);
    setQuery("");
    setCreating(false);
    setNewRateType("daily");
    setNewRate("");
  }

  function startCreate() {
    setCreating(true);
  }

  async function handleCreate() {
    const name = query.trim();
    const rateValue = parseFloat(newRate);
    if (!name || isNaN(rateValue) || rateValue <= 0) {
      return;
    }
    setSaving(true);
    try {
      const created = await createWorkerType(token, { name, default_rate_type: newRateType, default_rate: rateValue });
      onCreated(created);
      onChange(created.id);
      reset();
    } catch {
      // Leave the create form open with whatever was typed so far --
      // the surrounding screen already surfaces its own save errors
      // for the rest of the form; a modal-local retry is enough here.
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity style={[styles.input, disabled && styles.inputDisabled]} onPress={() => !disabled && setOpen(true)} disabled={disabled}>
        <Text style={selected ? styles.valueText : styles.placeholderText}>{selectedLabel}</Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={reset}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={reset} />
          <View style={styles.sheet}>
            {!creating ? (
              <>
                <Text style={styles.sheetTitle}>Worker Type</Text>
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search or type a new type"
                  placeholderTextColor={colors.muted}
                  autoFocus
                />
                <FlatList
                  data={filtered}
                  keyExtractor={(t) => String(t.id)}
                  style={styles.list}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.option, item.id === value && styles.optionSelected]}
                      onPress={() => {
                        onChange(item.id);
                        reset();
                      }}
                    >
                      <Text style={[styles.optionText, item.id === value && styles.optionTextSelected]}>
                        {item.name} (₹{item.default_rate}/{item.default_rate_type === "daily" ? "day" : "month"})
                      </Text>
                    </TouchableOpacity>
                  )}
                  ListFooterComponent={
                    canOfferCreate ? (
                      <TouchableOpacity style={styles.createRow} onPress={startCreate}>
                        <Text style={styles.createRowText}>+ Add "{query.trim()}"</Text>
                      </TouchableOpacity>
                    ) : null
                  }
                />
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => {
                    onChange(null);
                    reset();
                  }}
                >
                  <Text style={styles.optionText}>{noneLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={reset}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.sheetTitle}>New worker type: "{query.trim()}"</Text>
                <View style={styles.toggleRow}>
                  {(["daily", "monthly"] as const).map((option) => (
                    <TouchableOpacity
                      key={option}
                      style={[styles.toggleOption, newRateType === option && styles.toggleOptionSelected]}
                      onPress={() => setNewRateType(option)}
                    >
                      <Text style={[styles.toggleText, newRateType === option && styles.toggleTextSelected]}>
                        {option === "daily" ? "Daily rate" : "Monthly rate"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.searchInput}
                  value={newRate}
                  onChangeText={setNewRate}
                  placeholder="Default rate, e.g. 700"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                />
                <View style={styles.createButtonRow}>
                  <TouchableOpacity style={styles.cancelButtonSmall} onPress={() => setCreating(false)}>
                    <Text style={styles.cancelText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.saveButton, saving && styles.buttonDisabled]} onPress={handleCreate} disabled={saving}>
                    {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>Create & select</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inputDisabled: { opacity: 0.6 },
  valueText: { fontSize: 16, color: colors.navy },
  placeholderText: { fontSize: 16, color: colors.muted },
  chevron: { color: colors.muted, fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: "75%" },
  sheetTitle: { fontSize: 14, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  searchInput: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, fontSize: 15, color: colors.navy, marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  option: { paddingVertical: 14, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  optionSelected: { backgroundColor: colors.tealLight },
  optionText: { fontSize: 15, color: colors.navy },
  optionTextSelected: { color: colors.tealDark, fontWeight: "700" },
  createRow: { paddingVertical: 14, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.tealLight, marginTop: 4 },
  createRowText: { color: colors.tealDark, fontWeight: "700", fontSize: 15 },
  cancelButton: { paddingVertical: 14, alignItems: "center", marginTop: spacing.xs },
  cancelText: { color: colors.muted, fontWeight: "700" },
  cancelButtonSmall: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  toggleRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  toggleOption: { flex: 1, backgroundColor: colors.fieldBg, borderRadius: radius.sm, paddingVertical: 12, alignItems: "center" },
  toggleOptionSelected: { backgroundColor: colors.teal },
  toggleText: { fontSize: 13, fontWeight: "600", color: colors.navy },
  toggleTextSelected: { color: colors.white },
  createButtonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  saveButton: { flex: 2, backgroundColor: colors.teal, borderRadius: radius.sm, padding: 14, alignItems: "center" },
  saveText: { color: colors.white, fontWeight: "700" },
  buttonDisabled: { opacity: 0.6 },
});
