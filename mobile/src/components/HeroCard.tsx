import React, { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";
import Icon from "./Icon";
import { colors, font, radius, spacing } from "../theme";

export default function HeroCard({ children, style }: { children: ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[styles.hero, style]}>{children}</View>;
}

// The one white, full-width call-to-action button every hero uses
// ("Mark attendance · N left", "Record payment for all (n)").
export function HeroCTA({
  label,
  onPress,
  disabled,
  loading,
  showArrow = true,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  showArrow?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.cta, disabled && styles.ctaDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <>
          <Text style={styles.ctaText} numberOfLines={1}>
            {label}
          </Text>
          {showArrow && <Icon name="arrowRight" size={16} color={colors.primary} />}
        </>
      )}
    </TouchableOpacity>
  );
}

export function HeroDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.primary, borderRadius: radius.hero, padding: spacing.lg, overflow: "hidden" },
  divider: { height: 1, backgroundColor: colors.heroDivider, marginVertical: spacing.md },
  cta: {
    backgroundColor: colors.white,
    borderRadius: radius.control,
    paddingVertical: spacing.sm + 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: colors.primary, fontFamily: font.semiBold, fontSize: 15 },
});
