# Brand assets — PNG generation still needed

This environment has no safe SVG-to-PNG rasterization path (no system `cairo`
library, and installing `svglib`/`reportlab` upgraded the backend's pinned
`reportlab==4.2.5` globally, which was reverted). Per the redesign spec's own
fallback ("if PNG generation tooling isn't available, commit the SVGs and note
it"), only the SVG sources are committed here.

## Files

- `logo-mark.svg` — the mark alone (magnifier + worker silhouette, white
  stroke on a brandTeal `#1F9D82` rounded square, radius ≈30% of size).
  1024×1024.
- `icon.svg` — app icon source: navy `#1B2340` full-bleed background with the
  mark centered and scaled down. Needs rasterizing to `assets/icon.png`
  (1024×1024), replacing the current one.
- `adaptive-icon-foreground.svg` — Android adaptive icon foreground layer,
  mark only, transparent background (the OS supplies its own background/mask
  shape). Needs rasterizing to replace `assets/android-icon-foreground.png`.
  `android-icon-background.png` and `android-icon-monochrome.png` also need
  new versions matching the new mark; not attempted here.
- `splash.svg` — navy background, mark + "LABOUR LENS" wordmark, centered.
  1284×1284. Needs rasterizing to a `splash.png` and wiring into `app.json`'s
  `expo-splash-screen` plugin config via its `image` property.

## What's already wired up

`app.json`'s `expo-splash-screen` plugin config now sets
`backgroundColor: "#1B2340"` (navy) — a real, working visual change needing no
new image. The `image` property is intentionally left unset rather than
pointing at the old `splash-icon.png` (which was designed for a light
background and would look broken on navy) — set it once `splash.svg` has
been rasterized.

## Suggested path to finish this

Any SVG-to-PNG tool works since these are plain, gradient-free vector shapes:
a browser's own "print to PDF"/screenshot at the right zoom, Figma/Inkscape
import-and-export, or an online converter. Export at the exact pixel sizes
noted above, then update `app.json`'s `icon`, `android.adaptiveIcon.*`, and
the `expo-splash-screen` plugin's `image` field to point at the new files.
