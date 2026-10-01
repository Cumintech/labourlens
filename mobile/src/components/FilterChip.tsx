import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { colors, font, radius, spacing, MIN_TOUCH_TARGET } from "../theme";

// A selectable pill chip with an optional trailing count -- Workers'
// "All 10 / Details missing 1 / No wage rate 2 / Inactive 1" row, and
// anywhere else a single-select filter list is needed.
export default function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {label}
        {count != null ? ` ${count}` : ""}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: MIN_TOUCH_TARGET - 8,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { fontSize: 13, fontFamily: font.semiBold, color: colors.text },
  labelActive: { color: colors.white },
});
