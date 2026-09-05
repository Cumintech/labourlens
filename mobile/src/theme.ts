// Colors extracted directly from labour-lens-spec-v2.pptx's mockup slides
// (shape fill/font colors read via python-pptx, not eyeballed from a
// render) -- these are the actual intended values, not an approximation.
export const colors = {
  navy: "#1B2340", // headers, primary dark text, status bar chrome
  teal: "#1F9D82", // brand accent -- primary buttons, active states, links
  tealLight: "#E9F6F1", // highlighted stat blocks (e.g. "16/20 Present")
  tealPale: "#BFE3D6", // chart/decorative fill
  fieldBg: "#F4F6F9", // input field backgrounds, list row backgrounds
  muted: "#6B7280", // secondary/label text
  amber: "#E2A63D", // "owner fills this in" indicator
  danger: "#D9534F", // destructive actions, Absent status
  dangerLight: "#FBEAEA", // destructive-confirmation panel background
  white: "#FFFFFF",
  // Home screen tile accents -- outside the original mockup palette, used
  // only to tell the three Home tiles apart at a glance.
  skyBlue: "#2E86DE",
  skyBlueLight: "#E8F1FC",
  violet: "#7C5CBF",
  violetLight: "#F1ECFA",
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
} as const;
