import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

// Small decorative attendance illustration for the blue header: a calendar
// page with a green tick and a worker's orange hard hat. Generated SVG.
export default function AttendanceArt({ size = 52 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 52 52" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={6} y={8} width={36} height={36} rx={7} fill="#FFFFFF" />
      <Rect x={6} y={8} width={36} height={10} rx={5} fill="#90CAF9" />
      <Rect x={13} y={4} width={4} height={9} rx={2} fill="#0D47A1" />
      <Rect x={31} y={4} width={4} height={9} rx={2} fill="#0D47A1" />
      <Path d="M15 31 l5 5 10-10" stroke="#15803D" strokeWidth={3.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={42} cy={41} r={9} fill="#0D47A1" />
      <Path d="M35.5 41 C35.5 36.5 38.5 34 42 34 C45.5 34 48.5 36.5 48.5 41 Z" fill="#F57C00" />
      <Rect x={34} y={40} width={16} height={2.6} rx={1.3} fill="#EF6C00" />
    </Svg>
  );
}
