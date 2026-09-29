import React from "react";
import { ActivityIndicator, Pressable, PressableProps, StyleSheet, Text } from "react-native";
import { colors, radius, touchTarget } from "../../theme";

type Variant = "primary" | "secondary-outline" | "destructive-text";

export default function Button({
  title,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
  ...rest
}: Omit<PressableProps, "style"> & {
  title: string;
  variant?: Variant;
  loading?: boolean;
  style?: PressableProps["style"];
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary-outline" && styles.secondaryOutline,
        variant === "destructive-text" && styles.destructiveText,
        isDisabled && styles.disabled,
        typeof style === "function" ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.surface : colors.primary} />
      ) : (
        <Text
          style={[
            styles.text,
            variant === "primary" && styles.textPrimary,
            variant === "secondary-outline" && styles.textSecondaryOutline,
            variant === "destructive-text" && styles.textDestructive,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget.primary,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    flexDirection: "row",
  },
  primary: { backgroundColor: colors.primary },
  secondaryOutline: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary },
  destructiveText: { backgroundColor: "transparent" },
  disabled: { opacity: 0.5 },
  text: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 15 },
  textPrimary: { color: colors.surface },
  textSecondaryOutline: { color: colors.primary },
  textDestructive: { color: colors.danger },
});
