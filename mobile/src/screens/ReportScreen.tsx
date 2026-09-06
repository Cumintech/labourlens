import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { emailReport, getReportDownloadUrl } from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import KeyboardScreen from "../components/KeyboardScreen";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Report">;

type PeriodPreset = "current_month" | "current_year" | "last_3_months" | "last_6_months" | "last_year" | "custom";

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "current_month", label: "Current Month" },
  { key: "current_year", label: "Current Year" },
  { key: "last_3_months", label: "Last 3 Months" },
  { key: "last_6_months", label: "Last 6 Months" },
  { key: "last_year", label: "Last Year" },
  { key: "custom", label: "Custom" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Computes the actual [start, end] range for every preset except
// "custom", where the owner picks both ends themselves.
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

// Replaces the old fixed "6 months back from today" report with a real
// period picker -- the generated report always matches whatever period
// is actually selected, not a hardcoded window.
export default function ReportScreen({}: Props) {
  const { token } = useAuth();
  const today = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<PeriodPreset>("current_month");
  const [customStart, setCustomStart] = useState(dateStr(today.getFullYear(), today.getMonth() + 1, 1));
  const [customEnd, setCustomEnd] = useState(isoDate(today));
  const [recipientEmail, setRecipientEmail] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(false);

  const computed = preset === "custom" ? { start: customStart, end: customEnd } : rangeForPreset(preset, today)!;

  function validate(): boolean {
    if (computed.end < computed.start) {
      Alert.alert("Check the dates", "The end date is before the start date.");
      return false;
    }
    return true;
  }

  async function handleDownload() {
    if (!token || !validate()) return;
    setDownloading(true);
    try {
      const url = getReportDownloadUrl(computed.start, computed.end);
      const destination = new File(Paths.cache, `attendance_report_${Date.now()}.pdf`);
      const downloaded = await File.downloadFileAsync(url, destination, {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
      });
      const text = await downloaded.text().catch(() => "");
      if (text.trimStart().startsWith("{")) {
        downloaded.delete();
        Alert.alert("Download failed", "Please check the dates and try again.");
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

  async function handleSend() {
    if (!token || !validate()) return;
    if (!recipientEmail.includes("@")) {
      Alert.alert("Check the email", "Enter a valid email address to send the report to.");
      return;
    }
    setSending(true);
    try {
      await emailReport(token, computed.start, computed.end, recipientEmail.trim());
      Alert.alert("Report sent", `Sent to ${recipientEmail.trim()}.`);
    } catch (e: any) {
      Alert.alert("Could not send report", e?.message ?? "Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Attendance Report</Text>
      <Text style={styles.subtitle}>Includes every worker's attendance for the period, plus anyone deactivated during it.</Text>

      <Text style={styles.label}>Period</Text>
      <View style={styles.presetGrid}>
        {PRESETS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.presetOption, preset === p.key && styles.presetOptionActive]}
            onPress={() => setPreset(p.key)}
          >
            <Text style={[styles.presetText, preset === p.key && styles.presetTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {preset === "custom" ? (
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

      <TouchableOpacity style={[styles.downloadButton, downloading && styles.buttonDisabled]} onPress={handleDownload} disabled={downloading}>
        {downloading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.downloadButtonText}>Download PDF</Text>}
      </TouchableOpacity>

      <Text style={styles.label}>Or email it</Text>
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
      <TouchableOpacity style={[styles.sendButton, sending && styles.buttonDisabled]} onPress={handleSend} disabled={sending}>
        {sending ? <ActivityIndicator color={colors.teal} /> : <Text style={styles.sendButtonText}>Send by email</Text>}
      </TouchableOpacity>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white, padding: spacing.md },
  title: { fontSize: 20, fontWeight: "700", color: colors.navy },
  subtitle: { fontSize: 12, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase" },
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
  downloadButton: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 6,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  downloadButtonText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  buttonDisabled: { opacity: 0.6 },
  sendButton: {
    borderWidth: 1.5,
    borderColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
    marginTop: spacing.md,
  },
  sendButtonText: { color: colors.teal, fontSize: 14, fontWeight: "700" },
});
