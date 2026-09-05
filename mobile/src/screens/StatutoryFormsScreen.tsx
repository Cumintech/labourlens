import { NativeStackScreenProps } from "@react-navigation/native-stack";
// expo-file-system's SDK 54 API is class-based (File/Directory/Paths) --
// the old top-level FileSystem.downloadAsync()/cacheDirectory functions
// were removed, not just renamed. Confirmed against the installed
// package's own type definitions rather than assumed from memory.
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { FormCode, FormFormat, Worker, emailForm, getFormDownloadUrl, listWorkers } from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import KeyboardScreen from "../components/KeyboardScreen";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "StatutoryForms">;

const FORM_OPTIONS: { code: FormCode; label: string; perWorker: boolean; hasPeriod: boolean }[] = [
  { code: "form25", label: "Form 25 — Muster Roll (all workers)", perWorker: false, hasPeriod: true },
  { code: "form25b", label: "Form 25-B — Time Card", perWorker: true, hasPeriod: true },
  { code: "form12", label: "Form 12 — Register of Adult Workers (all workers)", perWorker: false, hasPeriod: false },
  { code: "form15", label: "Form 15 — Wage Register (all workers)", perWorker: false, hasPeriod: true },
  { code: "wageslip", label: "Wage Slip", perWorker: true, hasPeriod: true },
];

// Generic by design, per the owner's own request: pick any form, pick
// any worker (when the form needs one), download or email it. Form 25
// and Form 15 are factory-wide and never ask for a worker; Form 12 is
// one-time and never asks for a period.
export default function StatutoryFormsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [formCode, setFormCode] = useState<FormCode>("form25");
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [periodDate, setPeriodDate] = useState(isoDate(new Date()));
  const [format, setFormat] = useState<FormFormat>("pdf");
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
  const [year, month] = periodDate.split("-").map((n) => parseInt(n, 10));

  function validateSelection(): boolean {
    if (formOption.perWorker && !selectedWorkerId) {
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
        workerId: selectedWorkerId ?? undefined,
        month: formOption.hasPeriod ? month : undefined,
        year: formOption.hasPeriod ? year : undefined,
        format,
      });
      const extension = format === "pdf" ? "pdf" : "xlsx";
      const destination = new File(Paths.cache, `${formCode}_${Date.now()}.${extension}`);
      const downloaded = await File.downloadFileAsync(url, destination, {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
      });
      // downloadFileAsync doesn't surface an HTTP status code -- every
      // failure this backend can return is a small JSON body starting
      // with "{", while a real PDF/Excel file never does, so that's the
      // signal used to tell a failed download from a real one.
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
        worker_id: selectedWorkerId ?? undefined,
        month: formOption.hasPeriod ? month : undefined,
        year: formOption.hasPeriod ? year : undefined,
        format,
        recipient_email: recipientEmail.trim(),
      });
      Alert.alert("Sent", `${formOption.label} sent to ${recipientEmail.trim()}.`);
    } catch (e: any) {
      Alert.alert("Could not send", e?.message ?? "Please try again.");
    } finally {
      setEmailing(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Forms & Reports</Text>
      <Text style={styles.subtitle}>Download or email any statutory form, for any worker, whenever it's needed.</Text>

      <TouchableOpacity style={styles.reportLinkButton} onPress={() => navigation.navigate("Report")}>
        <Text style={styles.reportLinkButtonText}>Open 6-month attendance report →</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>Form</Text>
      {FORM_OPTIONS.map((option) => (
        <TouchableOpacity
          key={option.code}
          style={[styles.formOption, formCode === option.code && styles.formOptionSelected]}
          onPress={() => setFormCode(option.code)}
        >
          <Text style={[styles.formOptionText, formCode === option.code && styles.formOptionTextSelected]}>
            {option.label}
          </Text>
        </TouchableOpacity>
      ))}

      {formOption.perWorker && (
        <>
          <Text style={styles.sectionLabel}>Worker</Text>
          {workers.length === 0 ? (
            <Text style={styles.empty}>No workers yet.</Text>
          ) : (
            workers.map((w) => (
              <TouchableOpacity
                key={w.id}
                style={[styles.workerOption, selectedWorkerId === w.id && styles.workerOptionSelected]}
                onPress={() => setSelectedWorkerId(w.id)}
              >
                <Text style={[styles.workerOptionText, selectedWorkerId === w.id && styles.workerOptionTextSelected]}>
                  {w.name}
                </Text>
                <Text style={styles.workerOptionMeta}>•••• {w.aadhaar_last4}</Text>
              </TouchableOpacity>
            ))
          )}
        </>
      )}

      {formOption.hasPeriod && (
        <>
          <Text style={styles.sectionLabel}>Period</Text>
          <DateField label="Any date in the target month" value={periodDate} onChange={setPeriodDate} />
        </>
      )}

      <Text style={styles.sectionLabel}>Format</Text>
      <View style={styles.formatRow}>
        {(["pdf", "excel"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.formatOption, format === f && styles.formatOptionSelected]}
            onPress={() => setFormat(f)}
          >
            <Text style={[styles.formatText, format === f && styles.formatTextSelected]}>{f.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={[styles.button, downloading && styles.buttonDisabled]} onPress={handleDownload} disabled={downloading}>
        {downloading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Download</Text>}
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
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.navy, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase" },
  reportLinkButton: {
    backgroundColor: colors.violetLight,
    borderRadius: radius.sm,
    padding: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  reportLinkButtonText: { color: colors.violet, fontSize: 13, fontWeight: "700" },
  empty: { fontSize: 13, color: colors.muted },
  formOption: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, marginBottom: spacing.xs },
  formOptionSelected: { backgroundColor: colors.teal },
  formOptionText: { fontSize: 14, fontWeight: "600", color: colors.navy },
  formOptionTextSelected: { color: colors.white },
  workerOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: spacing.xs,
  },
  workerOptionSelected: { backgroundColor: colors.tealLight },
  workerOptionText: { fontSize: 14, fontWeight: "600", color: colors.navy },
  workerOptionTextSelected: { color: "#0F6E56" },
  workerOptionMeta: { fontSize: 11, color: colors.muted },
  formatRow: { flexDirection: "row", gap: spacing.sm },
  formatOption: { flex: 1, backgroundColor: colors.fieldBg, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center" },
  formatOptionSelected: { backgroundColor: colors.teal },
  formatText: { fontSize: 13, fontWeight: "700", color: colors.navy },
  formatTextSelected: { color: colors.white },
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
