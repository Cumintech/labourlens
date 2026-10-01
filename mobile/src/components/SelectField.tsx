import React, { useState } from "react";
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "./Icon";
import { colors, font, radius, spacing, MIN_TOUCH_TARGET } from "../theme";

export type SelectOption<T extends string> = { label: string; value: T };

type Props<T extends string> = {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  // Bordered/white-background look (Reports' "Report"/"Time period"/
  // "Worker" selects) instead of the default filled-gray look used
  // everywhere else (Gender, Worker Type, ...). Purely visual.
  outlined?: boolean;
};

// One reusable dropdown pattern for every "pick one of a short list"
// input in the app -- tapping the field opens a modal list, tapping a
// row selects it and closes.
export default function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Select",
  disabled = false,
  outlined = false,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.input, outlined && styles.inputOutlined, disabled && styles.inputDisabled]}
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        <Text style={[selected ? styles.valueText : styles.placeholderText, disabled && styles.textDisabled]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Icon name="chevronDown" size={16} color={disabled ? colors.muted : colors.text} />
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
  label: { fontSize: 12, fontFamily: font.semiBold, color: colors.muted, marginBottom: spacing.xs },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.bg,
    borderRadius: radius.control,
    paddingHorizontal: spacing.sm + 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inputOutlined: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  inputDisabled: { opacity: 0.55 },
  valueText: { fontSize: 15, fontFamily: font.regular, color: colors.text, flexShrink: 1 },
  placeholderText: { fontSize: 15, fontFamily: font.regular, color: colors.muted, flexShrink: 1 },
  textDisabled: { color: colors.muted },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.hero, borderTopRightRadius: radius.hero, padding: spacing.md, maxHeight: "70%" },
  sheetTitle: { fontSize: 14, fontFamily: font.semiBold, color: colors.text, marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  option: { paddingVertical: 14, paddingHorizontal: spacing.sm, borderRadius: radius.control },
  optionSelected: { backgroundColor: colors.primarySoft },
  optionText: { fontSize: 15, fontFamily: font.regular, color: colors.text },
  optionTextSelected: { color: colors.primaryDark, fontFamily: font.semiBold },
  cancelButton: { paddingVertical: 14, alignItems: "center", marginTop: spacing.xs },
  cancelText: { color: colors.muted, fontFamily: font.semiBold },
});
