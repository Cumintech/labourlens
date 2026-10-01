import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import KeyboardScreen from "../components/KeyboardScreen";
import { AuthStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { isValidEmail, isValidIndianMobile, isValidUsername, normalizeIndianMobile } from "../validators";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

// Signing up was previously only possible via a raw API call -- every
// account on this app so far was created by hand outside the UI. This
// adds the missing path so any number of separate factory owners can
// create their own login (each one fully isolated server-side by
// owner_id -- see AuthContext.signup) without needing that done for them.
export default function LoginScreen({ navigation }: Props) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [factoryName, setFactoryName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!username.trim() || !password) {
      setError(mode === "login" ? "Enter your username and password." : "Choose a username and password.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(username.trim(), password);
      } else {
        if (!name.trim() || !factoryName.trim()) {
          setError("Owner name and factory name are required.");
          return;
        }
        if (!isValidUsername(username)) {
          setError("Username must be 3-30 characters, starting with a letter (letters, numbers, \".\" or \"_\" only).");
          return;
        }
        if (!isValidEmail(email)) {
          setError("Enter a valid email address -- needed for Forgot Password.");
          return;
        }
        if (!isValidIndianMobile(mobile)) {
          setError("Enter a valid 10-digit mobile number.");
          return;
        }
        // Decorative-only wouldn't be a real gate -- the backend itself
        // also rejects a signup without consent_given=true, but this
        // stops the request before it's even sent, with a clear reason.
        if (!consentChecked) {
          setError("Please accept the Privacy Policy to create an account.");
          return;
        }
        const newOwner = await signup(name.trim(), username.trim(), email.trim(), mobile, password, factoryName.trim(), consentChecked);
        if (newOwner.plan_status === "trial") {
          Alert.alert(
            "Welcome to Labour Lens",
            `Your ${newOwner.trial_days_remaining}-day free trial has started. You'll need to move to a paid plan to keep using the app after that.`,
          );
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>LABOUR LENS</Text>

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeButton, mode === "login" && styles.modeButtonActive]}
          onPress={() => setMode("login")}
        >
          <Text style={[styles.modeText, mode === "login" && styles.modeTextActive]}>Log In</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === "signup" && styles.modeButtonActive]}
          onPress={() => setMode("signup")}
        >
          <Text style={[styles.modeText, mode === "signup" && styles.modeTextActive]}>Sign Up</Text>
        </TouchableOpacity>
      </View>

      {mode === "signup" && (
        <>
          <Text style={styles.label}>OWNER NAME</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.label}>FACTORY NAME</Text>
          <TextInput
            style={styles.input}
            value={factoryName}
            onChangeText={setFactoryName}
            placeholder="Your factory's name"
            placeholderTextColor={colors.muted}
          />
        </>
      )}

      <Text style={styles.label}>USERNAME</Text>
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        placeholder="e.g. salemfactory"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {mode === "signup" && (
        <>
          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="owner@example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />

          <Text style={styles.label}>OWNER MOBILE</Text>
          <TextInput
            style={styles.input}
            value={mobile}
            onChangeText={(v) => setMobile(normalizeIndianMobile(v))}
            keyboardType="phone-pad"
            maxLength={10}
            placeholder="9840XXXXXX"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
          />
        </>
      )}

      <Text style={styles.label}>PASSWORD</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="••••••••"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {mode === "login" && (
        <TouchableOpacity onPress={() => navigation.navigate("ForgotPassword")}>
          <Text style={styles.forgotLink}>Forgot password?</Text>
        </TouchableOpacity>
      )}

      {mode === "signup" && (
        <TouchableOpacity style={styles.consentRow} onPress={() => setConsentChecked((v) => !v)}>
          <View style={[styles.checkbox, consentChecked && styles.checkboxChecked]}>
            {consentChecked && <Text style={styles.checkboxTick}>✓</Text>}
          </View>
          <Text style={styles.consentText}>
            I agree to the{" "}
            <Text style={styles.consentLink} onPress={() => navigation.navigate("PrivacyPolicy")}>
              Privacy Policy
            </Text>
            , including how worker data is stored and retained.
          </Text>
        </TouchableOpacity>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, (submitting || (mode === "signup" && !consentChecked)) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting || (mode === "signup" && !consentChecked)}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>{mode === "login" ? "Log In" : "Create Account"}</Text>
        )}
      </TouchableOpacity>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.lg, paddingBottom: spacing.xl * 2, backgroundColor: colors.white },
  title: {
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: spacing.lg,
    letterSpacing: 1,
    color: colors.primary,
  },
  modeRow: { flexDirection: "row", backgroundColor: colors.bg, borderRadius: radius.sm, padding: 4, marginBottom: spacing.md },
  modeButton: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: radius.sm - 2 },
  modeButtonActive: { backgroundColor: colors.primary },
  modeText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  modeTextActive: { color: colors.white },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    borderWidth: 0,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.text,
  },
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.lg },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm - 4,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxTick: { color: colors.white, fontSize: 14, fontWeight: "700" },
  consentText: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 17 },
  consentLink: { color: colors.primary, fontWeight: "700" },
  forgotLink: { color: colors.primary, fontSize: 13, fontWeight: "700", textAlign: "right", marginTop: spacing.sm },
  error: { color: colors.absent, marginTop: spacing.md, textAlign: "center" },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    padding: 16,
    alignItems: "center",
    marginTop: spacing.xl,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
