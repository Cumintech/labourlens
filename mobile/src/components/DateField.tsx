import DateTimePicker, { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import React, { useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

export function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Replaces free-typed "YYYY-MM-DD" text fields across the app -- a
// typo'd or ambiguous hand-typed date was real feedback from the first
// real-device pass. Wraps the community date picker (Expo Go-compatible,
// no custom dev client needed) behind the same look as the app's other
// input fields.
export default function DateField({
  label,
  value,
  onChange,
  placeholder = "Select date",
  disabled = false,
}: {
  label: string;
  value: string; // "" | "YYYY-MM-DD"
  onChange: (isoValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);

  // `onChange` is deprecated in the installed library version in favor
  // of `onValueChange`/`onDismiss`/`onNeutralButtonPress` -- confirmed
  // against the installed package's own type definitions, not assumed.
  function handleValueChange(_event: DateTimePickerChangeEvent, selected: Date) {
    // Android's picker is a modal dialog that closes itself; iOS's is an
    // inline spinner that stays open until the field is tapped again --
    // hiding unconditionally after any change only closes it where that
    // dismissal is expected.
    if (Platform.OS === "android") setShowPicker(false);
    onChange(isoDate(selected));
  }

  function handleDismiss() {
    if (Platform.OS === "android") setShowPicker(false);
  }

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.input, disabled && styles.inputDisabled]}
        onPress={() => !disabled && setShowPicker(true)}
        disabled={disabled}
      >
        <Text style={value ? styles.valueText : styles.placeholderText}>{value || placeholder}</Text>
      </TouchableOpacity>
      {showPicker && !disabled && (
        <DateTimePicker
          value={value ? new Date(value) : new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onValueChange={handleValueChange}
          onDismiss={handleDismiss}
        />
      )}
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
  },
  inputDisabled: { opacity: 0.6 },
  valueText: { fontSize: 16, color: colors.navy },
  placeholderText: { fontSize: 16, color: colors.muted },
});
