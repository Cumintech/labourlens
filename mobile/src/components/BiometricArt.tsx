import React from "react";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";

// Decorative header art for the biometric screens. Generated SVG, drawn
// for the brand-blue header band.

// A fingerprint attendance terminal with a green "working" tick.
export function TerminalArt({ width = 92, height = 100 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 96 104" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={18} y={4} width={60} height={96} rx={12} fill="#0D47A1" />
      <Rect x={26} y={14} width={44} height={26} rx={4} fill="#90CAF9" />
      <SvgText x={48} y={31} fontSize={9} fontWeight="700" fill="#0D47A1" textAnchor="middle">
        09:30
      </SvgText>
      <Circle cx={48} cy={68} r={18} fill="#1565C0" />
      <G stroke="#E3F2FD" strokeWidth={2} fill="none" strokeLinecap="round">
        <Path d="M41 68a7 7 0 0 1 14 0v3" />
        <Path d="M44.5 74c.4-1.5.5-3.5.5-6a3 3 0 0 1 6 0c0 3-.3 6-1 8" />
        <Path d="M37 64a12 12 0 0 1 22 0" />
      </G>
      <Circle cx={78} cy={14} r={10} fill="#15803D" />
      <Path d="M73 14 l3.5 3.5 6-6" stroke="#FFFFFF" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// A worker in an orange hard hat linked to a terminal.
export function LinkArt({ width = 120, height = 80 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 120 80" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={24} cy={40} r={22} fill="#0D47A1" />
      <Circle cx={24} cy={34} r={7} fill="#D49A5B" />
      <Path d="M17 31 C17 25 20 22 24 22 C28 22 31 25 31 31 Z" fill="#F57C00" />
      <Path d="M13 54 C13 46 18 43 24 43 C30 43 35 46 35 54 Z" fill="#FF8F00" />
      <Path d="M50 40 H70" stroke="#FFE082" strokeWidth={3} strokeDasharray="4 4" strokeLinecap="round" />
      <Path d="M66 34 l6 6 -6 6" stroke="#FFE082" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Rect x={80} y={14} width={34} height={52} rx={8} fill="#E3F2FD" />
      <G stroke="#1565C0" strokeWidth={2} fill="none" strokeLinecap="round">
        <Path d="M91 42a6 6 0 0 1 12 0v2" />
        <Path d="M94 48c.3-1.3.4-3 .4-5a2.6 2.6 0 0 1 5.2 0c0 2.6-.3 5-.8 7" />
        <Path d="M88 39a10 10 0 0 1 18 0" />
      </G>
    </Svg>
  );
}
