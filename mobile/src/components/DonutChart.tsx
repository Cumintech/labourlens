import React from "react";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../theme";

export type DonutSlice = { value: number; color: string };

// Ring segments via stroke-dasharray on stacked circles -- much simpler
// than drawing pie wedges as SVG path arcs, and reads just as clearly
// for "who contributed how much of the total" at a glance.
export default function DonutChart({ slices, size = 160, strokeWidth = 26 }: { slices: DonutSlice[]; size?: number; strokeWidth?: number }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.fieldBg} strokeWidth={strokeWidth} fill="transparent" />
      {total > 0 &&
        slices.map((slice, i) => {
          if (slice.value <= 0) return null;
          const fraction = slice.value / total;
          const dash = Math.max(fraction * circumference - 1, 0);
          const gap = circumference - dash;
          const rotation = (accumulated / total) * 360 - 90;
          accumulated += slice.value;
          return (
            <Circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={slice.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${gap}`}
              strokeLinecap="round"
              fill="transparent"
              rotation={rotation}
              origin={`${size / 2}, ${size / 2}`}
            />
          );
        })}
    </Svg>
  );
}
