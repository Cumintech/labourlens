// v2 redesign tokens (see the redesign/ui-v2 spec). Old names below are
// kept as aliases to their original values -- not repointed at the new
// palette -- so any screen not yet migrated to the new design keeps
// rendering exactly as it did before, rather than picking up colors it
// was never designed against mid-migration. Once every screen has moved
// to the new token names (Phase 10), the aliases block gets deleted.
export const colors = {
  // --- v2 tokens ---
  navy: "#1B2340", // headers, primary text
  primary: "#0F7A64", // buttons, active tab, links
  primaryPressed: "#0B5E4D", // pressed state
  brandTeal: "#1F9D82", // logo mark only -- never a UI action color
  primaryTint: "#E6F4EF", // icon chips, active tab pill
  ground: "#F5F7FA", // screen background
  surface: "#FFFFFF", // cards
  textSecondary: "#5B6275", // captions, labels
  border: "#E6E9EF", // card borders
  divider: "#EEF0F4",

  // Status colors -- used ONLY for attendance/alert status, never decoration.
  present: "#15803D",
  presentTint: "#E8F5EC",
  absent: "#C62828",
  absentTint: "#FDECEC",
  absentTintText: "#B42318", // text-on-absentTint (darker than `absent` for contrast on the tint)
  leave: "#1D4ED8",
  leaveTint: "#E8EFFD",
  warning: "#B45309",
  warningTint: "#FEF3E2",
  warningTintText: "#8A4A0B",
  warningBorder: "#F3D9B1",
  unmarked: "#6B7280",
  unmarkedTint: "#F0F1F4",
  danger: "#B42318", // destructive text

  // --- Decorative multi-hue palettes only (shift-accent row, wage donut
  // chart) -- NOT status colors, the "status colors only for status"
  // rule doesn't apply to these: telling N shifts/wage-slices apart
  // needs several distinct hues, same reasoning a chart legend would. ---
  skyBlue: "#2E86DE",
  skyBlueLight: "#E8F1FC",
  violet: "#7C5CBF",
  violetLight: "#F1ECFA",
  coral: "#E8664F",
  coralLight: "#FCEAE6",

  // --- Old names, kept as aliases to their ORIGINAL values (see file
  // comment above) -- not part of the v2 palette, only here so
  // not-yet-migrated screens don't shift colors mid-redesign. ---
  teal: "#1F9D82",
  tealLight: "#E9F6F1",
  tealDark: "#0F6E56",
  tealPale: "#BFE3D6",
  fieldBg: "#F4F6F9",
  muted: "#6B7280",
  amber: "#E2A63D",
  amberLight: "#FFF3DC",
  amberPale: "#FFF8EC",
  amberDark: "#8A5A14",
  dangerLight: "#FBEAEA",
  neutral: "#9CA3AF",
  neutralLight: "#F0F1F3",
  white: "#FFFFFF",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 20,
} as const;

// Plus Jakarta Sans weights loaded via useFonts in App's root (see
// index.ts/App.tsx) -- these map the scale to that font family + the
// numeric weight PlusJakartaSans_* variants ship as separate families,
// not a single family with a `fontWeight` prop (Expo Google Fonts
// packages one font file per weight).
export const type = {
  display: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 28 },
  title: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 20 },
  section: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 17 },
  body: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 15 },
  small: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 13 },
  caption: {
    fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 12,
    textTransform: "uppercase" as const,
    letterSpacing: 0.72, // 0.06em at 12px
  },
} as const;

export const touchTarget = {
  min: 44,
  primary: 48,
} as const;
