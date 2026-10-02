import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Download, FileText } from "lucide-react-native";
import Svg, { Circle } from "react-native-svg";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { FormTemplate, Worker, generateAppointmentLetter, generateIdCard, getFormDownloadUrl, listFormTemplates, listWorkers, listWorkersMissingCompliance } from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import KeyboardScreen from "../components/KeyboardScreen";
import ReportsHeroArt from "../components/ReportsHeroArt";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SelectField from "../components/SelectField";
import { BlueHeader, Card } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { INDIAN_STATE_OPTIONS } from "../indianStates";
import { RootStackParamList } from "../navigation/RootNavigator";
import { sharePdfBytes } from "../pdfShare";
import { colors, radius, spacing, type } from "../theme";
import { workerLabel } from "../workerLabel";

// Mounted as the Forms & Reports tab's content inside MainTabs. `route`
// is only ever populated when reached via HomeScreen's "Wage slips"
// quick action, which passes { formCode, lockForm: true } through the
// nested-tab params pattern (see HomeScreen's goToTab) to pre-pick and
// lock the Report field to a single form.
type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
  route?: { params?: { formCode?: string; lockForm?: boolean } };
};

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
  // Always exactly one worker, never a period -- an ID card is a
  // snapshot of current identity/photo, not scoped to any date range.
  id_card: { hasPeriod: false, workerFilterable: true, workerRequired: true },
  // Same reasoning as id_card -- a letter reflects the worker's current
  // designation/wage/joining date, not a date-scoped register.
  appointment_letter: { hasPeriod: false, workerFilterable: true, workerRequired: true },
};
const DEFAULT_FORM_METADATA = { hasPeriod: true, workerFilterable: false, workerRequired: false };

// Purely presentational grouping for the Report dropdown -- lets a long,
// state-dependent form list read as sections instead of one flat list.
// A code with no entry (a brand-new state's form before this is updated)
// falls under "Other" rather than being dropped.
const FORM_CATEGORY: Record<string, string> = {
  attendance: "Attendance",
  form25: "Statutory Registers",
  form25b: "Statutory Registers",
  form12: "Statutory Registers",
  form15: "Statutory Registers",
  wageslip: "Payroll",
  id_card: "ID & Letters",
  appointment_letter: "ID & Letters",
};
const FORM_CATEGORY_ORDER = ["Attendance", "Payroll", "Statutory Registers", "ID & Letters", "Other"];

