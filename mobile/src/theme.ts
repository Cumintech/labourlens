// Colors extracted directly from labour-lens-spec-v2.pptx's mockup slides
// (shape fill/font colors read via python-pptx, not eyeballed from a
// render) -- these are the actual intended values, not an approximation.
export const colors = {
  navy: "#1B2340", // headers, primary dark text, status bar chrome
  teal: "#1F9D82", // brand accent -- primary buttons, active states, links
  tealLight: "#E9F6F1", // highlighted stat blocks (e.g. "16/20 Present")
  tealDark: "#0F6E56", // text-on-tealLight -- was hand-copied as a raw hex in 10+ places, promoted here
  tealPale: "#BFE3D6", // chart/decorative fill
  fieldBg: "#F4F6F9", // input field backgrounds, list row backgrounds
  muted: "#6B7280", // secondary/label text
  amber: "#E2A63D", // "owner fills this in" indicator
  amberLight: "#FFF3DC",
  amberPale: "#FFF8EC", // alt amber background -- was hand-copied as a raw hex in 5+ places, promoted here
  amberDark: "#8A5A14", // text-on-amberLight/amberPale -- was hand-copied as a raw hex in 10+ places, promoted here
  danger: "#D9534F", // a genuinely negative state only (marked Absent, a failed sync) -- never a "not yet marked" default
  dangerLight: "#FBEAEA", // destructive-confirmation panel background
  neutral: "#9CA3AF", // "not yet marked / no data" status color -- distinct from `muted` (which is for label/caption text, not status)
  neutralLight: "#F0F1F3", // tile background for the neutral/unmarked status
  white: "#FFFFFF",
  // Decorative multi-hue palettes only (the shift-accent row, the wage
  // donut chart) -- NOT status colors, so item 8's "single accent,
  // status-only color" convention doesn't apply to these three: telling
  // 5 shift boxes or N workers' wage slices apart needs several distinct
  // hues, same reasoning a chart legend would.
  skyBlue: "#2E86DE",
  skyBlueLight: "#E8F1FC",
  violet: "#7C5CBF",
  violetLight: "#F1ECFA",
  coral: "#E8664F",
  coralLight: "#FCEAE6",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
} as const;
