import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
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
import SelectField from "../components/SelectField";
import WorkerTypeSelect from "../components/WorkerTypeSelect";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { autofillFromWorkerType } from "../workerTypeAutofill";

type Props = NativeStackScreenProps<RootStackParamList, "NewWorkerScan">;

const GENDER_OPTIONS = [
  { label: "Male", value: "Male" },
  { label: "Female", value: "Female" },
  { label: "Other", value: "Other" },
];

const STEPS = ["Identity", "Compliance", "Wage"] as const;
type Step = 1 | 2 | 3;

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

// Redesigned per add-worker-mockup.html (batch 3) as a 3-step wizard
// (Identity -> Compliance -> Wage) replacing the old single continuous
// scroll -- each step is a focused, shorter task instead of one long
// form where scan UI, Form 12 fields, and wage setup all competed for
// attention at once. "Biometric Consent" is intentionally no longer the
// post-save destination: the spec this was built from explicitly calls
// for landing on Home from every path (scanned/manual, with/without
// wage setup) -- flagged in the implementation summary since it drops
// the dedicated DPDP consent screen from the registration flow.
export default function AddWorkerScreen({ navigation }: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(1);

  // --- Step 1: Identity ---
  const [scanMode, setScanMode] = useState(true);
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [autoFilled, setAutoFilled] = useState({ name: false, dob: false, gender: false, aadhaar_number: false, current_address: false });
  // Worker Details starts hidden -- showing empty Name/DOB/etc. fields
  // above an unstarted scan implied they should be filled in manually
  // first, which fought against the scan-first flow. Revealed by a
  // successful scan (both sides) or by choosing manual entry; once
  // revealed it stays revealed (switching back to "Scan ID card"
  // afterward doesn't hide already-entered data again).
  const [detailsRevealed, setDetailsRevealed] = useState(false);

  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [currentAddress, setCurrentAddress] = useState("");
  const [mobile, setMobile] = useState("");

  // --- Step 2: Compliance (Form 12) ---
  const [fatherOrSpouseName, setFatherOrSpouseName] = useState("");
  const [designation, setDesignation] = useState("");
  const [epfUanNo, setEpfUanNo] = useState("");
  const [esicNo, setEsicNo] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [fitnessCertNo, setFitnessCertNo] = useState("");
  const [fitnessCertValidTill, setFitnessCertValidTill] = useState("");

  // --- Step 3: Wage, optional ---
  const [wageEnabled, setWageEnabled] = useState(true);
  const [workerTypes, setWorkerTypes] = useState<WorkerType[]>([]);
  const [selectedWorkerTypeId, setSelectedWorkerTypeId] = useState<number | null>(null);
  const [typeAutoFilled, setTypeAutoFilled] = useState(false);
  const [rateType, setRateType] = useState<"daily" | "monthly">("daily");
  const [basic, setBasic] = useState("");
  const [pfRate, setPfRate] = useState("");
  const [esiRate, setEsiRate] = useState("");
  const [morePayOpen, setMorePayOpen] = useState(false);
  const [hra, setHra] = useState("");
  const [da, setDa] = useState("");
  const [otherAllowances, setOtherAllowances] = useState("");
  const [lwfAmount, setLwfAmount] = useState("");

  const [saving, setSaving] = useState(false);

  const estimate = useMemo(() => estimateCategory(dob), [dob]);
  const identityValid = name.trim().length > 0 && aadhaarNumber.trim().length > 0;

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      listWorkerTypes(token)
        .then(setWorkerTypes)
        .catch(() => {});
    }, [token]),
  );

  async function captureImage(side: "front" | "back") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera permission needed", "Enable camera access to scan the ID card.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: false });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    if (side === "front") {
      setFrontUri(uri);
      if (backUri) await runScan(uri, backUri);
    } else {
      setBackUri(uri);
      if (frontUri) await runScan(frontUri, uri);
    }
  }

  // Fires automatically once both sides are captured -- both are
  // required before Continue enables anyway, so there's no useful
  // intermediate "scan now" step to gate behind a separate button.
  async function runScan(front: string, back: string) {
    if (!token) return;
    setScanning(true);
    try {
      const fields = await scanAadhaar(token, front, back);
      setName(fields.name ?? "");
      setDob(fields.dob ?? "");
      setGender(normalizeGender(fields.gender));
      setAadhaarNumber(fields.aadhaar_number ?? "");
      setCurrentAddress(fields.current_address ?? "");
      setAutoFilled({
        name: !!fields.name,
        dob: !!fields.dob,
        gender: !!fields.gender,
        aadhaar_number: !!fields.aadhaar_number,
        current_address: !!fields.current_address,
      });
      setDetailsRevealed(true);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Scan failed", message);
    } finally {
      setScanning(false);
    }
  }

  function handleSelectWorkerType(typeId: number | null) {
    setSelectedWorkerTypeId(typeId);
    const type = workerTypes.find((t) => t.id === typeId);
    if (type) {
      const filled = autofillFromWorkerType(type, { basic, pfRate });
      setRateType(filled.rateType);
      setBasic(filled.basic);
      setPfRate(filled.pfRate);
      setTypeAutoFilled(true);
    } else {
      setTypeAutoFilled(false);
    }
  }

  function goContinue() {
    if (step === 1) {
      if (!identityValid) {
        Alert.alert("Missing required fields", "Name and Aadhaar number are required.");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else {
      handleSave();
    }
  }

  function goBack() {
    if (step === 1) {
      navigation.goBack();
    } else {
      setStep((s) => (s - 1) as Step);
    }
  }

  async function handleSave() {
    if (!identityValid || !token) return;
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

      if (wageEnabled) {
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
      }

      if (warnings.length > 0) {
        Alert.alert(
          "Worker saved, with one issue",
          `${created.name} was saved, but the ${warnings.join(" and ")} didn't save -- add ${warnings.length === 1 ? "it" : "them"} later from the worker's own screen.`,
        );
      }
      navigation.navigate("Home");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
    }
  }

  const step1Continueable = detailsRevealed && identityValid;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
      <View style={styles.header}>
        <View style={styles.stepsRow}>
          {STEPS.map((label, i) => {
            const n = (i + 1) as Step;
            const done = n < step;
            const current = n === step;
            return (
              <View key={label} style={styles.stepItem}>
                <View style={[styles.stepBar, done && styles.stepBarDone, current && styles.stepBarCurrent]} />
                <Text style={[styles.stepLabel, done && styles.stepLabelDone, current && styles.stepLabelCurrent]}>{label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        {step === 1 && (
          <>
            <View style={styles.segToggle}>
              <TouchableOpacity style={[styles.segOption, scanMode && styles.segOptionActive]} onPress={() => setScanMode(true)}>
                <Text style={[styles.segText, scanMode && styles.segTextActive]}>Scan ID card</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segOption, !scanMode && styles.segOptionActive]}
                onPress={() => {
                  setScanMode(false);
                  setDetailsRevealed(true);
                }}
              >
                <Text style={[styles.segText, !scanMode && styles.segTextActive]}>Enter manually</Text>
              </TouchableOpacity>
            </View>

            {scanMode && (
              <>
                <View style={styles.scanRow}>
                  <TouchableOpacity style={styles.scanCard} onPress={() => captureImage("front")}>
                    {frontUri ? (
                      <>
                        <Image source={{ uri: frontUri }} style={styles.scanPreview} resizeMode="cover" />
                        <Text style={styles.scanDoneText}>✓ Front scanned</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.scanEmoji}>📷</Text>
                        <Text style={styles.scanCardLabel}>Scan front of ID</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.scanCard} onPress={() => captureImage("back")}>
                    {backUri ? (
                      <>
                        <Image source={{ uri: backUri }} style={styles.scanPreview} resizeMode="cover" />
                        <Text style={styles.scanDoneText}>✓ Back scanned</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.scanEmoji}>📷</Text>
                        <Text style={styles.scanCardLabel}>Scan back of ID</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
                <Text style={styles.hint}>
                  {scanning ? "Reading the card…" : "Both front and back are required -- scanning fills in the fields below automatically."}
                </Text>
              </>
            )}

            {detailsRevealed && (
              <Animated.View entering={FadeInDown.duration(300)}>
                <Text style={styles.sectionTitle}>Worker details</Text>
                <Field label="Name" value={name} onChangeText={(v) => { setName(v); setAutoFilled((a) => ({ ...a, name: false })); }} autoFilled={autoFilled.name} />
                <View style={styles.dateFieldWrap}>
                  <DateField label="Date of birth" value={dob} onChange={(v) => { setDob(v); setAutoFilled((a) => ({ ...a, dob: false })); }} placeholder="Select date" />
                  {autoFilled.dob && <Text style={styles.autoTag}>Auto-filled</Text>}
                </View>
                {estimate?.underMinimumAge && (
                  <Text style={styles.warningText}>
                    This worker appears to be under the legal minimum working age (14) -- please verify the date of birth.
                    This does not block saving.
                  </Text>
                )}
                <SelectField label="Gender" value={gender || null} options={GENDER_OPTIONS} onChange={(v) => { setGender(v); setAutoFilled((a) => ({ ...a, gender: false })); }} placeholder="Select" />
                <Field label="Aadhaar number" value={aadhaarNumber} onChangeText={(v) => { setAadhaarNumber(v); setAutoFilled((a) => ({ ...a, aadhaar_number: false })); }} autoFilled={autoFilled.aadhaar_number} keyboardType="number-pad" />
                <Field label="Current address" value={currentAddress} onChangeText={(v) => { setCurrentAddress(v); setAutoFilled((a) => ({ ...a, current_address: false })); }} autoFilled={autoFilled.current_address} />
                <Field label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
              </Animated.View>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <View style={styles.helpBox}>
              <Text style={styles.helpBoxText}>
                These details feed the statutory Form 12 register. Optional here -- the Dashboard reminds you later if
                any active worker is still missing them.
              </Text>
            </View>
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
          </>
        )}

        {step === 3 && (
          <>
            <View style={styles.segToggle}>
              <TouchableOpacity style={[styles.segOption, wageEnabled && styles.segOptionActive]} onPress={() => setWageEnabled(true)}>
                <Text style={[styles.segText, wageEnabled && styles.segTextActive]}>Set up wage rate now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.segOption, !wageEnabled && styles.segOptionActive]} onPress={() => setWageEnabled(false)}>
                <Text style={[styles.segText, !wageEnabled && styles.segTextActive]}>Skip for now</Text>
              </TouchableOpacity>
            </View>

            {wageEnabled ? (
              <>
                <WorkerTypeSelect
                  label="Worker Type"
                  token={token ?? ""}
                  workerTypes={workerTypes}
                  value={selectedWorkerTypeId}
                  onChange={handleSelectWorkerType}
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
                <Field
                  label="Basic wage"
                  value={basic}
                  onChangeText={(v) => { setBasic(v); setTypeAutoFilled(false); }}
                  autoFilled={typeAutoFilled}
                  autoFilledLabel="Auto-filled from type"
                  keyboardType="numeric"
                />
                <Field
                  label="PF rate (%)"
                  value={pfRate}
                  onChangeText={(v) => { setPfRate(v); setTypeAutoFilled(false); }}
                  autoFilled={typeAutoFilled}
                  autoFilledLabel="Auto-filled from type"
                  keyboardType="numeric"
                />
                <Field label="ESI rate (%)" value={esiRate} onChangeText={setEsiRate} keyboardType="numeric" />

                <TouchableOpacity style={styles.moreToggle} onPress={() => setMorePayOpen((v) => !v)}>
                  <Text style={styles.moreToggleText}>{morePayOpen ? "▾" : "▸"} Add more pay components</Text>
                </TouchableOpacity>
                {morePayOpen && (
                  <View style={styles.sectionBody}>
                    <Field label="HRA" value={hra} onChangeText={setHra} keyboardType="numeric" />
                    <Field label="DA" value={da} onChangeText={setDa} keyboardType="numeric" />
                    <Field label="Other allowances" value={otherAllowances} onChangeText={setOtherAllowances} keyboardType="numeric" />
                    <Field label="LWF amount (flat, per month)" value={lwfAmount} onChangeText={setLwfAmount} keyboardType="numeric" />
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.skipNote}>
                No wage rate will be set. You can add one anytime from the worker's Wage Rate screen.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} disabled={saving}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.nextBtn, ((step === 1 && !step1Continueable) || saving) && styles.buttonDisabled]}
          onPress={goContinue}
          disabled={(step === 1 && !step1Continueable) || saving}
        >
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.nextBtnText}>{step === 3 ? "Save Worker" : "Continue"}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  autoFilled,
  autoFilledLabel = "Auto-filled",
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  autoFilled?: boolean;
  autoFilledLabel?: string;
  keyboardType?: "default" | "number-pad" | "phone-pad" | "numeric";
}) {
  return (
    <View style={styles.fieldWrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {autoFilled && <Text style={styles.autoTag}>{autoFilledLabel}</Text>}
      </View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  header: { backgroundColor: colors.navy, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm + 4 },
  stepsRow: { flexDirection: "row", gap: spacing.sm },
  stepItem: { flex: 1 },
  stepBar: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" },
  stepBarDone: { backgroundColor: colors.teal },
  stepBarCurrent: { backgroundColor: colors.white },
  stepLabel: { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.5)", marginTop: 6 },
  stepLabelDone: { color: colors.tealPale },
  stepLabelCurrent: { color: colors.white, fontWeight: "700" },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  segToggle: { flexDirection: "row", backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 4, marginBottom: spacing.md },
  segOption: { flex: 1, paddingVertical: spacing.sm + 2, alignItems: "center", borderRadius: radius.sm - 2 },
  segOptionActive: { backgroundColor: colors.teal },
  segText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  segTextActive: { color: colors.white },
  scanRow: { flexDirection: "row", gap: spacing.sm },
  scanCard: {
    flex: 1,
    height: 120,
    borderWidth: 1.5,
    borderColor: colors.teal,
    borderStyle: "dashed",
    backgroundColor: colors.tealLight,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  scanEmoji: { fontSize: 28, marginBottom: spacing.xs },
  scanCardLabel: { fontSize: 12, color: colors.tealDark, fontWeight: "700", textAlign: "center", paddingHorizontal: spacing.xs },
  scanPreview: StyleSheet.absoluteFill,
  scanDoneText: { position: "absolute", bottom: 6, alignSelf: "center", fontSize: 11, fontWeight: "700", color: colors.white, backgroundColor: "rgba(15,110,86,0.85)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  hint: { fontSize: 12, color: colors.muted, marginTop: spacing.sm, marginBottom: spacing.md, textAlign: "center" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.teal, marginTop: spacing.sm, marginBottom: spacing.sm, textTransform: "uppercase" },
  sectionLabelAmber: { fontSize: 12, fontWeight: "700", color: colors.amber, marginTop: spacing.sm, marginBottom: spacing.sm, textTransform: "uppercase" },
  sectionBody: { paddingTop: spacing.sm },
  helpBox: { backgroundColor: colors.skyBlueLight, borderRadius: radius.sm, padding: spacing.sm + 4, marginBottom: spacing.md },
  helpBoxText: { fontSize: 12.5, color: colors.navy, lineHeight: 18 },
  warningText: { fontSize: 12, color: colors.danger, backgroundColor: colors.dangerLight, padding: spacing.sm, borderRadius: radius.sm, marginBottom: spacing.md },
  toggleRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  toggleOption: { flex: 1, backgroundColor: colors.fieldBg, borderRadius: radius.sm, paddingVertical: 12, alignItems: "center" },
  toggleOptionSelected: { backgroundColor: colors.teal },
  toggleText: { fontSize: 13, fontWeight: "600", color: colors.navy },
  toggleTextSelected: { color: colors.white },
  moreToggle: { paddingVertical: spacing.sm + 2 },
  moreToggleText: { fontSize: 13, fontWeight: "700", color: colors.tealDark },
  skipNote: { fontSize: 12.5, color: colors.muted, backgroundColor: colors.fieldBg, padding: spacing.sm + 4, borderRadius: radius.sm },
  fieldWrap: { marginBottom: spacing.md },
  dateFieldWrap: { marginBottom: spacing.md },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted },
  autoTag: { fontSize: 10, fontWeight: "700", color: colors.tealDark, backgroundColor: colors.tealLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  input: { borderWidth: 0, backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, fontSize: 16, color: colors.navy },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.fieldBg,
    backgroundColor: colors.white,
  },
  backBtn: { flex: 1, backgroundColor: colors.fieldBg, borderRadius: radius.sm, paddingVertical: 14, alignItems: "center" },
  backBtnText: { color: colors.navy, fontSize: 15, fontWeight: "700" },
  nextBtn: { flex: 2, backgroundColor: colors.teal, borderRadius: radius.sm, paddingVertical: 14, alignItems: "center" },
  nextBtnText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  buttonDisabled: { opacity: 0.5 },
});
