import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Briefcase, Contact, ShieldCheck, Wallet } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ApiError,
  BiometricConsent,
  WorkerCompliance,
  createWorkerCompliance,
  getBiometricConsent,
  getWorker,
  getWorkerCompliance,
  recordWagePayment,
  updateWorkerCompliance,
} from "../api/client";
import DateField, { addYearsIso, isoDate } from "../components/DateField";
import ErrorState from "../components/ErrorState";
import KeyboardScreen from "../components/KeyboardScreen";
import { ListSkeleton } from "../components/Skeleton";
import { Avatar } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

// Matches the backend's MINIMUM_WORKING_AGE (main.py).
const MINIMUM_WORKING_AGE = 14;

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
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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
  const [workerDob, setWorkerDob] = useState<string | null>(null);
  const [biometricConsent, setBiometricConsent] = useState<BiometricConsent | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [worker, consent] = await Promise.all([getWorker(token, workerId), getBiometricConsent(token, workerId)]);
    setWorkerDob(worker.dob);
    setBiometricConsent(consent);
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
      // A real 404 means no compliance record yet (e.g. a worker
      // registered before Phase 3 shipped) -- fall through to the create
      // form, that's expected. Anything else (network failure, 500, ...)
      // used to be treated the same way, which silently dropped an
      // *existing* compliance record from view and would have sent a
      // "Save" straight into a 409 conflict against the record it never
      // showed. Only a genuine 404 is a non-error here.
      if (e instanceof ApiError && e.status === 404) {
        setExists(false);
      } else {
        throw e;
      }
    }
  }, [token, workerId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .then(() => setLoadError(false))
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }, [load]),
  );

  // Same 5 fields and "x of 5" scheme as WorkerProfileScreen's own
  // completeness calculation -- kept in sync by hand since each screen
  // loads compliance independently.
  const completeness = useMemo(() => {
    const fields = compliance
      ? [compliance.father_or_spouse_name, compliance.designation_or_nature_of_work, compliance.epf_uan_no, compliance.esic_no, compliance.date_of_joining]
      : [];
    const filled = fields.filter((f) => !!f && f.trim() !== "").length;
    return { filled, total: 5 };
  }, [compliance]);

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
        <ListSkeleton rows={2} variant="simple" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  const showWarningsCard = !!compliance || isActive;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <KeyboardScreen contentContainerStyle={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerIdentity}>
              <Avatar workerId={workerId} name={workerName} size={48} />
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.headerName} numberOfLines={1}>{workerName}</Text>
                <Text style={styles.headerSubtitle}>Form 12 details</Text>
              </View>
            </View>
            {isActive && (
              <TouchableOpacity
                style={styles.wagePill}
                onPress={() => navigation.navigate("WageProfile", { workerId, workerName })}
              >
                <Text style={styles.wagePillText}>Wage rate</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round((completeness.filled / completeness.total) * 100)}%` as `${number}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{completeness.filled} of {completeness.total} key fields filled</Text>
        </View>

        {!isActive && (
          <View style={styles.deactivatedBanner}>
            <Text style={styles.deactivatedBannerText}>
              This worker was deactivated{deactivatedAt ? ` on ${deactivatedAt.slice(0, 10)}` : ""}. Details are
              read-only.
            </Text>
          </View>
        )}

        {showWarningsCard && (
          <View style={styles.warningsCard}>
            {compliance && (
              <View style={styles.badgeRow}>
                <View style={[styles.badge, compliance.category === "young_person" ? styles.badgeAmber : styles.badgeTeal]}>
                  <Text style={styles.badgeText}>{compliance.category === "young_person" ? "Young person" : "Adult"}</Text>
                </View>
              </View>
            )}
            {compliance?.under_minimum_age_warning && (
              <Text style={styles.warningText}>
                This worker appears to be under the legal minimum working age ({MINIMUM_WORKING_AGE}) -- please verify the date of
                birth.
              </Text>
            )}
            {isActive && (
              <View style={styles.consentRow}>
                <Text style={styles.consentLabel}>Biometric consent</Text>
                {biometricConsent ? (
                  <Text style={styles.consentCaptured}>Captured on {biometricConsent.consented_at.slice(0, 10)}</Text>
                ) : (
                  <TouchableOpacity
                    style={styles.consentButton}
                    onPress={() => navigation.navigate("BiometricConsent", { workerId, workerName, returnTo: true })}
                  >
                    <Text style={styles.consentButtonText}>Capture consent</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        <FieldCard title="Identity" icon={Contact}>
          {compliance?.worker_code && (
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Working ID / Token no.</Text>
              <Text style={styles.readOnlyValue}>{compliance.worker_code}</Text>
            </View>
          )}
          <Field label="Father / Spouse name" value={fatherOrSpouseName} onChangeText={setFatherOrSpouseName} disabled={!isActive} />
        </FieldCard>

        <FieldCard title="Work" icon={Briefcase}>
          <Field label="Designation / nature of work" value={designation} onChangeText={setDesignation} disabled={!isActive} />
          <DateField
            label="Date of entry into service"
            value={dateOfJoining}
            onChange={setDateOfJoining}
            disabled={!isActive}
            minDate={workerDob ? addYearsIso(workerDob, MINIMUM_WORKING_AGE) : undefined}
            maxDate={isoDate(new Date())}
          />
          <DateField label="Date made permanent" value={dateMadePermanent} onChange={setDateMadePermanent} disabled={!isActive} />
          <Field label="Period of suspension, if any" value={suspensionPeriod} onChangeText={setSuspensionPeriod} disabled={!isActive} />
        </FieldCard>

        <FieldCard title="Statutory" icon={ShieldCheck}>
          <View style={styles.gridRow}>
            <View style={styles.gridCell}>
              <Field label="EPF / UAN no." value={epfUanNo} onChangeText={setEpfUanNo} disabled={!isActive} />
            </View>
            <View style={styles.gridCell}>
              <Field label="ESIC no." value={esicNo} onChangeText={setEsicNo} disabled={!isActive} />
            </View>
          </View>

          {compliance?.category === "young_person" && (
            <>
              <Text style={styles.sectionLabelAmber}>Young person -- certificate of fitness</Text>
              <Field label="Fitness certificate no." value={fitnessCertNo} onChangeText={setFitnessCertNo} disabled={!isActive} />
              <DateField label="Valid till" value={fitnessCertValidTill} onChange={setFitnessCertValidTill} disabled={!isActive} />
            </>
          )}
        </FieldCard>

        {isActive && (
          <FieldCard title="Bank & payments" icon={Wallet}>
            <Text style={styles.cardHelper}>Mark wages as paid for a month.</Text>
            <View style={styles.gridRow}>
              <View style={styles.gridCell}>
                <Field label="Month" value={paymentMonth} onChangeText={setPaymentMonth} placeholder="9" />
              </View>
              <View style={styles.gridCell}>
                <Field label="Year" value={paymentYear} onChangeText={setPaymentYear} placeholder="2026" />
              </View>
            </View>
            <DateField label="Date of payment" value={dateOfPayment} onChange={setDateOfPayment} />
            <Field label="Bank transaction ID / reference" value={paymentReference} onChangeText={setPaymentReference} />
            <TouchableOpacity
              style={[styles.secondaryButton, savingPayment && styles.buttonDisabled]}
              onPress={handleRecordPayment}
              disabled={savingPayment}
            >
              {savingPayment ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryButtonText}>Record payment</Text>}
            </TouchableOpacity>
          </FieldCard>
        )}
      </KeyboardScreen>

      {isActive && (
        <View style={styles.stickyFooter}>
          <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.buttonText}>Save</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function FieldCard({ title, icon: Icon, children }: { title: string; icon: typeof Briefcase; children: React.ReactNode }) {
  return (
    <View style={styles.fieldCard}>
      <View style={styles.fieldCardTitleRow}>
        <Icon size={16} color={colors.primary} />
        <Text style={styles.fieldCardTitle}>{title}</Text>
      </View>
      {children}
    </View>
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
        placeholderTextColor={colors.textSecondary}
        editable={!disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 110 },
  header: {
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  headerIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  headerName: { fontFamily: "IBMPlexSans_700Bold", fontSize: 18, color: colors.surface },
  headerSubtitle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.onPrimaryMuted, marginTop: 1 },
  wagePill: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  wagePillText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.surface },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.heroDivider, marginTop: spacing.md, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.surface },
  progressLabel: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.onPrimaryMuted, marginTop: 6 },
  deactivatedBanner: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  deactivatedBannerText: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.danger },
  warningsCard: {
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  badgeRow: { flexDirection: "row" },
  badge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTeal: { backgroundColor: colors.primaryTint },
  badgeAmber: { backgroundColor: colors.warningBorder },
  badgeText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.navy },
  warningText: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.warningTintText },
  consentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  consentLabel: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.navy },
  consentCaptured: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary },
  consentButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  consentButtonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.surface },
  fieldCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  fieldCardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md },
  fieldCardTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  cardHelper: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  sectionLabelAmber: {
    fontFamily: "IBMPlexSans_700Bold",
    fontSize: 12,
    color: colors.warning,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
  },
  gridRow: { flexDirection: "row", gap: spacing.sm },
  gridCell: { flex: 1 },
  fieldWrap: { marginBottom: spacing.md },
  label: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    borderWidth: 0,
    backgroundColor: colors.ground,
    borderRadius: radius.sm,
    padding: 12,
    minHeight: 48,
    fontFamily: "IBMPlexSans_600SemiBold",
    fontSize: 15,
    color: colors.navy,
  },
  inputDisabled: { opacity: 0.6 },
  readOnlyValue: {
    backgroundColor: colors.ground,
    borderRadius: radius.sm,
    padding: 12,
    minHeight: 48,
    fontFamily: "IBMPlexSans_600SemiBold",
    fontSize: 15,
    color: colors.textSecondary,
    textAlignVertical: "center",
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.primary },
  stickyFooter: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.surface },
});
