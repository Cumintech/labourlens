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
  // Reports the live comparison to the parent (null while unknown / no class), so a form can block saving below the minimum.
  onCheck?: (check: MinimumWageCheck | null) => void;
};

const NONE = "none";
const formatRupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Picks the worker's statutory minimum-wage class (Basic + DA, per the
// factory's employment) and warns when the proposed salary is below it.
// The minimum always comes from the server, never computed or hardcoded here.
export default function MinimumWageClassSelect({ token, employmentId, value, onChange, rate, onCheck }: Props) {
  const [employment, setEmployment] = useState<MinimumWageEmployment | null>(null);
  const [check, setCheck] = useState<MinimumWageCheck | null>(null);
  useEffect(() => {
    onCheck?.(check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);

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
    setCheck(null);
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
  // The same minimum in the unit the owner is entering (monthly class entered daily, or a daily class entered
  // monthly), using the divisor the server publishes -- so the owner knows what to type in the empty field.
  const divisor = employment.monthly_to_daily_divisor ?? 26;
  let expectedInYourUnit = "";
  if (selected?.minimum != null && !selected.piece_rate && rateType) {
    if (selected.rate_type === "monthly" && rateType === "daily") expectedInYourUnit = `${formatRupees(selected.minimum / divisor)}/day`;
    else if (selected.rate_type === "monthly" && rateType === "weekly") expectedInYourUnit = `${formatRupees((selected.minimum / divisor) * 6)}/week`;
    else if (selected.rate_type === "daily" && rateType === "monthly") expectedInYourUnit = `${formatRupees(selected.minimum * divisor)}/month`;
    else if (selected.rate_type === "daily" && rateType === "weekly") expectedInYourUnit = `${formatRupees(selected.minimum * 6)}/week`;
  }

  // Classes are listed under the notification's own headings (Group I - Skilled, ...)
  const options: { label: string; value: string; header?: boolean }[] = [
    { label: "No class -- skip minimum-wage check", value: NONE },
  ];
  let lastGroup: string | null | undefined;
  for (const c of employment.classes) {
    if (c.group_name && c.group_name !== lastGroup) options.push({ label: c.group_name, value: `__group_${c.group_name}`, header: true });
    lastGroup = c.group_name;
    options.push({ label: c.piece_rate ? `${c.name} (per ${c.unit})` : c.name, value: String(c.id) });
  }

  return (
    <View>
      <SelectField
        label="Minimum-wage class"
        value={value != null ? String(value) : NONE}
        options={options}
        onChange={(v) => onChange(v === NONE ? null : Number(v))}
      />
      {selected?.piece_rate && (
        <Text style={styles.hint}>
          Piece-rate work: published at {formatRupees(selected.basic ?? 0)} per {selected.unit}. The minimum wage is not checked
          automatically for piece rates.
        </Text>
      )}
      {selected?.minimum != null && (
        <Text style={styles.hint}>
          Statutory minimum: {formatRupees(selected.minimum)}/{unit} (Basic {formatRupees(selected.basic ?? 0)} + DA)
          {expectedInYourUnit ? ` = about ${expectedInYourUnit}` : ""}
          {employment.da_verified === false ? " -- DA pending official verification" : ""}
          {employment.da_stale ? " -- DA is for the period ending " + (employment.da_valid_to ?? "") + "; the next revision is not entered yet" : ""}
        </Text>
      )}
      {check?.available && check.meets === false && (
        <Text style={styles.error}>
          Minimum wage not met:
          {" "}{formatRupees(check.proposed ?? 0)}/{check.unit} offered vs {formatRupees(check.minimum ?? 0)}/
          {check.unit} required (short by {formatRupees(check.shortfall ?? 0)}). Basic + DA are compared. You can raise the wage or continue anyway (it will be flagged on the worker's compliance card).
        </Text>
      )}
      {check?.available && check.meets === true && <Text style={styles.ok}>Meets the statutory minimum wage.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
  error: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.absentTintText,
    backgroundColor: colors.absentTint,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  ok: { fontSize: 12, fontWeight: "700", color: colors.present, marginBottom: spacing.sm },
});
