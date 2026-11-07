import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WageRateType } from "../api/client";
import { colors, radius, spacing } from "../theme";

const OPTIONS: { value: WageRateType; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// The one Daily / Weekly / Monthly salary-type selector (was duplicated
// in Add Worker and Wage Rate with separate styles).
export default function RateTypeSelect({ value, onChange }: { value: WageRateType; onChange: (v: WageRateType) => void }) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((o) => (
        <TouchableOpacity key={o.value} style={[styles.option, value === o.value && styles.optionOn]} onPress={() => onChange(o.value)}>
          <Text style={[styles.text, value === o.value && styles.textOn]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  option: { flex: 1, alignItems: "center", paddingVertical: spacing.sm + 2, borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  optionOn: { backgroundColor: colors.teal },
  text: { fontSize: 13, fontWeight: "700", color: colors.muted },
  textOn: { color: colors.white },
});
