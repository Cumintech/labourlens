import { NativeStackNavigationProp } from "@react-navigation/native-stack";
// expo-file-system's SDK 54 API is class-based (File/Directory/Paths) --
// the old top-level FileSystem.downloadAsync()/cacheDirectory functions
// were removed, not just renamed. Confirmed against the installed
// package's own type definitions rather than assumed from memory.
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { FormCode, Worker, emailForm, getFormDownloadUrl, listWorkers } from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import KeyboardScreen from "../components/KeyboardScreen";
import SelectField from "../components/SelectField";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

// Registered both as a flat screen on the root stack ("StatutoryForms")
// and as the Forms & Reports tab's content inside MainTabs -- it only
// ever calls `navigation.navigate(...)`/`.goBack()` with no `route`
// access, so a plain root-stack nav prop type covers both mount points.
type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

// Attendance Report is just another Form Type here now, not a separate
// screen -- workerFilterable=false forms are true factory-wide
// registers by real government design (every worker is a row; there's
// no "just this worker" variant of the document), so the Worker picker
// below is shown but locked to "All workers" for them. Form 12 is the
// one exception: it's a running register but does have a real
// per-worker narrowing endpoint, so it's filterable despite having no
// period. Everything else with hasPeriod is a genuine start/end range
// on the backend now, not a single month -- see client.ts.
const FORM_OPTIONS: {
  code: FormCode;
  label: string;
  hasPeriod: boolean;
  workerFilterable: boolean;
  workerRequired: boolean;
}[] = [
  { code: "attendance", label: "Attendance Report (all workers)", hasPeriod: true, workerFilterable: false, workerRequired: false },
  { code: "form25", label: "Form 25 — Muster Roll (all workers)", hasPeriod: true, workerFilterable: false, workerRequired: false },
  { code: "form25b", label: "Form 25-B — Time Card", hasPeriod: true, workerFilterable: true, workerRequired: true },
  { code: "form12", label: "Form 12 — Register of Adult Workers", hasPeriod: false, workerFilterable: true, workerRequired: false },
  { code: "form15", label: "Form 15 — Wage Register (all workers)", hasPeriod: true, workerFilterable: false, workerRequired: false },
  { code: "wageslip", label: "Wage Slip", hasPeriod: true, workerFilterable: true, workerRequired: true },
];

