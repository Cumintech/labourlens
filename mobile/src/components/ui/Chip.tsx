import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing } from "../../theme";

export default function Chip({
  label,
  selected = false,
  onPress,
  count,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  count?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>
        {label}
        {count !== undefined ? ` (${count})` : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.ground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  label: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.textSecondary },
  labelSelected: { color: colors.primary, fontFamily: "IBMPlexSans_700Bold" },
});
