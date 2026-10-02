import { LucideIcon } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing } from "../../theme";

// Self-positions bottom-right, offset by `bottomOffset` (the caller
// passes the tab bar's rendered height + safe-area inset so it always
// sits just above the tab bar rather than overlapping it).
export default function ExtendedFab({
  icon: Icon,
  label,
  onPress,
  bottomOffset = spacing.lg,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  bottomOffset?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.fab, { bottom: bottomOffset }]}
    >
      <Icon size={20} color={colors.surface} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.xl,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  label: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.surface },
});
