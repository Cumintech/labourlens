import React, { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAppLock } from "../context/AppLockContext";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

// Full-screen gate rendered in place of the whole app whenever
// AppLockContext says locked -- a numeric keypad, no text input, so
// there's nothing to type wrong by hitting the keyboard's autocomplete.
export default function AppLockScreen() {
  const { tryUnlock, clearPin } = useAppLock();
  const { logout } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  function handleForgotPin() {
    Alert.alert(
      "Forgot your PIN?",
      "There's no PIN recovery -- resetting it logs you out of Labour Lens on this device. You'll need your mobile number and password to log back in, and can set a new PIN from Settings afterward.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out & Reset",
          style: "destructive",
          onPress: async () => {
            await clearPin();
            await logout();
          },
        },
      ],
    );
  }

  function handleKey(key: string) {
    if (key === "") return;
    if (key === "⌫") {
      setPin((p) => p.slice(0, -1));
      setError(false);
      return;
    }
    const next = (pin + key).slice(0, 4);
    setPin(next);
    setError(false);
    if (next.length === 4) {
      const ok = tryUnlock(next);
      if (!ok) {
        setError(true);
        setTimeout(() => setPin(""), 400);
      }
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🔒</Text>
      <Text style={styles.title}>Enter PIN to unlock Labour Lens</Text>
      <View style={styles.dotsRow}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled, error && styles.dotError]} />
        ))}
      </View>
      {error && <Text style={styles.errorText}>Incorrect PIN</Text>}
      <View style={styles.keypad}>
        {KEYS.map((key, i) => (
          <TouchableOpacity key={i} style={styles.key} onPress={() => handleKey(key)} disabled={key === ""}>
            <Text style={styles.keyText}>{key}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.forgotLink} onPress={handleForgotPin}>
        <Text style={styles.forgotLinkText}>Forgot PIN?</Text>
      </TouchableOpacity>
    </View>
  );
}

const KEY_SIZE = 84;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  emoji: { fontSize: 40, marginBottom: spacing.sm },
  title: { color: colors.white, fontSize: 16, fontWeight: "700", marginBottom: spacing.lg, textAlign: "center" },
  dotsRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.sm },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.white },
  dotFilled: { backgroundColor: colors.teal, borderColor: colors.teal },
  dotError: { borderColor: colors.danger, backgroundColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 12, marginBottom: spacing.md, fontWeight: "700" },
  keypad: { flexDirection: "row", flexWrap: "wrap", width: KEY_SIZE * 3, marginTop: spacing.lg, justifyContent: "center" },
  key: { width: KEY_SIZE, height: KEY_SIZE, alignItems: "center", justifyContent: "center" },
  keyText: { color: colors.white, fontSize: 26, fontWeight: "600" },
  forgotLink: { marginTop: spacing.lg },
  forgotLinkText: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "600" },
});
