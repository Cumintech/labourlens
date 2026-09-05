import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  ApiError,
  WorkerCompliance,
  createWorkerCompliance,
  getWorkerCompliance,
  recordWagePayment,
  updateWorkerCompliance,
} from "../api/client";
import DateField from "../components/DateField";
import KeyboardScreen from "../components/KeyboardScreen";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "WorkerEdit">;

// Didn't exist before Phase 3 Day 1 -- the only way to touch a worker's
// record after registration was Dashboard's Deactivate action. This is
// where Form 12 fields get filled in or corrected later (EPF/ESIC often
// arrive after joining, "made permanent" happens well after
// registration), and where Day 2's wage/leave screens will hang off of.
export default function WorkerEditScreen({ route, navigation }: Props) {
  const { workerId, workerName, workerStatus, deactivatedAt } = route.params;
  const isActive = workerStatus === "active";
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);

  const now = new Date();
  const [paymentMonth, setPaymentMonth] = useState(String(now.getMonth() + 1));
  const [paymentYear, setPaymentYear] = useState(String(now.getFullYear()));
  const [dateOfPayment, setDateOfPayment] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  const [fatherOrSpouseName, setFatherOrSpouseName] = useState("");
  const [designation, setDesignation] = useState("");
  const [epfUanNo, setEpfUanNo] = useState("");
  const [esicNo, setEsicNo] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [dateMadePermanent, setDateMadePermanent] = useState("");
  const [suspensionPeriod, setSuspensionPeriod] = useState("");
  const [fitnessCertNo, setFitnessCertNo] = useState("");
  const [fitnessCertValidTill, setFitnessCertValidTill] = useState("");
  const [compliance, setCompliance] = useState<WorkerCompliance | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const c = await getWorkerCompliance(token, workerId);
      setCompliance(c);
      setExists(true);
      setFatherOrSpouseName(c.father_or_spouse_name ?? "");
      setDesignation(c.designation_or_nature_of_work ?? "");
      setEpfUanNo(c.epf_uan_no ?? "");
      setEsicNo(c.esic_no ?? "");
      setDateOfJoining(c.date_of_joining ?? "");
      setDateMadePermanent(c.date_made_permanent ?? "");
      setSuspensionPeriod(c.suspension_period ?? "");
      setFitnessCertNo(c.fitness_cert_no ?? "");
      setFitnessCertValidTill(c.fitness_cert_valid_till ?? "");
    } catch (e) {
      // No compliance record yet (e.g. a worker registered before Phase 3
      // shipped) -- fall through to the create form instead of erroring.
      setExists(false);
    }
  }, [token, workerId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load]),
  );

  async function handleSave() {
    if (!token) return;
    const input = {
      // worker_code intentionally omitted -- auto-generated, never
      // editable, and exclude_unset on the backend means leaving it out
      // here never wipes the existing value.
      father_or_spouse_name: fatherOrSpouseName.trim() || undefined,
      designation_or_nature_of_work: designation.trim() || undefined,
      epf_uan_no: epfUanNo.trim() || undefined,
      esic_no: esicNo.trim() || undefined,
      date_of_joining: dateOfJoining.trim() || undefined,
      date_made_permanent: dateMadePermanent.trim() || undefined,
      suspension_period: suspensionPeriod.trim() || undefined,
      fitness_cert_no: fitnessCertNo.trim() || undefined,
      fitness_cert_valid_till: fitnessCertValidTill.trim() || undefined,
    };
    setSaving(true);
    try {
      const updated = exists
        ? await updateWorkerCompliance(token, workerId, input)
        : await createWorkerCompliance(token, workerId, input);
      setCompliance(updated);
      setExists(true);
      Alert.alert("Saved", "Worker details updated.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRecordPayment() {
    if (!token) return;
    const month = parseInt(paymentMonth, 10);
    const year = parseInt(paymentYear, 10);
    if (!month || !year) {
      Alert.alert("Missing fields", "Month and year are required.");
      return;
    }
    setSavingPayment(true);
    try {
      await recordWagePayment(token, workerId, {
        month,
        year,
        date_of_payment: dateOfPayment.trim() || undefined,
        payment_reference: paymentReference.trim() || undefined,
      });
      Alert.alert("Saved", `Payment recorded for ${month}/${year}.`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Save failed", message);
    } finally {
      setSavingPayment(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
      </View>
    );
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>{workerName}</Text>
      <Text style={styles.subtitle}>Form 12 details</Text>

      {!isActive && (
        <View style={styles.deactivatedBanner}>
          <Text style={styles.deactivatedBannerText}>
            This worker was deactivated{deactivatedAt ? ` on ${deactivatedAt.slice(0, 10)}` : ""}. Details are
            read-only.
          </Text>
        </View>
      )}

      {isActive && (
        <View style={styles.navLinkRow}>
          <TouchableOpacity
            style={styles.navLinkButton}
            onPress={() => navigation.navigate("WageProfile", { workerId, workerName })}
          >
            <Text style={styles.navLinkText}>Wage rate</Text>
          </TouchableOpacity>
        </View>
      )}

      {compliance && (
        <View style={styles.badgeRow}>
          <View style={[styles.badge, compliance.category === "young_person" ? styles.badgeAmber : styles.badgeTeal]}>
            <Text style={styles.badgeText}>{compliance.category === "young_person" ? "Young person" : "Adult"}</Text>
          </View>
          {compliance.under_minimum_age_warning && (
            <Text style={styles.warningText}>
              This worker appears to be under the legal minimum working age (14) -- please verify the date of
              birth.
            </Text>
          )}
        </View>
      )}

      {compliance?.worker_code && (
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Working ID / Token no.</Text>
          <Text style={styles.readOnlyValue}>{compliance.worker_code}</Text>
        </View>
      )}
      <Field label="Father / Spouse name" value={fatherOrSpouseName} onChangeText={setFatherOrSpouseName} disabled={!isActive} />
      <Field label="Designation / nature of work" value={designation} onChangeText={setDesignation} disabled={!isActive} />
      <Field label="EPF / UAN no." value={epfUanNo} onChangeText={setEpfUanNo} disabled={!isActive} />
      <Field label="ESIC no." value={esicNo} onChangeText={setEsicNo} disabled={!isActive} />
      <DateField label="Date of entry into service" value={dateOfJoining} onChange={setDateOfJoining} disabled={!isActive} />
      <DateField label="Date made permanent" value={dateMadePermanent} onChange={setDateMadePermanent} disabled={!isActive} />
      <Field label="Period of suspension, if any" value={suspensionPeriod} onChangeText={setSuspensionPeriod} disabled={!isActive} />

      {compliance?.category === "young_person" && (
        <>
          <Text style={styles.sectionLabelAmber}>Young person -- certificate of fitness</Text>
          <Field label="Fitness certificate no." value={fitnessCertNo} onChangeText={setFitnessCertNo} disabled={!isActive} />
          <DateField label="Valid till" value={fitnessCertValidTill} onChange={setFitnessCertValidTill} disabled={!isActive} />
        </>
      )}

      {isActive && (
        <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save</Text>}
        </TouchableOpacity>
      )}

      {isActive && (
        <>
          <Text style={styles.sectionLabel}>Mark wages as paid</Text>
          <View style={styles.paymentRow}>
            <View style={{ flex: 1 }}>
              <Field label="Month" value={paymentMonth} onChangeText={setPaymentMonth} placeholder="9" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Year" value={paymentYear} onChangeText={setPaymentYear} placeholder="2026" />
            </View>
          </View>
          <DateField label="Date of payment" value={dateOfPayment} onChange={setDateOfPayment} />
          <Field label="Bank transaction ID / reference" value={paymentReference} onChangeText={setPaymentReference} />
          <TouchableOpacity
            style={[styles.button, savingPayment && styles.buttonDisabled]}
            onPress={handleRecordPayment}
            disabled={savingPayment}
          >
            {savingPayment ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Record payment</Text>}
          </TouchableOpacity>
        </>
      )}
    </KeyboardScreen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, disabled && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        editable={!disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  deactivatedBanner: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  deactivatedBannerText: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  navLinkRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  navLinkButton: { flex: 1, backgroundColor: colors.tealLight, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center" },
  navLinkText: { color: "#0F6E56", fontSize: 13, fontWeight: "700" },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.navy, marginTop: spacing.lg, marginBottom: spacing.sm },
  paymentRow: { flexDirection: "row", gap: spacing.sm },
  badgeRow: { marginBottom: spacing.md },
  badge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, marginBottom: spacing.xs },
  badgeTeal: { backgroundColor: colors.tealLight },
  badgeAmber: { backgroundColor: "#FFF8EC" },
  badgeText: { fontSize: 12, fontWeight: "700", color: colors.navy },
  warningText: { fontSize: 12, color: colors.danger, backgroundColor: colors.dangerLight, padding: spacing.sm, borderRadius: radius.sm },
  sectionLabelAmber: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.amber,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
  },
  fieldWrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: {
    borderWidth: 0,
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.navy,
  },
  inputDisabled: { opacity: 0.6 },
  readOnlyValue: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.muted,
  },
  button: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    padding: 16,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
