import React from "react";
import Svg, { Circle, Ellipse, Path, Rect, Text as SvgText } from "react-native-svg";

// Decorative Wages header illustration: a smiling owner handing a rupee
// note to a smiling worker in an orange hard hat and hi-vis vest.
// Generated SVG (no external image), drawn for the brand-blue header.
export default function WagesHeroArt({ width = 160, height = 118 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 160 118" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ellipse cx={80} cy={116} rx={70} ry={5} fill="rgba(13,71,161,0.5)" />
      {/* Owner */}
      <Path d="M14 118 C14 92 24 82 42 82 C60 82 70 92 70 118 Z" fill="#ECEFF1" />
      <Path d="M36 83 L42 96 L48 83 Z" fill="#90A4AE" />
      <Rect x={37} y={72} width={10} height={11} rx={4} fill="#C68642" />
      <Circle cx={42} cy={61} r={13} fill="#D49A5B" />
      <Path d="M29 58 C29 46 36 43 42 43 C50 43 55 47 55 56 C52 52 46 51 40 51 C35 51 31 53 29 58 Z" fill="#37474F" />
      <Circle cx={37.5} cy={61} r={1.4} fill="#3E2723" />
      <Circle cx={46.5} cy={61} r={1.4} fill="#3E2723" />
      <Path d="M37 66 Q42 70.5 47 66" stroke="#3E2723" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Path d="M62 96 L80 88" stroke="#ECEFF1" strokeWidth={8} strokeLinecap="round" />
      {/* Rupee note */}
      <Rect x={74} y={76} width={22} height={14} rx={2} fill="#A5D6A7" transform="rotate(-12 85 83)" />
      <SvgText x={85} y={87} fontSize={10} fontWeight="700" fill="#1B5E20" textAnchor="middle" transform="rotate(-12 85 83)">
        ₹
      </SvgText>
      {/* Worker */}
      <Path d="M92 118 C92 92 102 82 120 82 C138 82 148 92 148 118 Z" fill="#0D47A1" />
      <Path d="M106 85 L112 118 L128 118 L134 85 C130 83 125 82 120 82 C115 82 110 83 106 85 Z" fill="#FF8F00" />
      <Rect x={109} y={100} width={22} height={3} rx={1.5} fill="#FFE082" />
      <Path d="M100 96 L90 86" stroke="#0D47A1" strokeWidth={8} strokeLinecap="round" />
      <Rect x={115} y={72} width={10} height={11} rx={4} fill="#B5753A" />
      <Circle cx={120} cy={61} r={13} fill="#C68642" />
      <Circle cx={115.5} cy={62} r={1.4} fill="#3E2723" />
      <Circle cx={124.5} cy={62} r={1.4} fill="#3E2723" />
      <Path d="M114.5 66.5 Q120 72 125.5 66.5" stroke="#3E2723" strokeWidth={1.8} fill="none" strokeLinecap="round" />
      <Path d="M105 56 C105 43 112 37 120 37 C128 37 135 43 135 56 Z" fill="#F57C00" />
      <Rect x={102} y={54} width={36} height={5} rx={2.5} fill="#EF6C00" />
      <Rect x={118} y={38} width={4} height={16} rx={2} fill="#FFB74D" />
      {/* Sparkles */}
      <Path d="M84 52 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#FFE082" />
      <Circle cx={70} cy={44} r={2} fill="#FFE082" />
    </Svg>
  );
}
