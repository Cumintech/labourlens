import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../../theme";

export default function StatTile({
  label,
  value,
  tint,
  textColor = colors.navy,
}: {
  label: string;
  value: string | number;
  tint?: string;
  textColor?: string;
}) {
  return (
    <View style={[styles.tile, tint ? { backgroundColor: tint } : styles.defaultBg]}>
      <Text style={[styles.value, { color: textColor }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.sm + 4, alignItems: "center" },
  defaultBg: { backgroundColor: colors.ground },
  value: {
    fontFamily: "PlusJakartaSans_800ExtraBold",
    fontSize: 20,
    fontVariant: ["tabular-nums"],
  },
  label: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 11, color: colors.textSecondary, marginTop: 2 },
});
