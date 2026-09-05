import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, { useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

function toHHMM(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseHHMM(value: string): Date {
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
  return d;
}

// Shift start/end times were free-typed "HH:MM" text -- real feedback
// from the first device pass asked for these to be pickable like the
// date fields, not hand-typed.
export default function TimeField({
  label,
  value,
  onChange,
  placeholder = "Select time",
}: {
  label: string;
  value: string; // "" | "HH:MM"
  onChange: (hhmm: string) => void;
  placeholder?: string;
}) {
  const [showPicker, setShowPicker] = useState(false);

  function handleChange(_event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") setShowPicker(false);
    if (selected) onChange(toHHMM(selected));
  }

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShowPicker(true)}>
        <Text style={value ? styles.valueText : styles.placeholderText}>{value || placeholder}</Text>
      </TouchableOpacity>
      {showPicker && (
        <DateTimePicker
          value={value ? parseHHMM(value) : new Date()}
          mode="time"
          is24Hour
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: { flex: 1 },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: 12,
  },
  valueText: { fontSize: 16, color: colors.navy },
  placeholderText: { fontSize: 16, color: colors.muted },
});