// Forms generated through their own dedicated POST endpoint (see
// backend/main.py) rather than the generic GET /forms/{code} dispatcher
// every date-scoped form uses -- each operates on a single worker's
// current data, not a period. Sharing this map (instead of repeating an
// `if (formCode === ...)` per form) is what keeps a third such form from
// duplicating the same branching a third time.
const DIRECT_PDF_GENERATORS: Record<string, (token: string, workerId: number) => Promise<Uint8Array>> = {
  id_card: generateIdCard,
  appointment_letter: generateAppointmentLetter,
};
const DIRECT_PDF_HELPER_TEXT: Record<string, string> = {
  id_card: "Reprints this worker's existing ID card from their stored photo and current details.",
  appointment_letter: "Generates this worker's appointment letter from their current designation, wage, and joining date on file.",
};

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
export default function StatutoryFormsScreen({ route }: Props) {
  const { token, owner } = useAuth();
  const today = useMemo(() => new Date(), []);
  // Locked only while arriving from a shortcut (e.g. Today -> Wage slips);
  // the "Change" link or a plain tab tap unlocks so the Report dropdown shows.
  const [lockForm, setLockForm] = useState(route?.params?.lockForm ?? false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [state, setState] = useState(owner?.state ?? INDIAN_STATE_OPTIONS[0].value);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [formCode, setFormCode] = useState<string>(route?.params?.formCode ?? "attendance");
  useEffect(() => {
    setLockForm(route?.params?.lockForm ?? false);
    if (route?.params?.formCode) setFormCode(route.params.formCode);
  }, [route?.params?.lockForm, route?.params?.formCode]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [preset, setPreset] = useState<PeriodPreset>("current_month");
  const [customStart, setCustomStart] = useState(dateStr(today.getFullYear(), today.getMonth() + 1, 1));
  const [customEnd, setCustomEnd] = useState(isoDate(today));
  const [downloading, setDownloading] = useState(false);
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      listWorkers(token)
        .then(setWorkers)
        .catch(() => {});
      // Read-only: powers the "Compliance ready" ring only.
      listWorkersMissingCompliance(token)
        .then((m) => setMissingCount(m.length))
        .catch(() => setMissingCount(null));
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

  // Grouped, headed dropdown options for the Report field -- see
  // FORM_CATEGORY/FORM_CATEGORY_ORDER above.
  const formSelectOptions: { label: string; value: string; header?: boolean }[] = [];
  for (const category of FORM_CATEGORY_ORDER) {
    const inCategory = availableForms.filter((f) => (FORM_CATEGORY[f.code] ?? "Other") === category);
    if (inCategory.length === 0) continue;
    formSelectOptions.push({ label: category, value: `__header_${category}`, header: true });
    for (const f of inCategory) {
      formSelectOptions.push({ label: f.isAvailable ? f.label : `${f.label} (coming soon)`, value: f.code });
    }
  }

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
      const directGenerator = DIRECT_PDF_GENERATORS[formCode];
      if (directGenerator) {
        const bytes = await directGenerator(token, selectedWorkerId!);
        await sharePdfBytes(bytes, formCode);
        return;
      }
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
      await sharePdfBytes(bytes, formCode);
    } catch (e: any) {
      Alert.alert("Download failed", e?.message ?? "Couldn't reach the server.");
    } finally {
      setDownloading(false);
    }
  }

  const workerOptions = [
    { label: "All workers", value: "all" },
    ...[...workers].sort((a, b) => a.name.localeCompare(b.name)).map((w) => ({
      label: workerLabel(w),
      value: String(w.id),
    })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
    <KeyboardScreen contentContainerStyle={styles.container}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.heroArt} pointerEvents="none">
          <ReportsHeroArt width={124} height={100} />
        </View>
        <Text style={styles.heroTitle} accessibilityRole="header">Reports</Text>
        <Text style={styles.heroTagline}>Insights, records and compliance — simplified.</Text>
      </View>

      <View style={styles.body}>
      {(() => {
        const active = workers.filter((w) => w.status === "active").length;
        if (missingCount === null || active === 0) return null;
        const ready = Math.max(active - missingCount, 0);
        const pct = Math.round((ready / active) * 100);
        const r = 26;
        const c = 2 * Math.PI * r;
        return (
          <View style={styles.complianceCard}>
            <View style={styles.ringWrap}>
              <Svg width={64} height={64} viewBox="0 0 64 64" style={{ transform: [{ rotate: "-90deg" }] }}>
                <Circle cx={32} cy={32} r={r} stroke={colors.divider} strokeWidth={7} fill="none" />
                <Circle
                  cx={32}
                  cy={32}
                  r={r}
                  stroke={pct === 100 ? colors.present : pct >= 70 ? colors.present : colors.leave}
                  strokeWidth={7}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(c * pct) / 100} ${c}`}
                />
              </Svg>
              <Text style={styles.ringText}>{pct}%</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.complianceTitle}>{pct === 100 ? "Compliance ready" : "Compliance check"}</Text>
              <Text style={styles.complianceSub}>
                {ready} of {active} workers have complete Form 12 details
              </Text>
            </View>
          </View>
        );
      })()}

      <View style={styles.formCard}>
      <Text style={styles.fieldLabel}>State</Text>
      <SelectField label="" value={state} options={INDIAN_STATE_OPTIONS} onChange={setState} />

      {availableForms.length === 0 ? (
        <Text style={styles.empty}>No forms available for this state yet.</Text>
      ) : (
        <>
          <Text style={styles.fieldLabel}>Report</Text>
          {lockForm ? (
            <View style={styles.lockedField}>
              <FileText size={18} color={colors.primary} />
              <Text style={[styles.lockedFieldText, { flex: 1 }]}>{formOption.label}</Text>
              <TouchableOpacity onPress={() => setLockForm(false)} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.changeLink}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <SelectField
              label=""
              value={formCode}
              options={formSelectOptions}
              onChange={(v) => {
                setFormCode(v);
                setSelectedWorkerId(null);
              }}
            />
          )}
          {!formOption.isAvailable && <Text style={styles.formCardComingSoon}>Coming soon</Text>}

          <Text style={styles.fieldLabel}>Time period</Text>
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

          <Text style={styles.fieldLabel}>Worker</Text>
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
            {downloading ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <View style={styles.buttonInner}>
                <Download size={18} color={colors.surface} />
                <Text style={styles.buttonText}>{DIRECT_PDF_GENERATORS[formCode] ? "Download / Share PDF" : "Download PDF"}</Text>
              </View>
            )}
          </TouchableOpacity>
          {DIRECT_PDF_HELPER_TEXT[formCode] && <Text style={styles.helper}>{DIRECT_PDF_HELPER_TEXT[formCode]}</Text>}
        </>
      )}
      </View>
      </View>
    </KeyboardScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.ground, flexGrow: 1, paddingBottom: spacing.xl * 2 },
  hero: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingBottom: 48, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: "hidden" },
  heroArt: { position: "absolute", right: 10, bottom: 30 },
  heroTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 26, color: colors.surface },
  heroTagline: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, lineHeight: 18, color: "#FFE0B2", marginTop: 6, maxWidth: 210 },
  body: { paddingHorizontal: spacing.md, marginTop: -28, gap: 12 },
  complianceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    elevation: 4,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  ringWrap: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  ringText: { position: "absolute", fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  complianceTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  complianceSub: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  fieldLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xs },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  subtitle: { ...type.small, color: colors.textSecondary, marginBottom: spacing.md },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.navy, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase" },
  empty: { fontSize: 13, color: colors.textSecondary },
  helper: { fontSize: 12, color: colors.textSecondary },
  customRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  rangePreview: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.ground,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.navy,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.surface, fontSize: 14, fontWeight: "700" },
  buttonGhost: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonGhostText: { color: colors.primary, fontSize: 14, fontWeight: "700" },

  formCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  formCardComingSoon: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.warningTintText, marginTop: 2 },
  lockedField: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.ground,
    borderRadius: radius.sm,
    padding: 12,
    minHeight: 44,
  },
  changeLink: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.primary },
  lockedFieldText: { fontFamily: "IBMPlexSans_500Medium", fontSize: 16, color: colors.navy },
});
