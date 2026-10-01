import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Line, Path, Pattern, Rect } from "react-native-svg";
import { colors } from "../theme";

// Purely generated SVG patterns, not photos/illustrations sourced from
// anywhere -- avoids any licensing question entirely, and stays fully
// legible under the existing hero card and the two Home tiles since
// each pattern uses a single very-low-opacity tint of the app's own
// palette rather than a busy or dark image. Each industry gets a motif
// that's recognizable without being literal/cliche (item 19's own
// "not overly literal" guidance): a woven thread grid for textiles, a
// rivet/plate grid for metal, wheat-ear strokes for food, a hex/molecule
// lattice for chemicals, gear teeth for automotive, a circuit trace grid
// for electronics, and soft pellet dots for plastics. "general" (and
// anything unset) falls back to a neutral dot grid.
function TextilesPattern() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="weave" width="28" height="28" patternUnits="userSpaceOnUse">
          <Line x1="0" y1="0" x2="28" y2="28" stroke={colors.teal} strokeWidth="1.2" opacity={0.06} />
          <Line x1="28" y1="0" x2="0" y2="28" stroke={colors.teal} strokeWidth="1.2" opacity={0.06} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#weave)" />
    </Svg>
  );
}

function MetalPattern() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="rivets" width="40" height="40" patternUnits="userSpaceOnUse">
          <Rect x="0" y="0" width="40" height="40" fill="none" stroke={colors.navy} strokeWidth="0.8" opacity={0.05} />
          <Circle cx="0" cy="0" r="2" fill={colors.navy} opacity={0.07} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#rivets)" />
    </Svg>
  );
}

function FoodPattern() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="wheat" width="60" height="60" patternUnits="userSpaceOnUse">
          <Path
            d="M30 5 Q34 15 30 25 Q26 15 30 5 M30 20 Q35 30 30 40 Q25 30 30 20 M30 35 Q34 45 30 55"
            stroke={colors.amber}
            strokeWidth="1"
            fill="none"
            opacity={0.08}
          />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#wheat)" />
    </Svg>
  );
}

function ChemicalsPattern() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="hex" width="50" height="44" patternUnits="userSpaceOnUse">
          <Path
            d="M12.5 2 L25 9 L25 23 L12.5 30 L0 23 L0 9 Z"
            stroke={colors.teal}
            strokeWidth="1"
            fill="none"
            opacity={0.07}
          />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#hex)" />
    </Svg>
  );
}

function AutomotivePattern() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="gear" width="46" height="46" patternUnits="userSpaceOnUse">
          <Circle cx="23" cy="23" r="14" stroke={colors.navy} strokeWidth="1" fill="none" opacity={0.06} />
          <Circle cx="23" cy="23" r="4" stroke={colors.navy} strokeWidth="1" fill="none" opacity={0.06} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#gear)" />
    </Svg>
  );
}

function ElectronicsPattern() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="circuit" width="36" height="36" patternUnits="userSpaceOnUse">
          <Path d="M0 18 H14 V6 H36 M18 0 V14 H36" stroke={colors.teal} strokeWidth="1" fill="none" opacity={0.07} />
          <Circle cx="14" cy="6" r="1.5" fill={colors.teal} opacity={0.1} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#circuit)" />
    </Svg>
  );
}

function PlasticsPattern() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="pellets" width="30" height="30" patternUnits="userSpaceOnUse">
          <Circle cx="8" cy="8" r="3" fill={colors.amber} opacity={0.06} />
          <Circle cx="23" cy="20" r="3" fill={colors.amber} opacity={0.06} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#pellets)" />
    </Svg>
  );
}

function GeneralPattern() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <Circle cx="2" cy="2" r="1.4" fill={colors.muted} opacity={0.09} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#dots)" />
    </Svg>
  );
}

const INDUSTRY_PATTERNS: Record<string, React.ComponentType> = {
  textiles: TextilesPattern,
  metal: MetalPattern,
  food: FoodPattern,
  chemicals: ChemicalsPattern,
  automotive: AutomotivePattern,
  electronics: ElectronicsPattern,
  plastics: PlasticsPattern,
  general: GeneralPattern,
};

export default function HomeBackground({ industry }: { industry: string | null | undefined }) {
  const Pattern = (industry && INDUSTRY_PATTERNS[industry]) || GeneralPattern;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Pattern />
    </View>
  );
}
