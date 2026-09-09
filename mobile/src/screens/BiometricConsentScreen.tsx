import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ApiError, captureBiometricConsent } from "../api/client";
import KeyboardScreen from "../components/KeyboardScreen";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "BiometricConsent">;

const NOTICE_TEXT =
  "This worker's fingerprint will be used only to record daily attendance (clock-in/clock-out) at this factory. " +
  "It will not be shared outside the factory or used for any other purpose. The worker can ask to stop using " +
  "fingerprint attendance at any time.";

// DPDP Act requirement (Section 7 of the spec this screen implements):
// captured and timestamped BEFORE any biometric enrollment happens for
// a worker, stored as its own real record (who consented, when, what
// they were told) -- not just a boolean flag. This step is skippable
// (a factory with no biometric device yet has nothing to enroll), but
// the actual enrollment screens (device mapping) hard-block without a
// captured consent record -- see biometric_api.py's create_device_mapping.
export default function BiometricConsentScreen({ route, navigation }: Props) {
  const { workerId, workerName, fromRegistration } = route.params;
  const { token } = useAuth();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  function goNext() {
    navigation.navigate("WageProfile", { workerId, workerName, fromRegistration });
  }

  async function handleConfirm() {
    if (!checked) {
      Alert.alert("Please confirm", "Check the box to confirm the worker was told how their fingerprint will be used.");
      return;
    }
    if (!token) return;
    setSaving(true);
    try {
      await captureBiometricConsent(token, workerId, NOTICE_TEXT);
      goNext();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Could not save consent", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Biometric Consent</Text>
      <Text style={styles.subtitle}>{workerName}</Text>

      <View style={styles.noticeBox}>
        <Text style={styles.noticeLabel}>What the worker needs to be told</Text>
        <Text style={styles.noticeText}>{NOTICE_TEXT}</Text>
      </View>

      <TouchableOpacity style={styles.checkboxRow} onPress={() => setChecked(!checked)}>
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked && <Text style={styles.checkmark}>✓</Text>}</View>
        <Text style={styles.checkboxLabel}>I explained the above to {workerName} and they consent to fingerprint attendance.</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleConfirm} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Confirm consent</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={goNext}>
        <Text style={styles.skipLink}>No biometric device for this worker yet -- skip for now →</Text>
      </TouchableOpacity>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, color: colors.navy },
  subtitle: { fontSize: 15, color: colors.muted, marginBottom: spacing.lg },
  noticeBox: { backgroundColor: colors.fieldBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  noticeLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", marginBottom: spacing.xs },
  noticeText: { fontSize: 14, color: colors.navy, lineHeight: 20 },
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.lg },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.teal,
    marginRight: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.teal },
  checkmark: { color: colors.white, fontSize: 14, fontWeight: "700" },
  checkboxLabel: { flex: 1, fontSize: 14, color: colors.navy, lineHeight: 20 },
  button: { backgroundColor: colors.teal, borderRadius: radius.sm, padding: 16, alignItems: "center" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  skipLink: { color: colors.muted, fontSize: 13, textAlign: "center", marginTop: spacing.lg, textDecorationLine: "underline" },
});
