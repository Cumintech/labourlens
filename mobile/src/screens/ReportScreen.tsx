import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ReportFormat, emailReport } from "../api/client";
import KeyboardScreen from "../components/KeyboardScreen";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Report">;

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sixMonthsAgoString() {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Plain date-text fields, not a native date-picker component --
// @react-native-community/datetimepicker isn't installed yet, and adding
// a new native module this late in the sprint without a real-device
// testing round to catch issues felt like the wrong tradeoff. Revisit if
// this proves too fiddly to type on a phone.
export default function ReportScreen({}: Props) {
  const { token } = useAuth();
  const [startDate, setStartDate] = useState(sixMonthsAgoString());
  const [endDate, setEndDate] = useState(todayString());
  const [format, setFormat] = useState<ReportFormat>("excel");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!token) return;
    if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
      Alert.alert("Check the dates", "Use the format YYYY-MM-DD, e.g. 2026-02-01.");
      return;
    }
    if (endDate < startDate) {
      Alert.alert("Check the dates", "The end date is before the start date.");
      return;
    }
    if (!recipientEmail.includes("@")) {
      Alert.alert("Check the email", "Enter a valid email address to send the report to.");
      return;
    }
    setSending(true);
    try {
      await emailReport(token, startDate, endDate, recipientEmail.trim(), format);
      Alert.alert("Report sent", `Sent to ${recipientEmail.trim()}.`);
    } catch (e: any) {
      Alert.alert("Could not send report", e?.message ?? "Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.label}>Start date</Text>
      <TextInput
        style={styles.input}
        value={startDate}
        onChangeText={setStartDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
      />

      <Text style={styles.label}>End date</Text>
      <TextInput
        style={styles.input}
        value={endDate}
        onChangeText={setEndDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
      />

      <Text style={styles.label}>Format</Text>
      <View style={styles.formatRow}>
        <TouchableOpacity
          style={[styles.formatOption, format === "excel" && styles.formatOptionActive]}
          onPress={() => setFormat("excel")}
        >
          <Text style={[styles.formatText, format === "excel" && styles.formatTextActive]}>Excel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.formatOption, format === "pdf" && styles.formatOptionActive]}
          onPress={() => setFormat("pdf")}
        >
          <Text style={[styles.formatText, format === "pdf" && styles.formatTextActive]}>PDF</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Send to</Text>
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

      <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending}>
        {sending ? <ActivityIndicator color={colors.white} /> : <Text style={styles.sendButtonText}>Send report</Text>}
      </TouchableOpacity>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white, padding: spacing.md },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.navy,
  },
  formatRow: { flexDirection: "row", gap: spacing.sm },
  formatOption: {
    flex: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
    backgroundColor: colors.fieldBg,
  },
  formatOptionActive: { backgroundColor: colors.teal },
  formatText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  formatTextActive: { color: colors.white },
  sendButton: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  sendButtonText: { color: colors.white, fontSize: 14, fontWeight: "700" },
});
