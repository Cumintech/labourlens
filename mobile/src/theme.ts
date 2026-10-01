// Single source of truth for every color, spacing, radius, and font value
// in the app -- no screen or component should ever write a hardcoded hex
// color or a bare font-family string. Values below come directly from the
// UI/UX refresh spec, not eyeballed from a render.

import { Text, TextInput } from "react-native";

export const colors = {
  // Brand / primary -- replaces the old navy+teal pairing everywhere.
  primary: "#17472E",
  primaryDark: "#10361F",
  primarySoft: "#E8F0EA",
  onPrimaryMuted: "#C9D6CD", // secondary text/icons drawn on a primary background
  heroDivider: "#2B5A40", // hairline dividers inside a primary-colored hero/card

  // Surfaces
  bg: "#F6F7F5",
  card: "#FFFFFF",
  border: "#E3E6E1",
  divider: "#EEF0EC",

  // Text
  text: "#1A1F1B",
  muted: "#5F6B63",

  // Status -- text, dots, and selected-chip fills ONLY. Never a card or
  // screen background; `warnBg` is the one status-adjacent background,
  // for a warning banner/row.
  absent: "#A33A32",
  leave: "#9A6A1E",
  evening: "#3F5568",
  warnBg: "#FBF6EC",

  // SegmentedControl's track background -- specified as its own exact
  // value, distinct from `divider`/`border` above.
  segmentTrack: "#E8ECE6",

  white: "#FFFFFF",
} as const;

// Avatar initials background/text, chosen by hash(workerId) % 5 -- see
// avatarColors() below. Decorative only, not a status signal.
const AVATAR_PALETTE = [
  { bg: "#DCEBE1", text: "#17472E" },
  { bg: "#DDE5EE", text: "#34506B" },
  { bg: "#EFE4D3", text: "#7A5418" },
  { bg: "#E9DFE8", text: "#6B3F66" },
  { bg: "#DDEAEA", text: "#2F5F60" },
] as const;

export function avatarColors(workerId: number): { bg: string; text: string } {
  const index = Math.abs(workerId) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8, // small chips/dots/inner elements
  control: 12, // buttons, inputs
  card: 16,
  hero: 20,
  pill: 999,
} as const;

// Loaded via @expo-google-fonts/ibm-plex-sans + expo-font (see App.tsx's
// useFonts call) -- these are the exact family names that package
// registers the font under, so every screen references weight through
// this one object instead of repeating the literal string.
export const font = {
  regular: "IBMPlexSans_400Regular",
  medium: "IBMPlexSans_500Medium",
  semiBold: "IBMPlexSans_600SemiBold",
  bold: "IBMPlexSans_700Bold",
} as const;

export const MIN_TOUCH_TARGET = 44;

// Applies IBM Plex Sans as the app-wide default so every Text/TextInput
// renders in it even on screens that don't explicitly set a fontFamily
// (most existing screens set fontWeight, not fontFamily) -- this module
// is imported by literally every screen, so it's the one guaranteed
// place to run this once at app start. Screens that DO set an explicit
// fontFamily (font.medium/semiBold/bold, see above) override this per
// Text element as normal; this only fills in the gap for text that
// doesn't.
// @ts-expect-error -- defaultProps exists at runtime on RN's Text/TextInput even though newer @types don't declare it
Text.defaultProps = Text.defaultProps || {};
// @ts-expect-error
Text.defaultProps.style = [{ fontFamily: font.regular }, Text.defaultProps.style];
// @ts-expect-error
TextInput.defaultProps = TextInput.defaultProps || {};
// @ts-expect-error
TextInput.defaultProps.style = [{ fontFamily: font.regular }, TextInput.defaultProps.style];
