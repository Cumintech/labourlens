import { TriangleAlert } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Button from "./ui/Button";
import { colors, spacing } from "../theme";

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
      <TriangleAlert size={32} color={colors.warning} style={{ marginBottom: spacing.sm }} />
      <Text style={styles.message}>{message}</Text>
      <Button title="Retry" onPress={onRetry} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  message: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 14, color: colors.textSecondary, textAlign: "center", marginBottom: spacing.md },
  button: { paddingHorizontal: spacing.lg, minHeight: 40 },
});
