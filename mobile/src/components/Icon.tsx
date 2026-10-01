import React from "react";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

export type IconName =
  | "grid"
  | "people"
  | "calendarCheck"
  | "document"
  | "gear"
  | "search"
  | "filter"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "plus"
  | "check"
  | "download"
  | "mapPin"
  | "arrowRight"
  | "calendar"
  | "close"
  | "alertDot";

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

// One small hand-drawn line-icon set (24x24 viewBox, stroke-based, Feather
// Icons-style proportions) -- @expo/vector-icons isn't installed in this
// project and the app's existing icon convention elsewhere is raw emoji,
// which can't be tinted to a single theme color and renders full-color on
// every platform. A monochrome outline set this small is worth owning
// directly rather than pulling in a new icon-font dependency.
export default function Icon({ name, size = 20, color = "#000", strokeWidth = 1.8 }: Props) {
  const common = { stroke: color, strokeWidth, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "grid" && (
        <>
          <Rect x="3" y="3" width="7.5" height="7.5" rx="1.5" {...common} />
          <Rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" {...common} />
          <Rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" {...common} />
          <Rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" {...common} />
        </>
      )}
      {name === "people" && (
        <>
          <Circle cx="9" cy="8" r="3.2" {...common} />
          <Path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" {...common} />
          <Circle cx="17" cy="8.5" r="2.4" {...common} />
          <Path d="M15.5 14.2c2.6.4 4.5 2.6 4.5 5.8" {...common} />
        </>
      )}
      {name === "calendarCheck" && (
        <>
          <Rect x="3.5" y="4.5" width="17" height="16" rx="2" {...common} />
          <Line x1="3.5" y1="9.5" x2="20.5" y2="9.5" {...common} />
          <Line x1="8" y1="2.5" x2="8" y2="6.5" {...common} />
          <Line x1="16" y1="2.5" x2="16" y2="6.5" {...common} />
          <Path d="M8.5 14.5l2.2 2.2 4.8-4.8" {...common} />
        </>
      )}
      {name === "document" && (
        <>
          <Path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...common} />
          <Path d="M14 3v5h5" {...common} />
          <Line x1="8.2" y1="13" x2="15.8" y2="13" {...common} />
          <Line x1="8.2" y1="16.5" x2="15.8" y2="16.5" {...common} />
        </>
      )}
      {name === "gear" && (
        <>
          <Circle cx="12" cy="12" r="3.2" {...common} />
          <Path
            d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6M17.8 17.8l-1.6-1.6M7.8 7.8L6.2 6.2"
            {...common}
          />
        </>
      )}
      {name === "search" && (
        <>
          <Circle cx="10.5" cy="10.5" r="6.5" {...common} />
          <Line x1="20" y1="20" x2="15.3" y2="15.3" {...common} />
        </>
      )}
      {name === "filter" && (
        <>
          <Line x1="4" y1="6" x2="20" y2="6" {...common} />
          <Line x1="7" y1="12" x2="17" y2="12" {...common} />
          <Line x1="10" y1="18" x2="14" y2="18" {...common} />
        </>
      )}
      {name === "chevronLeft" && <Path d="M14.5 5L8 12l6.5 7" {...common} />}
      {name === "chevronRight" && <Path d="M9.5 5L16 12l-6.5 7" {...common} />}
      {name === "chevronDown" && <Path d="M5 8.5L12 15l7-6.5" {...common} />}
      {name === "plus" && (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" {...common} />
          <Line x1="5" y1="12" x2="19" y2="12" {...common} />
        </>
      )}
      {name === "check" && <Path d="M4.5 12.5l5 5 10-11" {...common} />}
      {name === "download" && (
        <>
          <Path d="M12 3.5v12" {...common} />
          <Path d="M7 11l5 5 5-5" {...common} />
          <Line x1="4.5" y1="20" x2="19.5" y2="20" {...common} />
        </>
      )}
      {name === "mapPin" && (
        <>
          <Path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" {...common} />
          <Circle cx="12" cy="9.5" r="2.4" {...common} />
        </>
      )}
      {name === "arrowRight" && (
        <>
          <Line x1="4" y1="12" x2="19" y2="12" {...common} />
          <Path d="M13.5 6.5L19 12l-5.5 5.5" {...common} />
        </>
      )}
      {name === "calendar" && (
        <>
          <Rect x="3.5" y="4.5" width="17" height="16" rx="2" {...common} />
          <Line x1="3.5" y1="9.5" x2="20.5" y2="9.5" {...common} />
          <Line x1="8" y1="2.5" x2="8" y2="6.5" {...common} />
          <Line x1="16" y1="2.5" x2="16" y2="6.5" {...common} />
        </>
      )}
      {name === "close" && (
        <>
          <Line x1="5.5" y1="5.5" x2="18.5" y2="18.5" {...common} />
          <Line x1="18.5" y1="5.5" x2="5.5" y2="18.5" {...common} />
        </>
      )}
      {name === "alertDot" && <Circle cx="12" cy="12" r="5" fill={color} stroke="none" />}
    </Svg>
  );
}
