import React, { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, ViewStyle } from "react-native";
import { colors, font, radius, spacing, MIN_TOUCH_TARGET } from "../theme";

type Variant = "primary" | "outline" | "ghost";

export default function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  style,
  small,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  small?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      style={[
        styles.base,
        small && styles.small,
        variant === "primary" && styles.primary,
        variant === "outline" && styles.outline,
        variant === "ghost" && styles.ghost,
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.white : colors.primary} size="small" />
      ) : (
        <>
          {icon}
          <Text
            style={[
              styles.label,
              small && styles.labelSmall,
              variant === "primary" && styles.labelPrimary,
              variant === "outline" && styles.labelOutline,
              variant === "ghost" && styles.labelGhost,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  small: { minHeight: 36, paddingHorizontal: spacing.sm + 2 },
  primary: { backgroundColor: colors.primary },
  outline: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.card },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: 0.5 },
  label: { fontSize: 14, fontFamily: font.semiBold },
  labelSmall: { fontSize: 13 },
  labelPrimary: { color: colors.white },
  labelOutline: { color: colors.primary },
  labelGhost: { color: colors.primary },
});
