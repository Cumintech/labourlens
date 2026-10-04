import React, { useEffect } from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { ALL_INDIAN_STATE_OPTIONS } from "../indianStates";
import { EMPLOYMENT_COLORS, employmentLabel, groupOf, suggestIsm } from "../employment";
import SelectField from "./SelectField";
import { colors, radius, spacing } from "../theme";

type EmploymentTypeValue = "permanent" | "temporary";

// Shared "Employment" form section -- used by both AddWorkerScreen
// (Step 2) and WorkerProfileScreen's Employment edit, so the
// auto-suggest/touched behaviour for the ISM switch lives in one place.
export default function EmploymentFields({
  employmentType,
  onEmploymentTypeChange,
  homeState,
  onHomeStateChange,
  isIsmValue,
  onIsIsmChange,
  touched,
  onTouchedChange,
  factoryState,
}: {
  employmentType: EmploymentTypeValue;
  onEmploymentTypeChange: (t: EmploymentTypeValue) => void;
  homeState: string;
  onHomeStateChange: (s: string) => void;
  isIsmValue: boolean;
  onIsIsmChange: (v: boolean) => void;
  touched: boolean;
  onTouchedChange: (v: boolean) => void;
  factoryState: string | null | undefined;
}) {
  const suggested = suggestIsm(homeState, factoryState);

  // Auto-follows the suggestion until the user manually flips the
  // switch -- once touched, further home-state edits no longer
  // override their explicit choice.
  useEffect(() => {
    if (!touched) onIsIsmChange(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeState, factoryState, touched]);

  const draftGroup = groupOf({ employment_type: employmentType, is_ism: isIsmValue });
  const draftColor = draftGroup ? EMPLOYMENT_COLORS[draftGroup] : null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Employment</Text>

      <View style={styles.segToggle}>
        {(["permanent", "temporary"] as const).map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.segOption, employmentType === option && styles.segOptionActive]}
            onPress={() => onEmploymentTypeChange(option)}
          >
            <Text style={[styles.segText, employmentType === option && styles.segTextActive]}>
              {option === "permanent" ? "Permanent" : "Temporary"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <SelectField label="Home state" value={homeState || null} options={ALL_INDIAN_STATE_OPTIONS} onChange={onHomeStateChange} placeholder="Select" />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Inter-state migrant</Text>
        <Switch
          value={isIsmValue}
          onValueChange={(v) => {
            onTouchedChange(true);
            onIsIsmChange(v);
          }}
          trackColor={{ true: colors.violet }}
        />
      </View>

      {touched && isIsmValue !== suggested ? (
        <View style={styles.hintWarn}>
          <Text style={styles.hintWarnText}>Changed by you. Suggested was {suggested ? "On" : "Off"}.</Text>
          <TouchableOpacity
            onPress={() => {
              onTouchedChange(false);
              onIsIsmChange(suggested);
            }}
          >
            <Text style={styles.useSuggestedLink}>Use suggested</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.hintOk}>
          <Text style={styles.hintOkText}>
            {homeState && factoryState
              ? suggested
                ? `Auto-set On: home state (${homeState}) differs from the factory's state (${factoryState}).`
                : `Auto-set Off: home state matches the factory's state (${factoryState}).`
              : "Set a home state to auto-suggest inter-state migrant status."}
          </Text>
        </View>
      )}

      {draftColor && (
        <View style={styles.savedAsRow}>
          <Text style={styles.savedAsLabel}>Will be saved as</Text>
          <View style={[styles.savedAsChip, { backgroundColor: draftColor.bg }]}>
            <Text style={[styles.savedAsChipText, { color: draftColor.fg }]}>{employmentLabel({ employment_type: employmentType, is_ism: isIsmValue })}</Text>
          </View>
          {employmentType === "permanent" && isIsmValue && (
            <View style={[styles.savedAsChip, { backgroundColor: EMPLOYMENT_COLORS.ism.bg }]}>
              <Text style={[styles.savedAsChipText, { color: EMPLOYMENT_COLORS.ism.fg }]}>ISM</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  cardTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy, marginBottom: spacing.sm },
  segToggle: { flexDirection: "row", backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 4, marginBottom: spacing.md },
  segOption: { flex: 1, paddingVertical: spacing.sm + 2, alignItems: "center", borderRadius: radius.sm - 2 },
  segOptionActive: { backgroundColor: colors.teal },
  segText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.muted },
  segTextActive: { color: colors.white },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm, marginBottom: spacing.xs },
  switchLabel: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.navy },
  hintWarn: { backgroundColor: colors.warningTint, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.xs },
  hintWarnText: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.warningTintText },
  useSuggestedLink: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.primary, marginTop: 4 },
  hintOk: { backgroundColor: colors.presentTint, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.xs },
  hintOkText: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.present },
  savedAsRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm, flexWrap: "wrap" },
  savedAsLabel: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginRight: 4 },
  savedAsChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  savedAsChipText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12 },
});
