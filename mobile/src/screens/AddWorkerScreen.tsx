import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  ApiError,
  WorkerType,
  assignWorkerType,
  createWageProfile,
  createWorker,
  createWorkerCompliance,
  listWorkerTypes,
  scanAadhaar,
} from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import KeyboardScreen from "../components/KeyboardScreen";
import SelectField from "../components/SelectField";
import WorkerTypeSelect from "../components/WorkerTypeSelect";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "NewWorkerScan">;

const GENDER_OPTIONS = [
  { label: "Male", value: "Male" },
  { label: "Female", value: "Female" },
  { label: "Other", value: "Other" },
];

// OCR text doesn't reliably come back as exactly "Male"/"Female"/"Other"
// -- normalize onto one of the three canonical values the dropdown
// offers, or drop it if it doesn't match anything recognizable.
function normalizeGender(raw: string | null): string {
  const g = (raw ?? "").trim().toLowerCase();
  if (g.startsWith("m")) return "Male";
  if (g.startsWith("f")) return "Female";
  if (g) return "Other";
  return "";
}

// Client-side estimate only, for immediate UI feedback before anything
// is saved -- the server recomputes this authoritatively from Worker.dob.
function estimateCategory(dob: string): { category: "adult" | "young_person"; underMinimumAge: boolean } | null {
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

// Replaces the old 4-screen flow (Scan -> Details -> Form 12 -> Consent)
// with 2: this screen does scan+basics+compliance+wage all at once, then
// Biometric Consent stays its own screen since it's a distinct DPDP
// legal-consent action, not just another form section. Compliance and
// wage sections are collapsed by default and fully optional -- an owner
// who doesn't have EPF/UAN numbers or a wage rate on hand yet can save
// with just Name + Aadhaar and fill the rest in later (the existing
// "N workers need Form 12 details" dashboard reminder, and the standalone
// Wage Rate screen, both still work exactly as before for that).
export default function AddWorkerScreen({ navigation }: Props) {
  const { token } = useAuth();

  // --- Scan ---
  // Manual entry starts with the scan UI hidden -- it was previously
  // always shown even for an owner who explicitly chose to skip
  // scanning and type everything in by hand, which made the scan boxes
  // and "Scan Now" button irrelevant clutter on top of the real form.
  const [manualEntry, setManualEntry] = useState(false);
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [ocrMissed, setOcrMissed] = useState({ name: false, dob: false, gender: false, aadhaar_number: false, current_address: false });

  // --- Basics ---
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [currentAddress, setCurrentAddress] = useState("");
  const [mobile, setMobile] = useState("");

  // --- Compliance (Form 12), collapsed by default ---
  const [complianceOpen, setComplianceOpen] = useState(false);
  const [fatherOrSpouseName, setFatherOrSpouseName] = useState("");
  const [designation, setDesignation] = useState("");
  const [epfUanNo, setEpfUanNo] = useState("");
  const [esicNo, setEsicNo] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [fitnessCertNo, setFitnessCertNo] = useState("");
  const [fitnessCertValidTill, setFitnessCertValidTill] = useState("");

  // --- Wage rate, collapsed by default ---
  const [wageOpen, setWageOpen] = useState(false);
  const [workerTypes, setWorkerTypes] = useState<WorkerType[]>([]);
  const [selectedWorkerTypeId, setSelectedWorkerTypeId] = useState<number | null>(null);
  const [rateType, setRateType] = useState<"daily" | "monthly">("daily");
  const [basic, setBasic] = useState("");
  const [hra, setHra] = useState("");
  const [da, setDa] = useState("");
  const [otherAllowances, setOtherAllowances] = useState("");
  const [pfRate, setPfRate] = useState("");
  const [esiRate, setEsiRate] = useState("");
  const [lwfAmount, setLwfAmount] = useState("");

  const [saving, setSaving] = useState(false);

  const estimate = useMemo(() => estimateCategory(dob), [dob]);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      listWorkerTypes(token)
        .then(setWorkerTypes)
        .catch(() => {});
    }, [token]),
  );

  async function captureImage(setter: (uri: string) => void) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera permission needed", "Enable camera access to scan the Aadhaar card.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: false });
    if (!result.canceled && result.assets[0]) {
      setter(result.assets[0].uri);
    }
  }

  async function handleScanNow() {
    if (!frontUri) {
      Alert.alert("Front side required", "Scan the front of the Aadhaar card first.");
      return;
    }
    if (!token) return;
    setScanning(true);
    try {
      const fields = await scanAadhaar(token, frontUri, backUri);
      setName(fields.name ?? "");
      setDob(fields.dob ?? "");
      setGender(normalizeGender(fields.gender));
      setAadhaarNumber(fields.aadhaar_number ?? "");
      setCurrentAddress(fields.current_address ?? "");
      setOcrMissed({
        name: !fields.name,
        dob: !fields.dob,
        gender: !fields.gender,
        aadhaar_number: !fields.aadhaar_number,
        current_address: !fields.current_address,
      });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Scan failed", message);
    } finally {
      setScanning(false);
    }
  }

  async function handleSave() {
    if (!name.trim() || !aadhaarNumber.trim()) {
      Alert.alert("Missing required fields", "Name and Aadhaar number are required.");
      return;
    }
    if (!token) return;
    setSaving(true);
    const warnings: string[] = [];
    try {
      const created = await createWorker(token, {
        name: name.trim(),
        aadhaar_number: aadhaarNumber.replace(/\s/g, ""),
        dob: dob.trim() || undefined,
        gender: gender.trim() || undefined,
        mobile: mobile.trim() || undefined,
        current_address: currentAddress.trim() || undefined,
      });

      const complianceFilled = [fatherOrSpouseName, designation, epfUanNo, esicNo, dateOfJoining, fitnessCertNo, fitnessCertValidTill].some(
        (v) => v.trim(),
      );
      if (complianceFilled) {
        try {
          await createWorkerCompliance(token, created.id, {
            father_or_spouse_name: fatherOrSpouseName.trim() || undefined,
            designation_or_nature_of_work: designation.trim() || undefined,
            epf_uan_no: epfUanNo.trim() || undefined,
            esic_no: esicNo.trim() || undefined,
            date_of_joining: dateOfJoining.trim() || undefined,
            fitness_cert_no: fitnessCertNo.trim() || undefined,
            fitness_cert_valid_till: fitnessCertValidTill.trim() || undefined,
          });
        } catch {
          warnings.push("compliance details");
        }
      }

      if (selectedWorkerTypeId) {
        try {
          await assignWorkerType(token, created.id, selectedWorkerTypeId);
        } catch {
          warnings.push("worker type");
        }
      }

      if (basic.trim()) {
        try {
          await createWageProfile(token, created.id, {
            rate_type: rateType,
            basic: parseFloat(basic) || 0,
            hra: parseFloat(hra) || 0,
            da: parseFloat(da) || 0,
            other_allowances: parseFloat(otherAllowances) || 0,
            pf_rate: parseFloat(pfRate) || 0,
            esi_rate: parseFloat(esiRate) || 0,
            lwf_amount: parseFloat(lwfAmount) || 0,
            effective_from: isoDate(new Date()),
          });
        } catch {
          warnings.push("wage rate");
        }
      }

      if (warnings.length > 0) {
        Alert.alert(
          "Worker saved, with one issue",
          `${created.name} was saved, but the ${warnings.join(" and ")} didn't save -- add ${warnings.length === 1 ? "it" : "them"} later from the worker's own screen.`,
        );
      }
      navigation.navigate("BiometricConsent", { workerId: created.id, workerName: created.name, fromRegistration: true });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Add Worker</Text>

      {manualEntry ? (
        <TouchableOpacity style={styles.switchToScanLink} onPress={() => setManualEntry(false)}>
          <Text style={styles.switchLinkText}>Scan Aadhaar instead</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity style={styles.scanBox} onPress={() => captureImage(setFrontUri)}>
            {frontUri ? <Image source={{ uri: frontUri }} style={styles.preview} /> : <Text style={styles.scanBoxLabel}>Scan Front</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.scanBox} onPress={() => captureImage(setBackUri)}>
            {backUri ? <Image source={{ uri: backUri }} style={styles.preview} /> : <Text style={styles.scanBoxLabel}>Scan Back</Text>}
          </TouchableOpacity>
          <Text style={styles.hint}>Position the card within the frame. Both sides help extraction, but only the front is required.</Text>
          <TouchableOpacity style={[styles.scanButton, (scanning || !frontUri) && styles.buttonDisabled]} onPress={handleScanNow} disabled={scanning || !frontUri}>
            {scanning ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Scan Now</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.switchToManualLink} onPress={() => setManualEntry(true)}>
            <Text style={styles.switchLinkText}>Enter details manually instead</Text>
          </TouchableOpacity>
        </>
      )}

      <Text style={styles.sectionLabelTeal}>Worker details</Text>
      <Field label="Name" value={name} onChangeText={setName} needsReview={ocrMissed.name} />
      <DateField label="Date of birth" value={dob} onChange={setDob} placeholder="Select date" />
      {estimate?.underMinimumAge && (
        <Text style={styles.warningText}>
          This worker appears to be under the legal minimum working age (14) -- please verify the date of birth. This
          does not block saving.
        </Text>
      )}
      <SelectField label="Gender" value={gender || null} options={GENDER_OPTIONS} onChange={setGender} placeholder="Select" />
      <Field label="Aadhaar number" value={aadhaarNumber} onChangeText={setAadhaarNumber} needsReview={ocrMissed.aadhaar_number} keyboardType="number-pad" />
      <Field label="Current address" value={currentAddress} onChangeText={setCurrentAddress} needsReview={ocrMissed.current_address} />
      <Field label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />

      <TouchableOpacity style={styles.sectionToggle} onPress={() => setComplianceOpen((v) => !v)}>
        <Text style={styles.sectionToggleText}>{complianceOpen ? "▾" : "▸"} Compliance details (Form 12)</Text>
      </TouchableOpacity>
      {complianceOpen && (
        <View style={styles.sectionBody}>
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
        </View>
      )}

      <TouchableOpacity style={styles.sectionToggle} onPress={() => setWageOpen((v) => !v)}>
        <Text style={styles.sectionToggleText}>{wageOpen ? "▾" : "▸"} Wage rate (optional)</Text>
      </TouchableOpacity>
      {wageOpen && (
        <View style={styles.sectionBody}>
          <WorkerTypeSelect
            label="Worker Type"
            token={token ?? ""}
            workerTypes={workerTypes}
            value={selectedWorkerTypeId}
            onChange={setSelectedWorkerTypeId}
            onCreated={(created) => setWorkerTypes((prev) => [...prev, created])}
            noneLabel="No type -- set a custom rate below"
          />
          <View style={styles.toggleRow}>
            {(["daily", "monthly"] as const).map((option) => (
              <TouchableOpacity key={option} style={[styles.toggleOption, rateType === option && styles.toggleOptionSelected]} onPress={() => setRateType(option)}>
                <Text style={[styles.toggleText, rateType === option && styles.toggleTextSelected]}>{option === "daily" ? "Daily rate" : "Monthly rate"}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Field label="Basic wage" value={basic} onChangeText={setBasic} keyboardType="numeric" />
          <Field label="HRA" value={hra} onChangeText={setHra} keyboardType="numeric" />
          <Field label="DA" value={da} onChangeText={setDa} keyboardType="numeric" />
          <Field label="Other allowances" value={otherAllowances} onChangeText={setOtherAllowances} keyboardType="numeric" />
          <Field label="PF rate (%)" value={pfRate} onChangeText={setPfRate} keyboardType="numeric" />
          <Field label="ESI rate (%)" value={esiRate} onChangeText={setEsiRate} keyboardType="numeric" />
          <Field label="LWF amount (flat, per month)" value={lwfAmount} onChangeText={setLwfAmount} keyboardType="numeric" />
        </View>
      )}

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save Worker</Text>}
      </TouchableOpacity>
    </KeyboardScreen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  needsReview,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  needsReview?: boolean;
  keyboardType?: "default" | "number-pad" | "phone-pad" | "numeric";
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>
        {label}
        {needsReview ? "  · not found by scan, please fill in" : ""}
      </Text>
      <TextInput
        style={[styles.input, needsReview && styles.inputNeedsReview]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: spacing.md, color: colors.navy },
  scanBox: {
    height: 140,
    borderWidth: 1.5,
    borderColor: colors.teal,
    backgroundColor: colors.tealLight,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  scanBoxLabel: { fontSize: 15, color: colors.teal, fontWeight: "700" },
  preview: { width: "100%", height: "100%" },
  hint: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm, textAlign: "center" },
  scanButton: { backgroundColor: colors.teal, borderRadius: radius.sm, padding: 14, alignItems: "center", marginBottom: spacing.md },
  switchToManualLink: { alignItems: "center", paddingVertical: spacing.xs, marginBottom: spacing.sm },
  switchToScanLink: { alignItems: "center", paddingVertical: spacing.sm, marginBottom: spacing.sm },
  switchLinkText: { color: colors.teal, fontWeight: "700", fontSize: 13 },
  sectionLabelTeal: { fontSize: 12, fontWeight: "700", color: colors.teal, marginTop: spacing.sm, marginBottom: spacing.sm, textTransform: "uppercase" },
  sectionLabelAmber: { fontSize: 12, fontWeight: "700", color: colors.amber, marginTop: spacing.sm, marginBottom: spacing.sm, textTransform: "uppercase" },
  sectionToggle: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: spacing.sm + 4, marginTop: spacing.md },
  sectionToggleText: { fontSize: 14, fontWeight: "700", color: colors.navy },
  sectionBody: { paddingTop: spacing.md },
  warningText: { fontSize: 12, color: colors.danger, backgroundColor: colors.dangerLight, padding: spacing.sm, borderRadius: radius.sm, marginBottom: spacing.md },
  toggleRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  toggleOption: { flex: 1, backgroundColor: colors.fieldBg, borderRadius: radius.sm, paddingVertical: 12, alignItems: "center" },
  toggleOptionSelected: { backgroundColor: colors.teal },
  toggleText: { fontSize: 13, fontWeight: "600", color: colors.navy },
  toggleTextSelected: { color: colors.white },
  fieldWrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: { borderWidth: 0, backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, fontSize: 16, color: colors.navy },
  inputNeedsReview: { borderWidth: 1.5, borderColor: colors.amber, backgroundColor: colors.amberPale },
  button: { backgroundColor: colors.teal, borderRadius: radius.sm, padding: 16, alignItems: "center", marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
