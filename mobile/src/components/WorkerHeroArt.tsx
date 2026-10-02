import React from "react";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";

// Decorative hero illustration for the Today header: a factory worker in a
// hard hat and hi-vis vest beside a transmission/crane tower. Generated
// SVG (no external image, no licensing question). Drawn to sit on the
// brand-blue header, so it uses white/light-blue line work plus the
// safety-yellow hard hat as the single warm accent.
export default function WorkerHeroArt({
  width = 128,
  height = 120,
  hat = "yellow",
}: {
  width?: number;
  height?: number;
  hat?: "yellow" | "orange";
}) {
  const hatMain = hat === "orange" ? "#F57C00" : "#FFC107";
  const hatBrim = hat === "orange" ? "#EF6C00" : "#FFB300";
  const hatRidge = hat === "orange" ? "#FFB74D" : "#FFD54F";
  const line = "rgba(255,255,255,0.35)";
  return (
    <Svg width={width} height={height} viewBox="0 0 128 120" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Lattice tower */}
      <G stroke={line} strokeWidth={1.6} fill="none">
        <Path d="M14 118 L26 18 L38 118" />
        <Line x1={26} y1={18} x2={26} y2={8} />
        <Line x1={10} y1={30} x2={42} y2={30} />
        <Line x1={16} y1={48} x2={36} y2={48} />
        <Path d="M22 48 L33 78 M30 48 L19 78 M19 78 L36 108 M33 78 L16 108" />
        <Line x1={17} y1={78} x2={35} y2={78} />
      </G>
      {/* Ground glow */}
      <Ellipse cx={82} cy={118} rx={44} ry={5} fill="rgba(13,71,161,0.45)" />
      {/* Body: work shirt */}
      <Path d="M52 120 C52 92 62 80 82 80 C102 80 112 92 112 120 Z" fill="#0D47A1" />
      {/* Hi-vis vest */}
      <Path d="M66 84 L74 120 L90 120 L98 84 C93 82 88 81 82 81 C76 81 71 82 66 84 Z" fill="#FF8F00" />
      <Rect x={70} y={100} width={24} height={3.5} rx={1.5} fill="#FFE082" />
      <Rect x={71} y={108} width={22} height={3.5} rx={1.5} fill="#FFE082" />
      <Path d="M82 82 L78 94 L82 92 L86 94 Z" fill="#E3F2FD" />
      {/* Neck + head */}
      <Rect x={77} y={70} width={10} height={12} rx={4} fill="#C68642" />
      <Circle cx={82} cy={60} r={13} fill="#D49A5B" />
      {/* Hard hat */}
      <Path d="M67 55 C67 42 74 36 82 36 C90 36 97 42 97 55 Z" fill={hatMain} />
      <Rect x={64} y={53} width={36} height={5} rx={2.5} fill={hatBrim} />
      <Rect x={80} y={37} width={4} height={16} rx={2} fill={hatRidge} />
      {/* Clipboard */}
      <Rect x={98} y={92} width={14} height={18} rx={2} fill="#FFFFFF" />
      <Rect x={102} y={90} width={6} height={4} rx={1} fill="#90CAF9" />
      <Line x1={101} y1={99} x2={109} y2={99} stroke="#1565C0" strokeWidth={1.4} />
      <Line x1={101} y1={103} x2={109} y2={103} stroke="#1565C0" strokeWidth={1.4} />
      <Path d="M101 107 L103 109 L108 105" stroke="#15803D" strokeWidth={1.6} fill="none" strokeLinecap="round" />
    </Svg>
  );
}
