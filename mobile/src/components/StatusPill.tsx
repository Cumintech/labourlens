import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, font, radius, spacing } from "../theme";

export type PillStatus = "present" | "absent" | "leave" | "notMarked" | "deactivated" | "neutral";

// Status color (absent/leave) is used for TEXT only here, never the
// pill's fill -- the fill stays a neutral surface (primarySoft for the
// one positive state, divider for everything else), per the palette's
// "status color = text/dots/selected chips only" rule.
const CONFIG: Record<PillStatus, { bg: string; text: string; label: string }> = {
  present: { bg: colors.primarySoft, text: colors.primary, label: "Present" },
  absent: { bg: colors.divider, text: colors.absent, label: "Absent" },
  leave: { bg: colors.divider, text: colors.leave, label: "On leave" },
  notMarked: { bg: colors.divider, text: colors.muted, label: "Not marked" },
  deactivated: { bg: colors.divider, text: colors.muted, label: "Deactivated" },
  neutral: { bg: colors.divider, text: colors.muted, label: "" },
};

export default function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  const cfg = CONFIG[status];
  return (
    <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.text, { color: cfg.text }]} numberOfLines={1}>
        {label ?? cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 5, alignSelf: "flex-start" },
  text: { fontSize: 12, fontFamily: font.semiBold },
});
