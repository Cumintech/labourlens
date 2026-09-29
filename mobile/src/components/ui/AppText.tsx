import React from "react";
import { Text, TextProps } from "react-native";
import { colors, type } from "../../theme";

type Variant = keyof typeof type;

// One shared way to hit the v2 type scale -- Plus Jakarta Sans ships one
// font family per weight (not a single family + fontWeight), so a plain
// <Text style={{fontWeight}}> can't render the right weight; this picks
// the correct family for you instead of every screen doing it by hand.
export default function AppText({
  variant = "body",
  color = colors.navy,
  style,
  children,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  return (
    <Text style={[type[variant], { color }, style]} {...rest}>
      {children}
    </Text>
  );
}
