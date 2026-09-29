import { LucideIcon } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../../theme";
import Button from "./Button";

export default function EmptyState({
  icon: Icon,
  title,
  subtitle,
  ctaLabel,
  onPressCta,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onPressCta?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Icon size={32} color={colors.textSecondary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {ctaLabel && onPressCta && (
        <Button title={ctaLabel} onPress={onPressCta} style={styles.cta} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.ground,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 15, color: colors.navy, textAlign: "center" },
  subtitle: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, color: colors.textSecondary, textAlign: "center", marginTop: 4 },
  cta: { marginTop: spacing.md, alignSelf: "stretch" },
});
