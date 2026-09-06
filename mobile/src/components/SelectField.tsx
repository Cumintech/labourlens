import React, { useState } from "react";
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

export type SelectOption<T extends string> = { label: string; value: T };

type Props<T extends string> = {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
};

// One reusable dropdown pattern for every "pick one of a short list"
// input in the app (Gender, Worker Type, the Forms picker, the Worker
// picker, the OT-hours popup) -- tapping the field opens a modal list,
// tapping a row selects it and closes. Matches DateField's look (same
// tap-to-open field shell) so all "structured choice" inputs feel like
// one family instead of a mix of buttons/chips/free text.
export default function SelectField<T extends string>({ label, value, options, onChange, placeholder = "Select", disabled = false }: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.input, disabled && styles.inputDisabled]}
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        <Text style={selected ? styles.valueText : styles.placeholderText}>{selected ? selected.label : placeholder}</Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            {label ? <Text style={styles.sheetTitle}>{label}</Text> : null}
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, item.value === value && styles.optionSelected]}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.optionText, item.value === value && styles.optionTextSelected]}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.cancelButton} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inputDisabled: { opacity: 0.6 },
  valueText: { fontSize: 16, color: colors.navy },
  placeholderText: { fontSize: 16, color: colors.muted },
  chevron: { color: colors.muted, fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: "70%" },
  sheetTitle: { fontSize: 14, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  option: { paddingVertical: 14, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  optionSelected: { backgroundColor: colors.tealLight },
  optionText: { fontSize: 15, color: colors.navy },
  optionTextSelected: { color: "#0F6E56", fontWeight: "700" },
  cancelButton: { paddingVertical: 14, alignItems: "center", marginTop: spacing.xs },
  cancelText: { color: colors.muted, fontWeight: "700" },
});
