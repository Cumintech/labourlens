import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { FormTemplate, Worker, emailForm, generateAppointmentLetter, generateIdCard, getFormDownloadUrl, listFormTemplates, listWorkers } from "../api/client";
import Button from "../components/Button";
import DateField, { isoDate } from "../components/DateField";
import Icon from "../components/Icon";
import KeyboardScreen from "../components/KeyboardScreen";
import ScreenHeader from "../components/ScreenHeader";
import SelectField from "../components/SelectField";
import { useAuth } from "../context/AuthContext";
import { INDIAN_STATE_OPTIONS } from "../indianStates";
import { RootStackParamList } from "../navigation/RootNavigator";
import { formatDateShort } from "../format";
import { sharePdfBytes } from "../pdfShare";
import { colors, font, radius, spacing } from "../theme";
import { workerLabel } from "../workerLabel";

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

const FORM_METADATA: Record<string, { hasPeriod: boolean; workerFilterable: boolean; workerRequired: boolean }> = {
  attendance: { hasPeriod: true, workerFilterable: false, workerRequired: false },
  form25: { hasPeriod: true, workerFilterable: false, workerRequired: false },
  form25b: { hasPeriod: true, workerFilterable: true, workerRequired: true },
  form12: { hasPeriod: false, workerFilterable: true, workerRequired: false },
  form15: { hasPeriod: true, workerFilterable: false, workerRequired: false },
  wageslip: { hasPeriod: true, workerFilterable: true, workerRequired: true },
  id_card: { hasPeriod: false, workerFilterable: true, workerRequired: true },
  appointment_letter: { hasPeriod: false, workerFilterable: true, workerRequired: true },
};
const DEFAULT_FORM_METADATA = { hasPeriod: true, workerFilterable: false, workerRequired: false };

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
  { key: "current_month", label: "Current month" },
  { key: "last_month", label: "Last month" },
  { key: "last_3_months", label: "Last 3 months" },
  { key: "last_6_months", label: "Last 6 months" },
  { key: "current_year", label: "Current year" },
  { key: "last_year", label: "Last year" },
  { key: "custom", label: "Custom" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function dateStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

// "Current month" is genuinely the 1st of the month through today -- it
// only LOOKS like a same-day range on the 1st of the month itself,
// because start and end are both legitimately that same date then. Not a
// bug; see the start/end math below.
function rangeForPreset(preset: PeriodPreset, today: Date): { start: string; end: string } | null {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  switch (preset) {
    case "current_month":
      return { start: dateStr(y, m, 1), end: dateStr(y, m, d) };
    case "last_month": {
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

// Reports: pick a state, a report/form, a period, a worker if relevant,
// then download (or email) it -- one generic flow for every statutory
// form and the plain attendance report, rather than a separate screen
// per document type.
export default function StatutoryFormsScreen({}: Props) {
  const { token, owner } = useAuth();
  const insets = useSafeAreaInsets();
  const today = useMemo(() => new Date(), []);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [state, setState] = useState(owner?.state ?? INDIAN_STATE_OPTIONS[0].value);
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [formCode, setFormCode] = useState<string>("attendance");
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [preset, setPreset] = useState<PeriodPreset>("current_month");
  const [customStart, setCustomStart] = useState(dateStr(today.getFullYear(), today.getMonth() + 1, 1));
  const [customEnd, setCustomEnd] = useState(isoDate(today));
  const [recipientEmail, setRecipientEmail] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [emailing, setEmailing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      listWorkers(token).then(setWorkers).catch(() => {});
    }, [token]),
  );

  useEffect(() => {
    if (!token) return;
    listFormTemplates(token, state)
      .then((fetched) => {
        setTemplates(fetched);
        if (!fetched.some((t) => t.form_code === formCode)) {
          setFormCode(fetched[0]?.form_code ?? "");
          setSelectedWorkerId(null);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setDownloaded(false);
    try {
      const directGenerator = DIRECT_PDF_GENERATORS[formCode];
      if (directGenerator) {
        const bytes = await directGenerator(token, selectedWorkerId!);
        await sharePdfBytes(bytes, formCode);
        setDownloaded(true);
        return;
      }
      const url = getFormDownloadUrl(formCode, {
        workerId: formOption.workerFilterable ? selectedWorkerId ?? undefined : undefined,
        startDate: formOption.hasPeriod ? computed.start : undefined,
        endDate: formOption.hasPeriod ? computed.end : undefined,
      });
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        let detail = `Download failed (${response.status}).`;
        try {
          const body = await response.json();
          detail = body.detail ?? detail;
        } catch {
          // not a JSON error body
        }
        Alert.alert("Download failed", detail);
        return;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await sharePdfBytes(bytes, formCode);
      setDownloaded(true);
    } catch (e: any) {
      Alert.alert("Download failed", e?.message ?? "Couldn't reach the server.");
    } finally {
      setDownloading(false);
      setTimeout(() => setDownloaded(false), 2500);
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
    ...workers.map((w) => ({ label: workerLabel(w), value: String(w.id) })),
  ];

  return (
    <KeyboardScreen contentContainerStyle={[styles.container, { paddingBottom: spacing.xl + insets.bottom }]}>
      <ScreenHeader title="Reports" subtitle="Statutory forms and reports, any period or worker" />

      <TouchableOpacity style={styles.stateCard} onPress={() => setStatePickerOpen(true)}>
        <View style={styles.stateIconWrap}>
          <Icon name="mapPin" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.stateLabel}>State</Text>
          <Text style={styles.stateValue}>{INDIAN_STATE_OPTIONS.find((o) => o.value === state)?.label ?? state}</Text>
        </View>
        <Text style={styles.changeLink}>Change</Text>
      </TouchableOpacity>

      <View style={styles.formCard}>
        <Text style={styles.sectionLabel}>Report</Text>
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
            outlined
          />
        )}

        <Text style={styles.sectionLabel}>Time period</Text>
        <SelectField
          label=""
          value={preset}
          options={PRESETS.map((p) => ({ label: p.label, value: p.key }))}
          onChange={(v) => setPreset(v as PeriodPreset)}
          disabled={!formOption.hasPeriod}
          outlined
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
          <View style={styles.rangeStrip}>
            <Icon name="calendar" size={14} color={colors.primary} />
            <Text style={styles.rangeStripText}>
              {formatDateShort(computed.start)} – {formatDateShort(computed.end)}
            </Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>Worker</Text>
        {!formOption.workerFilterable ? (
          <SelectField label="" value="all" options={[{ label: "All workers", value: "all" }]} onChange={() => {}} disabled outlined />
        ) : workers.length === 0 ? (
          <Text style={styles.empty}>No workers yet.</Text>
        ) : (
          <SelectField
            label=""
            value={selectedWorkerId !== null ? String(selectedWorkerId) : "all"}
            options={workerOptions}
            onChange={(v) => setSelectedWorkerId(v === "all" ? null : parseInt(v, 10))}
            outlined
          />
        )}

        <Button
          label={downloaded ? "Downloaded" : "Download PDF"}
          onPress={handleDownload}
          loading={downloading}
          icon={!downloading && <Icon name={downloaded ? "check" : "download"} size={16} color={colors.white} />}
          style={{ marginTop: spacing.sm }}
        />
        {DIRECT_PDF_HELPER_TEXT[formCode] && <Text style={styles.helper}>{DIRECT_PDF_HELPER_TEXT[formCode]}</Text>}

        {!DIRECT_PDF_GENERATORS[formCode] && (
          <>
            <Text style={styles.orEmailLabel}>Or send by email</Text>
            <View style={styles.emailRow}>
              <TextInput
                style={styles.emailInput}
                value={recipientEmail}
                onChangeText={setRecipientEmail}
                placeholder="owner@example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <Button label="Send" variant="outline" onPress={handleEmail} loading={emailing} small />
            </View>
          </>
        )}
      </View>

      <Modal visible={statePickerOpen} transparent animationType="fade" onRequestClose={() => setStatePickerOpen(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setStatePickerOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>Select state</Text>
            <FlatList
              data={INDIAN_STATE_OPTIONS}
              keyExtractor={(o) => o.value}
              style={{ flexGrow: 0 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.sheetOption, item.value === state && styles.sheetOptionSelected]}
                  onPress={() => {
                    setState(item.value);
                    setStatePickerOpen(false);
                  }}
                >
                  <Text style={[styles.sheetOptionText, item.value === state && styles.sheetOptionTextSelected]}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, backgroundColor: colors.bg, flexGrow: 1 },
  stateCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
    marginTop: spacing.md,
  },
  stateIconWrap: { width: 32, height: 32, borderRadius: radius.control, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  stateLabel: { fontSize: 11, color: colors.muted, fontFamily: font.regular },
  stateValue: { fontSize: 14.5, fontFamily: font.semiBold, color: colors.text, marginTop: 1 },
  changeLink: { color: colors.primary, fontSize: 13.5, fontFamily: font.semiBold },

  formCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  sectionLabel: { fontSize: 11.5, fontFamily: font.semiBold, color: colors.muted, textTransform: "uppercase", marginBottom: spacing.xs, letterSpacing: 0.5 },
  empty: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  helper: { fontSize: 12, color: colors.muted, marginTop: spacing.xs },
  customRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  rangeStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.control,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.md,
  },
  rangeStripText: { color: colors.primary, fontSize: 13.5, fontFamily: font.semiBold },
  orEmailLabel: { fontSize: 12, fontFamily: font.semiBold, color: colors.muted, marginTop: spacing.md, marginBottom: spacing.xs },
  emailRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  emailInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.control,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.text,
  },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.hero, borderTopRightRadius: radius.hero, padding: spacing.md, maxHeight: "70%" },
  sheetTitle: { fontSize: 14, fontFamily: font.semiBold, color: colors.text, marginBottom: spacing.sm },
  sheetOption: { paddingVertical: 14, paddingHorizontal: spacing.sm, borderRadius: radius.control },
  sheetOptionSelected: { backgroundColor: colors.primarySoft },
  sheetOptionText: { fontSize: 15, color: colors.text },
  sheetOptionTextSelected: { color: colors.primaryDark, fontFamily: font.semiBold },
});
