// Blue-collar workforce theme (blue-and-white, per the Labour Lens UI
// mockup). Key names are kept from the earlier palettes so screens keep
// referencing the same tokens -- only values changed. Brand/interactive
// colour is blue; status colours (present / absent / leave / warning) stay
// semantic and are NOT brand blue. "navy" = primary text colour.
export const colors = {
  // --- Core brand ---
  primary: "#1565C0", // buttons, active tab, links, header bands
  primaryPressed: "#0D47A1", // pressed state
  primaryDark: "#0D47A1", // dark blue: important headings, selected states
  secondary: "#1976D2", // secondary blue accents
  brandTeal: "#0D47A1", // logo mark background (dark brand blue)
  primaryTint: "#EAF3FF", // icon chips, active tab pill, light blue surfaces
  onPrimaryMuted: "#C9DDF7", // muted text/icons drawn on a primary-bg surface
  heroDivider: "#3D82D1", // dividers / pills on a primary-bg surface

  // --- Surfaces & text ---
  navy: "#172B4D", // primary text
  ground: "#F5F9FF", // screen background (very light blue)
  surface: "#FFFFFF", // cards
  textSecondary: "#64748B",
  border: "#DCE6F1",
  divider: "#E8EFF7",
  disabled: "#94A3B8",

  // Status colours -- used ONLY for attendance/alert status, never decoration.
  present: "#15803D", // accessible green (success)
  presentTint: "#E7F6EC",
  absent: "#C62828",
  absentTint: "#FDECEC",
  absentTintText: "#C62828",
  leave: "#B45309",
  leaveTint: "#FFF4E0",
  evening: "#5E35B1", // per-shift accent for Evening
  warning: "#B45309",
  warningTint: "#FFF8E8",
  warningTintText: "#92400E",
  warningBorder: "#F6DFAF",
  unmarked: "#7B8798",
  unmarkedTint: "#EEF2F7",
  danger: "#C62828", // destructive text -- same red as absent

  // --- Decorative multi-hue palette only (shift accents, wage chart legend) ---
  skyBlue: "#0288D1",
  skyBlueLight: "#E1F3FC",
  violet: "#6A3FB5",
  violetLight: "#EFE9FA",
  coral: "#C2410C",
  coralLight: "#FFEDE3",

  // --- Old alias names, repointed to the blue palette ---
  teal: "#1565C0",
  tealLight: "#EAF3FF",
  tealDark: "#0D47A1",
  tealPale: "#EAF3FF",
  fieldBg: "#F3F7FC",
  muted: "#64748B",
  amber: "#B45309",
  amberLight: "#FFF8E8",
  amberPale: "#FFF4E0",
  amberDark: "#92400E",
  dangerLight: "#FDECEC",
  neutral: "#94A3B8",
  neutralLight: "#EEF2F7",
  white: "#FFFFFF",
} as const;

// Avatar initials background/text, by hash(workerId) % 5.
export const avatarPalette = [
  { bg: "#E3EEFD", text: "#1565C0" },
  { bg: "#E4F4EA", text: "#1E7B45" },
  { bg: "#FFF0D9", text: "#A3560B" },
  { bg: "#EFE7FB", text: "#6A3FB5" },
  { bg: "#FDE8E1", text: "#B23C10" },
] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 12, // button/input
  md: 14,
  lg: 16, // card
  xl: 20, // hero
  pill: 999, // chip
} as const;

// IBM Plex Sans weights loaded via useFonts in App's root (see App.tsx) --
// this maps the scale to that font family + the numeric weight. IBM Plex
// Sans ships 100/200/300/400/500/600/700 -- no 800, so the old "ExtraBold"
// slots use 700Bold, the heaviest available.
export const type = {
  display: { fontFamily: "IBMPlexSans_700Bold", fontSize: 28 },
  title: { fontFamily: "IBMPlexSans_700Bold", fontSize: 20 },
  section: { fontFamily: "IBMPlexSans_700Bold", fontSize: 17 },
  body: { fontFamily: "IBMPlexSans_500Medium", fontSize: 15 },
  small: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13 },
  caption: {
    fontFamily: "IBMPlexSans_700Bold",
    fontSize: 12,
    textTransform: "uppercase" as const,
    letterSpacing: 0.72, // 0.06em at 12px
  },
} as const;

export const touchTarget = {
  min: 44,
  primary: 48,
} as const;
