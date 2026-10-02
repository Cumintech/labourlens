import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../../theme";

// Solid brand-blue title band used at the top of every tab screen (matches
// the blue-collar mockup). Presentational only: title, optional subtitle,
// optional right-side slot (e.g. an action button). Pads for the status
// bar since tab screens render without a navigator header.
export default function BlueHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.band, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.row}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
      {!!subtitle && (
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { flexShrink: 1, fontFamily: "IBMPlexSans_700Bold", fontSize: 24, color: colors.surface },
  subtitle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.onPrimaryMuted, marginTop: 2 },
});
