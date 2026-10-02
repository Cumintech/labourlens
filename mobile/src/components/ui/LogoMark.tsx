import React from "react";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";
import { colors } from "../../theme";

// Renders assets/brand/logo-mark.svg directly via react-native-svg
// primitives -- no PNG rasterization needed for in-app use (only the
// OS-level app icon/splash still need real PNGs, see
// assets/brand/README.md). Same magnifier + worker silhouette, white
// stroke on a brandTeal rounded square.
// `inverted` draws a white tile with blue line work, for use on the blue
// header bands where the default blue tile would disappear.
export default function LogoMark({ size = 32, inverted = false }: { size?: number; inverted?: boolean }) {
  const tile = inverted ? colors.surface : colors.brandTeal;
  const ink = inverted ? colors.primary : colors.surface;
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Rect x={0} y={0} width={1024} height={1024} rx={307} ry={307} fill={tile} />
      <G transform="translate(432,420)">
        <Circle cx={0} cy={-70} r={72} fill="none" stroke={ink} strokeWidth={34} />
        <Path
          d="M -128 158 C -128 48 -70 -6 0 -6 C 70 -6 128 48 128 158 L 128 170 C 128 178 121 185 113 185 L -113 185 C -121 185 -128 178 -128 170 Z"
          fill="none"
          stroke={ink}
          strokeWidth={34}
          strokeLinejoin="round"
        />
      </G>
      <Circle cx={432} cy={420} r={268} fill="none" stroke={ink} strokeWidth={44} />
      <Line x1={628} y1={616} x2={792} y2={780} stroke={ink} strokeWidth={56} strokeLinecap="round" />
    </Svg>
  );
}
