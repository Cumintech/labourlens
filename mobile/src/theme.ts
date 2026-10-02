// PDF-spec redesign tokens (Attendance_Screen_Redesign.pdf). Key names are
// kept the same as the prior (ui-v2) palette so no screen needed per-file
// color edits for this re-skin -- only the hex VALUES changed, remapped to
// the new spec. "navy" is deliberately repointed to the spec's near-black
// `text` color (not a distinct navy) -- the spec's "remove ... all navy"
// instruction is satisfied by no navy hue ever rendering, not by deleting
// the (still widely referenced) key name.
export const colors = {
  // --- Core brand ---
  primary: "#17472E", // buttons, active tab, links
  primaryPressed: "#10361F", // pressed/dark state
  brandTeal: "#17472E", // logo mark -- brand green, not a separate hue
  primaryTint: "#E8F0EA", // icon chips, active tab pill, primarySoft
  onPrimaryMuted: "#C9D6CD", // muted text/icons drawn on a primary-bg surface
  heroDivider: "#2B5A40", // dividers inside the Hero card (on primary bg)

  // --- Surfaces & text ---
  navy: "#1A1F1B", // primary text (see file comment -- not actually navy)
  ground: "#F6F7F5", // screen background (bg)
  surface: "#FFFFFF", // cards
  textSecondary: "#5F6B63", // captions, labels (muted)
  border: "#E3E6E1", // card borders
  divider: "#EEF0EC",

  // Status colors -- used ONLY for attendance/alert status (text, dots,
  // selected chips), never decoration.
  present: "#17472E", // present = positive = brand green
  presentTint: "#E8F0EA",
  absent: "#A33A32",
  absentTint: "#F4E3E1",
  absentTintText: "#A33A32",
  leave: "#9A6A1E",
  leaveTint: "#F3ECE0",
  evening: "#3F5568", // per-shift accent for Evening, where a shift needs one
  warning: "#9A6A1E",
  warningTint: "#FBF6EC", // warnBg
  warningTintText: "#9A6A1E",
  warningBorder: "#EADFC6",
  unmarked: "#8A938C",
  unmarkedTint: "#EEF0EC",
  danger: "#A33A32", // destructive text -- same red as absent, one red app-wide

  // --- Decorative multi-hue palette only (shift-accent row, wage chart
  // legend) -- NOT status colors; telling N shifts/wage-slices apart needs
  // several distinct hues, same reasoning a chart legend would. ---
  skyBlue: "#3F5568",
  skyBlueLight: "#E7ECEF",
  violet: "#6B3F66",
  violetLight: "#EFE4ED",
  coral: "#7A5418",
  coralLight: "#F3ECE0",

  // --- Old alias names, repointed to the new palette's closest match so
  // every screen still referencing them renders in the new design. ---
  teal: "#17472E",
  tealLight: "#E8F0EA",
  tealDark: "#10361F",
  tealPale: "#E8F0EA",
  fieldBg: "#F6F7F5",
  muted: "#5F6B63",
  amber: "#9A6A1E",
  amberLight: "#FBF6EC",
  amberPale: "#F3ECE0",
  amberDark: "#7A5414",
  dangerLight: "#F4E3E1",
  neutral: "#8A938C",
  neutralLight: "#EEF0EC",
  white: "#FFFFFF",
} as const;

// Avatar initials background/text, by hash(workerId) % 5.
export const avatarPalette = [
  { bg: "#DCEBE1", text: "#17472E" },
  { bg: "#DDE5EE", text: "#34506B" },
  { bg: "#EFE4D3", text: "#7A5418" },
  { bg: "#E9DFE8", text: "#6B3F66" },
  { bg: "#DDEAEA", text: "#2F5F60" },
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