type PeriodPreset = "current_month" | "last_3_months" | "last_6_months" | "current_year" | "last_year" | "custom";

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "current_month", label: "Current Month" },
  { key: "last_3_months", label: "Last 3 Months" },
  { key: "last_6_months", label: "Last 6 Months" },
  { key: "current_year", label: "Current Year" },
  { key: "last_year", label: "Last Year" },
  { key: "custom", label: "Custom" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Same range math as the report picker this replaces -- kept here
// rather than shared, since this is now the only screen that needs it.
function rangeForPreset(preset: PeriodPreset, today: Date): { start: string; end: string } | null {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  switch (preset) {
    case "current_month":
      return { start: dateStr(y, m, 1), end: dateStr(y, m, d) };
    case "current_year":
      return { start: dateStr(y, 1, 1), end: dateStr(y, m, d) };
    case "last_3_months": {
      const start = new Date(y, m - 1 - 3, d);
      return { start: isoDate(start), end: dateStr(y, m, d) };
    }
    case "last_6_months": {
      const start = new Date(y, m - 1 - 6, d);
      return { start: isoDate(start), end: dateStr(y, m, d) };
    }
    case "last_year": {
      const start = new Date(y - 1, m - 1, d);
      return { start: isoDate(start), end: dateStr(y, m, d) };
    }
    default:
      return null;
  }
}

// Generic by design, per the owner's own request: pick a period, pick a
// form (dropdown, not a button list, and the Attendance Report is one
// of its options rather than a separate screen), pick a worker if
// relevant, download or email it. PDF only -- Excel export was removed
// from every form per explicit request.
export default function StatutoryFormsScreen({}: Props) {
  const { token } = useAuth();
  const today = useMemo(() => new Date(), []);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [formCode, setFormCode] = useState<FormCode>("attendance");
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [preset, setPreset] = useState<PeriodPreset>("current_month");
  const [customStart, setCustomStart] = useState(dateStr(today.getFullYear(), today.getMonth() + 1, 1));
  const [customEnd, setCustomEnd] = useState(isoDate(today));
  const [recipientEmail, setRecipientEmail] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      listWorkers(token)
        .then(setWorkers)
        .catch(() => {});
    }, [token]),
  );

  const formOption = FORM_OPTIONS.find((f) => f.code === formCode)!;
  const computed = preset === "custom" ? { start: customStart, end: customEnd } : rangeForPreset(preset, today)!;

  function validateSelection(): boolean {
    if (formOption.hasPeriod && computed.end < computed.start) {
      Alert.alert("Check the dates", "The end date is before the start date.");
      return false;
    }
    if (formOption.workerRequired && !selectedWorkerId) {
      Alert.alert("Choose a worker", "This form needs a worker selected.");
      return false;
    }
    return true;
  }

  async function handleDownload() {
    if (!token || !validateSelection()) return;
    setDownloading(true);
    try {
      const url = getFormDownloadUrl(formCode, {
        workerId: formOption.workerFilterable ? selectedWorkerId ?? undefined : undefined,
        startDate: formOption.hasPeriod ? computed.start : undefined,
        endDate: formOption.hasPeriod ? computed.end : undefined,
      });
      const destination = new File(Paths.cache, `${formCode}_${Date.now()}.pdf`);
      const downloaded = await File.downloadFileAsync(url, destination, {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
      });
      // downloadFileAsync doesn't surface an HTTP status code -- every
      // failure this backend can return is a small JSON body starting
      // with "{", while a real PDF never does, so that's the signal
      // used to tell a failed download from a real one.
      const text = await downloaded.text().catch(() => "");
      if (text.trimStart().startsWith("{")) {
        let detail = "Download failed.";
        try {
          detail = JSON.parse(text).detail ?? detail;
        } catch {
          // not parseable JSON after all -- keep the generic message
        }
        downloaded.delete();
        Alert.alert("Download failed", detail);
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloaded.uri);
      } else {
        Alert.alert("Downloaded", `Saved to ${downloaded.uri}`);
      }
    } catch (e: any) {
      Alert.alert("Download failed", e?.message ?? "Couldn't reach the server.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleEmail() {
    if (!token || !validateSelection()) return;
    if (!recipientEmail.includes("@")) {
      Alert.alert("Check the email", "Enter a valid email address to send the form to.");
      return;
    }
    setEmailing(true);
    try {
      await emailForm(token, formCode, {
        worker_id: formOption.workerFilterable ? selectedWorkerId ?? undefined : undefined,
        startDate: formOption.hasPeriod ? computed.start : undefined,
        endDate: formOption.hasPeriod ? computed.end : undefined,
        recipient_email: recipientEmail.trim(),
      });
      Alert.alert("Sent", `${formOption.label} sent to ${recipientEmail.trim()}.`);
    } catch (e: any) {
      Alert.alert("Could not send", e?.message ?? "Please try again.");
    } finally {
      setEmailing(false);
    }
  }

  const workerOptions = [
    { label: "All workers", value: "all" },
    ...workers.map((w) => ({
      label: w.status === "active" ? w.name : `${w.name} (Deactivated)`,
      value: String(w.id),
    })),
  ];

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Forms & Reports</Text>
      <Text style={styles.subtitle}>Download or email any statutory form or report, for any period, for any worker.</Text>

      <Text style={styles.sectionLabel}>Period</Text>
      <View style={[styles.presetGrid, !formOption.hasPeriod && styles.sectionDisabled]}>
        {PRESETS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.presetOption, preset === p.key && styles.presetOptionActive]}
            onPress={() => formOption.hasPeriod && setPreset(p.key)}
            disabled={!formOption.hasPeriod}
          >
            <Text style={[styles.presetText, preset === p.key && styles.presetTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!formOption.hasPeriod ? (
        <Text style={styles.helper}>{formOption.label} isn't scoped to a period.</Text>
      ) : preset === "custom" ? (
        <View style={styles.customRow}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={customStart} onChange={setCustomStart} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={customEnd} onChange={setCustomEnd} />
          </View>
        </View>
      ) : (
        <Text style={styles.rangePreview}>
          {computed.start} to {computed.end}
        </Text>
      )}

      <Text style={styles.sectionLabel}>Form Type</Text>
      <SelectField
        label=""
        value={formCode}
        options={FORM_OPTIONS.map((o) => ({ label: o.label, value: o.code }))}
        onChange={(v) => {
          setFormCode(v as FormCode);
          setSelectedWorkerId(null);
        }}
      />

      <Text style={styles.sectionLabel}>Worker</Text>
      {!formOption.workerFilterable ? (
        <SelectField label="" value="all" options={[{ label: "All workers", value: "all" }]} onChange={() => {}} disabled />
      ) : workers.length === 0 ? (
        <Text style={styles.empty}>No workers yet.</Text>
      ) : (
        <SelectField
          label=""
          value={selectedWorkerId !== null ? String(selectedWorkerId) : "all"}
          options={workerOptions}
          onChange={(v) => setSelectedWorkerId(v === "all" ? null : parseInt(v, 10))}
        />
      )}

      <TouchableOpacity style={[styles.button, downloading && styles.buttonDisabled]} onPress={handleDownload} disabled={downloading}>
        {downloading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Download PDF</Text>}
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>Or email it</Text>
      <TextInput
        style={styles.input}
        value={recipientEmail}
        onChangeText={setRecipientEmail}
        placeholder="owner@example.com"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <TouchableOpacity style={[styles.buttonGhost, emailing && styles.buttonDisabled]} onPress={handleEmail} disabled={emailing}>
        {emailing ? <ActivityIndicator color={colors.teal} /> : <Text style={styles.buttonGhostText}>Send by email</Text>}
      </TouchableOpacity>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.navy, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase" },
  sectionDisabled: { opacity: 0.5 },
  empty: { fontSize: 13, color: colors.muted },
  helper: { fontSize: 12, color: colors.muted },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  presetOption: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
  },
  presetOptionActive: { backgroundColor: colors.teal },
  presetText: { color: colors.navy, fontSize: 13, fontWeight: "600" },
  presetTextActive: { color: colors.white },
  customRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  rangePreview: { fontSize: 13, color: colors.muted, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.navy,
  },
  button: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 14, fontWeight: "700" },
  buttonGhost: {
    borderWidth: 1.5,
    borderColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonGhostText: { color: colors.teal, fontSize: 14, fontWeight: "700" },
});
