import { NativeStackNavigationProp } from "@react-navigation/native-stack";
// expo-file-system's SDK 54 API is class-based (File/Directory/Paths) --
// the old top-level FileSystem.downloadAsync()/cacheDirectory functions
// were removed, not just renamed. Confirmed against the installed
// package's own type definitions rather than assumed from memory.
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { FormTemplate, Worker, emailForm, getFormDownloadUrl, listFormTemplates, listWorkers } from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import KeyboardScreen from "../components/KeyboardScreen";
import SelectField from "../components/SelectField";
import { useAuth } from "../context/AuthContext";
import { INDIAN_STATE_OPTIONS } from "../indianStates";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { workerLabel } from "../workerLabel";

// Registered both as a flat screen on the root stack ("StatutoryForms")
// and as the Forms & Reports tab's content inside MainTabs -- it only
// ever calls `navigation.navigate(...)`/`.goBack()` with no `route`
// access, so a plain root-stack nav prop type covers both mount points.
type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

// UI behavior per form_code -- genuinely static (which forms have a
// period, which accept/require a worker), unlike the label/availability
// list itself, which now comes from the backend's form_templates table
// per selected state (see loadTemplates below). A form_code with no
// entry here (a brand-new state's forms before this map is updated)
// falls back to the safest default: period-scoped, not worker-specific.
const FORM_METADATA: Record<string, { hasPeriod: boolean; workerFilterable: boolean; workerRequired: boolean }> = {
  attendance: { hasPeriod: true, workerFilterable: false, workerRequired: false },
  form25: { hasPeriod: true, workerFilterable: false, workerRequired: false },
  form25b: { hasPeriod: true, workerFilterable: true, workerRequired: true },
  form12: { hasPeriod: false, workerFilterable: true, workerRequired: false },
  form15: { hasPeriod: true, workerFilterable: false, workerRequired: false },
  wageslip: { hasPeriod: true, workerFilterable: true, workerRequired: true },
};
const DEFAULT_FORM_METADATA = { hasPeriod: true, workerFilterable: false, workerRequired: false };

type PeriodPreset = "current_month" | "last_month" | "last_3_months" | "last_6_months" | "current_year" | "last_year" | "custom";

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "current_month", label: "Current Month" },
  { key: "last_month", label: "Last Month" },
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
    case "last_month": {
      // Full previous calendar month (1st to last day), not a rolling
      // 30-day window -- month 0 in JS Date's day-0 trick returns the
      // last day of the PREVIOUS month, which for m=1 (January) rolls
      // back to December of the prior year automatically.
      const lastDayOfPrevMonth = new Date(y, m - 1, 0).getDate();
      const prevMonthDate = new Date(y, m - 2, 1);
      return {
        start: dateStr(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 1),
        end: dateStr(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, lastDayOfPrevMonth),
      };
    }
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
  const { token, owner } = useAuth();
  const today = useMemo(() => new Date(), []);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [state, setState] = useState(owner?.state ?? INDIAN_STATE_OPTIONS[0].value);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [formCode, setFormCode] = useState<string>("attendance");
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

  // Which Form Types show up is state-dependent (see form_templates on
  // the backend) -- re-fetched whenever the state selector changes, and
  // the selected form_code is reset if it's no longer in the new list
  // (e.g. switching from Tamil Nadu to Karnataka).
  useEffect(() => {
    if (!token) return;
    listFormTemplates(token, state)
      .then((fetched) => {
        setTemplates(fetched);
        // Stubbed (e.g. Karnataka) templates stay in the list -- their
        // "(coming soon)" label already says what to expect, and
        // attempting one surfaces the backend's real 501 message rather
        // than hiding that the state's forms exist at all.
        if (!fetched.some((t) => t.form_code === formCode)) {
          setFormCode(fetched[0]?.form_code ?? "");
          setSelectedWorkerId(null);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when state changes, not on every formCode change
  }, [token, state]);

  const availableForms = templates.map((t) => ({
    code: t.form_code,
    label: t.label,
    isAvailable: t.is_available,
    ...(FORM_METADATA[t.form_code] ?? DEFAULT_FORM_METADATA),
  }));
  const formOption =
    availableForms.find((f) => f.code === formCode) ?? availableForms[0] ?? { code: "", label: "", isAvailable: true, ...DEFAULT_FORM_METADATA };
  const computed = preset === "custom" ? { start: customStart, end: customEnd } : rangeForPreset(preset, today)!;

  function validateSelection(): boolean {
    if (!formOption.isAvailable) {
      Alert.alert("Not available yet", `${formOption.label} isn't available yet.`);
      return false;
    }
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
      // Fetching first (rather than handing the URL straight to
      // File.downloadFileAsync) is deliberate: per expo-file-system's own
      // docs, a non-2xx response makes downloadFileAsync reject outright
      // with an opaque native "UnableToDownload" error and never write a
      // file at all -- there's no body left afterward to inspect for a
      // JSON error detail the way this code used to try to. fetch() gives
      // a real response.status/response.ok to check before ever touching
      // the filesystem, and a clean error message either way.
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        let detail = `Download failed (${response.status}).`;
        try {
          const body = await response.json();
          detail = body.detail ?? detail;
        } catch {
          // not a JSON error body -- keep the generic message
        }
        Alert.alert("Download failed", detail);
        return;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const destination = new File(Paths.cache, `${formCode}_${Date.now()}.pdf`);
      destination.create({ overwrite: true });
      destination.write(bytes);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(destination.uri);
      } else {
        Alert.alert("Downloaded", `Saved to ${destination.uri}`);
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
      label: workerLabel(w),
      value: String(w.id),
    })),
  ];

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Forms & Reports</Text>
      <Text style={styles.subtitle}>Download or email any statutory form or report, for any period, for any worker.</Text>

      <Text style={styles.sectionLabel}>State</Text>
      <SelectField label="" value={state} options={INDIAN_STATE_OPTIONS} onChange={setState} />

      <Text style={styles.sectionLabel}>Time Period</Text>
      <SelectField
        label=""
        value={preset}
        options={PRESETS.map((p) => ({ label: p.label, value: p.key }))}
        onChange={(v) => setPreset(v as PeriodPreset)}
        disabled={!formOption.hasPeriod}
      />
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
      {availableForms.length === 0 ? (
        <Text style={styles.empty}>No forms available for this state yet.</Text>
      ) : (
        <SelectField
          label=""
          value={formCode}
          options={availableForms.map((o) => ({ label: o.label, value: o.code }))}
          onChange={(v) => {
            setFormCode(v);
            setSelectedWorkerId(null);
          }}
        />
      )}

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
      <View style={styles.emailRow}>
        <TextInput
          style={[styles.input, styles.emailInput]}
          value={recipientEmail}
          onChangeText={setRecipientEmail}
          placeholder="owner@example.com"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <TouchableOpacity style={[styles.buttonGhost, styles.emailButton, emailing && styles.buttonDisabled]} onPress={handleEmail} disabled={emailing}>
          {emailing ? <ActivityIndicator color={colors.teal} /> : <Text style={styles.buttonGhostText}>Send by email</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.navy, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase" },
  empty: { fontSize: 13, color: colors.muted },
  helper: { fontSize: 12, color: colors.muted },
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
  emailRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  emailInput: { flex: 1 },
  emailButton: { marginTop: 0, paddingHorizontal: spacing.md },
});
