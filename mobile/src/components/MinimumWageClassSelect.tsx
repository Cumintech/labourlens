import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MinimumWageCheck, MinimumWageEmployment, checkMinimumWage, listMinimumWageEmployments } from "../api/client";
import { colors, radius, spacing } from "../theme";
import SelectField from "./SelectField";

type Rate = { rateType: string; basic: number; da: number };

type Props = {
  token: string;
  // The factory's chosen employment (owner.min_wage_employment_id).
  employmentId: number | null | undefined;
  value: number | null;
  onChange: (classId: number | null) => void;
  // When set, the proposed Basic + DA is compared with the class minimum live.
  rate?: Rate;
};

const NONE = "none";
const formatRupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Picks the worker's statutory minimum-wage class (Basic + DA, per the
// factory's employment) and warns when the proposed salary is below it.
// The minimum always comes from the server, never computed or hardcoded here.
export default function MinimumWageClassSelect({ token, employmentId, value, onChange, rate }: Props) {
  const [employment, setEmployment] = useState<MinimumWageEmployment | null>(null);
  const [check, setCheck] = useState<MinimumWageCheck | null>(null);

  useEffect(() => {
    if (!employmentId) {
      setEmployment(null);
      return;
    }
    let cancelled = false;
    listMinimumWageEmployments(token)
      .then((all) => !cancelled && setEmployment(all.find((e) => e.id === employmentId) ?? null))
      .catch(() => !cancelled && setEmployment(null));
    return () => {
      cancelled = true;
    };
  }, [token, employmentId]);

  const rateType = rate?.rateType;
  const basic = rate?.basic ?? 0;
  const da = rate?.da ?? 0;
  useEffect(() => {
    if (value == null || !rateType || !(basic > 0)) {
      setCheck(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      checkMinimumWage(token, value, rateType, basic, da)
        .then((c) => !cancelled && setCheck(c))
        .catch(() => !cancelled && setCheck(null));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, value, rateType, basic, da]);

  if (!employmentId) {
    return (
      <Text style={styles.hint}>
        Choose your factory's minimum-wage employment in Factory Profile to compare wages with the statutory minimum.
      </Text>
    );
  }
  if (!employment) return null;

  const selected = employment.classes.find((c) => c.id === value);
  const unit = selected?.rate_type === "monthly" ? "month" : "day";

  return (
    <View>
      <SelectField
        label="Minimum-wage class"
        value={value != null ? String(value) : NONE}
        options={[
          { label: "No class -- skip minimum-wage check", value: NONE },
          ...employment.classes.map((c) => ({ label: c.name, value: String(c.id) })),
        ]}
        onChange={(v) => onChange(v === NONE ? null : Number(v))}
      />
      {selected?.minimum != null && (
        <Text style={styles.hint}>
          Statutory minimum: {formatRupees(selected.minimum)}/{unit} (Basic {formatRupees(selected.basic ?? 0)} + DA)
          {employment.da_verified === false ? " -- DA pending official verification" : ""}
        </Text>
      )}
      {check?.available && check.meets === false && (
        <Text style={styles.warn}>
          Below minimum wage: {formatRupees(check.proposed ?? 0)}/{check.unit} vs {formatRupees(check.minimum ?? 0)}/
          {check.unit} (short by {formatRupees(check.shortfall ?? 0)}). Basic + DA are compared.
        </Text>
      )}
      {check?.available && check.meets === true && <Text style={styles.ok}>Meets the statutory minimum wage.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
  warn: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.warningTintText,
    backgroundColor: colors.warningTint,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  ok: { fontSize: 12, fontWeight: "700", color: colors.present, marginBottom: spacing.sm },
});
