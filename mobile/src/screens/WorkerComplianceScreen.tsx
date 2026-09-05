import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ApiError, createWorkerCompliance } from "../api/client";
import DateField from "../components/DateField";
import KeyboardScreen from "../components/KeyboardScreen";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "WorkerCompliance">;

// Client-side estimate only, for immediate UI feedback (badge + warning
// banner) before the owner has even saved anything -- the server
// recomputes this authoritatively from Worker.dob on save, this is never
// treated as the final answer.
function estimateCategory(dob: string | null): { category: "adult" | "young_person"; underMinimumAge: boolean } | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return { category: age < 18 ? "young_person" : "adult", underMinimumAge: age < 14 };
}

// This is the last step of the registration flow (Scan -> Manual
// correction -> Compliance -> Save) -- the Worker record was already
// created by NewWorkerDetailsScreen; this screen only adds the Form 12
// fields on top of it.
export default function WorkerComplianceScreen({ route, navigation }: Props) {
  const { workerId, workerName, workerDob } = route.params;
  const { token } = useAuth();
  const estimate = useMemo(() => estimateCategory(workerDob), [workerDob]);

  const [fatherOrSpouseName, setFatherOrSpouseName] = useState("");
  const [designation, setDesignation] = useState("");
  const [epfUanNo, setEpfUanNo] = useState("");
  const [esicNo, setEsicNo] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [fitnessCertNo, setFitnessCertNo] = useState("");
  const [fitnessCertValidTill, setFitnessCertValidTill] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    try {
      await createWorkerCompliance(token, workerId, {
        // worker_code omitted -- the backend auto-generates it (T-001,
        // T-002, ...) so there's nothing for the owner to type here.
        father_or_spouse_name: fatherOrSpouseName.trim() || undefined,
        designation_or_nature_of_work: designation.trim() || undefined,
        epf_uan_no: epfUanNo.trim() || undefined,
        esic_no: esicNo.trim() || undefined,
        date_of_joining: dateOfJoining.trim() || undefined,
        fitness_cert_no: fitnessCertNo.trim() || undefined,
        fitness_cert_valid_till: fitnessCertValidTill.trim() || undefined,
      });
      Alert.alert("Saved", `${workerName} has been registered.`);
      navigation.popToTop();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Form 12 details</Text>
      <Text style={styles.subtitle}>Register of Adult Workers & Young Persons</Text>

      {estimate && (
        <View style={styles.badgeRow}>
          <View style={[styles.badge, estimate.category === "young_person" ? styles.badgeAmber : styles.badgeTeal]}>
            <Text style={styles.badgeText}>{estimate.category === "young_person" ? "Young person" : "Adult"}</Text>
          </View>
          {estimate.underMinimumAge && (
            <Text style={styles.warningText}>
              This worker appears to be under the legal minimum working age (14) -- please verify the date of
              birth. This does not block saving.
            </Text>
          )}
        </View>
      )}

      <Text style={styles.helper}>The worker's ID will be assigned automatically once saved.</Text>
      <Field label="Father / Spouse name" value={fatherOrSpouseName} onChangeText={setFatherOrSpouseName} />
      <Field label="Designation / nature of work" value={designation} onChangeText={setDesignation} />
      <Field label="EPF / UAN no." value={epfUanNo} onChangeText={setEpfUanNo} />
      <Field label="ESIC no." value={esicNo} onChangeText={setEsicNo} />
      <DateField label="Date of entry into service" value={dateOfJoining} onChange={setDateOfJoining} />

      {estimate?.category === "young_person" && (
        <>
          <Text style={styles.sectionLabelAmber}>Young person -- certificate of fitness</Text>
          <Field label="Fitness certificate no." value={fitnessCertNo} onChangeText={setFitnessCertNo} />
          <DateField label="Valid till" value={fitnessCertValidTill} onChange={setFitnessCertValidTill} />
        </>
      )}

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save & finish</Text>}
      </TouchableOpacity>
    </KeyboardScreen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  helper: { fontSize: 12, color: colors.muted, marginBottom: spacing.md },
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
