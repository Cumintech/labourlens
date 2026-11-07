import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import DateField, { isoDate } from "./DateField";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

// Date of entry into service -- most workers join in the current month,
// so this shows quick Today / Yesterday / 2 days ago / Last week chips
// (value defaults to today in the parent) and only opens the full
// date picker on "Other date".
export default function JoiningDateField({
  value,
  onChange,
  minDate,
}: {
  value: string;
  onChange: (iso: string) => void;
  minDate?: string;
}) {
  const [other, setOther] = useState(false);
  const chips: [string, string][] = [
    ["Today", daysAgo(0)],
    ["Yesterday", daysAgo(1)],
    ["2 days ago", daysAgo(2)],
    ["Last week", daysAgo(7)],
  ];
  const allowed = (iso: string) => !minDate || iso >= minDate;
  const matchesChip = chips.some(([, iso]) => iso === value);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Date of entry into service</Text>
      <View style={styles.row}>
        {chips.map(([label, iso]) => {
          const selected = !other && value === iso;
          return (
            <TouchableOpacity
              key={label}
              disabled={!allowed(iso)}
              style={[styles.chip, selected && styles.chipOn, !allowed(iso) && { opacity: 0.4 }]}
              onPress={() => {
                setOther(false);
                onChange(iso);
              }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={[styles.chip, (other || !matchesChip) && styles.chipOn]} onPress={() => setOther(true)}>
          <Text style={[styles.chipText, (other || !matchesChip) && styles.chipTextOn]}>Other date</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.selected}>Selected: {value || "none"}</Text>
      {(other || (!matchesChip && !!value)) && (
        <DateField label="Pick a date" value={value} onChange={onChange} minDate={minDate} maxDate={isoDate(new Date())} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "600", color: colors.navy, marginBottom: spacing.xs },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  chipOn: { backgroundColor: colors.teal },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  chipTextOn: { color: colors.white },
  selected: { fontSize: 12, color: colors.textSecondary, marginTop: 6 },
});
