import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { ApiError, forgotPassword, resetPassword } from "../api/client";
import KeyboardScreen from "../components/KeyboardScreen";
import { AuthStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

// Two steps on one screen rather than two separate routes: step "request"
// asks for the username/email, step "reset" asks for the emailed code +
// a new password. Both call plain, unauthenticated endpoints (see
// backend/main.py's forgot_password/reset_password) -- there's no
// session yet to attach this to.
export default function ForgotPasswordScreen({ navigation }: Props) {
  const [step, setStep] = useState<"request" | "reset">("request");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequest() {
    setError(null);
    if (!identifier.trim()) {
      setError("Enter your username or email.");
      return;
    }
    setSubmitting(true);
    try {
      await forgotPassword(identifier.trim());
      setStep("reset");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset() {
    setError(null);
    if (!code.trim() || newPassword.length < 8) {
      setError("Enter the code from your email and a password of at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(identifier.trim(), code.trim(), newPassword);
      Alert.alert("Password reset", "Log in with your new password.", [
        { text: "OK", onPress: () => navigation.navigate("Login") },
      ]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Reset Password</Text>

      {step === "request" ? (
        <>
          <Text style={styles.subtitle}>
            Enter your username or the email on file. If we find a match, we'll email a reset code to it.
          </Text>
          <Text style={styles.label}>USERNAME OR EMAIL</Text>
          <TextInput
            style={styles.input}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="salemfactory or owner@example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={handleRequest} disabled={submitting}>
            {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Send reset code</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>
            If an account exists for "{identifier.trim()}", a 6-digit code was emailed to it. Enter it below with your new password.
          </Text>
          <Text style={styles.label}>RESET CODE</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Text style={styles.label}>NEW PASSWORD</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={handleReset} disabled={submitting}>
            {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Reset password</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStep("request")}>
            <Text style={styles.backLink}>Use a different username or email</Text>
          </TouchableOpacity>
        </>
      )}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.lg, paddingBottom: spacing.xl * 2, backgroundColor: colors.white },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center", marginBottom: spacing.sm, color: colors.teal },
  subtitle: { fontSize: 13, color: colors.muted, textAlign: "center", marginBottom: spacing.lg, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.navy,
  },
  error: { color: colors.danger, marginTop: spacing.md, textAlign: "center" },
  button: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    padding: 16,
    alignItems: "center",
    marginTop: spacing.xl,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  backLink: { color: colors.teal, fontSize: 13, fontWeight: "700", textAlign: "center", marginTop: spacing.lg },
});
