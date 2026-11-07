import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { usePendingAttendanceCount } from "../hooks/useAttendanceQueueSync";
import { colors, radius, spacing } from "../theme";

// Shown only while attendance marks saved offline are waiting to sync.
export default function PendingSyncBanner() {
  const count = usePendingAttendanceCount();
  if (count === 0) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>
        {count} pending sync -- saved on this phone, will upload when you're back online
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warningTint,
    borderRadius: radius.md,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: { color: colors.warningTintText, fontSize: 13 },
});
