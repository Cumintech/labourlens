import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

type Props = {
  message?: string;
  onRetry: () => void;
};

// Shown in place of a screen's content when its *initial* load fails --
// there's nothing to show yet, so silently leaving a blank/spinner
// screen (the previous behavior everywhere) gives the owner no way
// back in except leaving and returning. Not used for background
// refresh failures on a screen that already has data to show.
export default function ErrorState({ message = "Couldn't load this. Check your connection and try again.", onRetry }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>⚠️</Text>
      <Text style={styles.message}>{message}</Text>
      <TouchableOpacity style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emoji: { fontSize: 32, marginBottom: spacing.sm },
  message: { fontSize: 14, color: colors.muted, textAlign: "center", marginBottom: spacing.md },
  button: { backgroundColor: colors.teal, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: spacing.lg },
  buttonText: { color: colors.white, fontSize: 14, fontWeight: "700" },
});
