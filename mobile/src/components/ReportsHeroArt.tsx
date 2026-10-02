import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

// Decorative Reports header art: a report sheet with a bar chart and a
// green "compliant" tick. Generated SVG, drawn for the brand-blue header.
export default function ReportsHeroArt({ width = 128, height = 104 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 128 104" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={40} y={6} width={62} height={80} rx={6} fill="#E3F2FD" transform="rotate(8 71 46)" />
      <Rect x={28} y={10} width={62} height={82} rx={6} fill="#FFFFFF" />
      <Rect x={46} y={4} width={26} height={12} rx={4} fill="#0D47A1" />
      <Rect x={38} y={28} width={30} height={4} rx={2} fill="#90CAF9" />
      <Rect x={38} y={37} width={42} height={4} rx={2} fill="#E3F2FD" />
      <Rect x={40} y={70} width={8} height={12} rx={1.5} fill="#1565C0" />
      <Rect x={52} y={60} width={8} height={22} rx={1.5} fill="#42A5F5" />
      <Rect x={64} y={52} width={8} height={30} rx={1.5} fill="#FF8F00" />
      <Rect x={76} y={64} width={8} height={18} rx={1.5} fill="#1565C0" />
      <Circle cx={98} cy={78} r={16} fill="#15803D" />
      <Path d="M90 78 l5 5 10-10" stroke="#FFFFFF" strokeWidth={3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#FFE082" />
    </Svg>
  );
}
