import { LucideIcon } from "lucide-react-native";
import React from "react";
import { Pressable, PressableProps, StyleSheet } from "react-native";
import { colors, touchTarget } from "../../theme";

// accessibilityLabel is required (not optional) -- an icon-only control
// with no label is invisible to a screen reader, and this component
// exists specifically to stop that from shipping by construction.
export default function IconButton({
  icon: Icon,
  size = 22,
  color = colors.navy,
  accessibilityLabel,
  style,
  ...rest
}: Omit<PressableProps, "style"> & {
  icon: LucideIcon;
  size?: number;
  color?: string;
  accessibilityLabel: string;
  style?: PressableProps["style"];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={(state) => [styles.base, typeof style === "function" ? style(state) : style]}
      {...rest}
    >
      <Icon size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: touchTarget.min,
    minHeight: touchTarget.min,
    alignItems: "center",
    justifyContent: "center",
  },
});
