import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors, font } from "../theme";

// A ring showing "x/y marked" on the Today hero -- plain react-native-svg
// (already a dependency via HomeBackground's industry patterns), no
// charting library needed for one progress indicator.
export default function ProgressRing({
  progress,
  size = 72,
  strokeWidth = 6,
  label,
  sublabel,
}: {
  progress: number; // 0..1
  size?: number;
  strokeWidth?: number;
  label: string;
  sublabel: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);
  const center = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={r} stroke="rgba(255,255,255,0.25)" strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={colors.white}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${center}, ${center}`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.labelWrap]}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.sublabel} numberOfLines={1}>
          {sublabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelWrap: { alignItems: "center", justifyContent: "center" },
  label: { color: colors.white, fontFamily: font.bold, fontSize: 15 },
  sublabel: { color: "rgba(255,255,255,0.75)", fontFamily: font.medium, fontSize: 9 },
});
