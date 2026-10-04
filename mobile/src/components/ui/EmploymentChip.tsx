import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { EMPLOYMENT_COLORS, EmploymentWorker, employmentLabel, groupOf } from "../../employment";

// Small coloured badge for a worker's employment classification --
// Permanent (primary blue) / Contractor (sky blue) / ISM (violet), or
// nothing when employment_type is unset ("Not set" isn't worth a chip
// on a list row). A permanent+ISM worker gets both this chip (blue,
// "Permanent") and a second small violet "ISM" chip alongside it --
// callers render <EmploymentChip w={w} /> plus, when
// w.employment_type === "permanent" && w.is_ism, a second
// <EmploymentChip w={w} ismTagOnly /> for that.
export default function EmploymentChip({ w, ismTagOnly = false }: { w: EmploymentWorker; ismTagOnly?: boolean }) {
  if (ismTagOnly) {
    const c = EMPLOYMENT_COLORS.ism;
    return (
      <View style={[styles.chip, { backgroundColor: c.bg }]}>
        <Text style={[styles.text, { color: c.fg }]}>ISM</Text>
      </View>
    );
  }
  const group = groupOf(w);
  if (!group) return null;
  const c = EMPLOYMENT_COLORS[group];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]}>{employmentLabel(w)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  text: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12 },
});
