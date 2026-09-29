import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";

export type WorkerStatus = "present" | "absent" | "leave" | "unmarked" | "warning" | "inactive";

const CONFIG: Record<WorkerStatus, { label: string; fg: string; bg: string }> = {
  present: { label: "Present", fg: colors.present, bg: colors.presentTint },
  absent: { label: "Absent", fg: colors.absentTintText, bg: colors.absentTint },
  leave: { label: "Leave", fg: colors.leave, bg: colors.leaveTint },
  unmarked: { label: "Not marked", fg: colors.unmarked, bg: colors.unmarkedTint },
  warning: { label: "Needs attention", fg: colors.warningTintText, bg: colors.warningTint },
  inactive: { label: "Inactive", fg: colors.textSecondary, bg: colors.divider },
};

// The one place attendance/alert status renders as color -- every other
// UI element stays neutral so this always reads as "this is a status",
// never just decoration (see theme.ts's status-color rule).
export default function StatusChip({ status, label }: { status: WorkerStatus; label?: string }) {
  const cfg = CONFIG[status];
  return (
    <View style={[styles.chip, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.text, { color: cfg.fg }]}>{label ?? cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  text: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 12 },
});
