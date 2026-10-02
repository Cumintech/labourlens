import { ChevronDown } from "lucide-react-native";
import React, { useState } from "react";
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

// `header: true` marks a non-selectable section heading row (value is
// never matched against the field's current value) -- used to group
// long option lists, e.g. the Reports form-type picker, under headings.
export type SelectOption<T extends string> = { label: string; value: T; header?: boolean };

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
        <ChevronDown size={16} color={colors.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            {label ? <Text style={styles.sheetTitle}>{label}</Text> : null}
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              style={styles.list}
              renderItem={({ item }) =>
                item.header ? (
                  <Text style={styles.optionHeader}>{item.label}</Text>
                ) : (
                  <TouchableOpacity
                    style={[styles.option, item.value === value && styles.optionSelected]}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.optionText, item.value === value && styles.optionTextSelected]}>{item.label}</Text>
                  </TouchableOpacity>
                )
              }
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
  label: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.ground,
    borderRadius: radius.sm,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  inputDisabled: { opacity: 0.6 },
  valueText: { fontFamily: "IBMPlexSans_500Medium", fontSize: 16, color: colors.navy },
  placeholderText: { fontFamily: "IBMPlexSans_500Medium", fontSize: 16, color: colors.textSecondary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: "70%" },
  sheetTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy, marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  optionHeader: {
    fontFamily: "IBMPlexSans_700Bold",
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: "uppercase",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  option: { paddingVertical: 14, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  optionSelected: { backgroundColor: colors.primaryTint },
  optionText: { fontFamily: "IBMPlexSans_500Medium", fontSize: 15, color: colors.navy },
  optionTextSelected: { color: colors.primary, fontFamily: "IBMPlexSans_700Bold" },
  cancelButton: { paddingVertical: 14, alignItems: "center", marginTop: spacing.xs },
  cancelText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.textSecondary },
});
