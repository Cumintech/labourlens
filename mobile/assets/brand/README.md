# Brand assets

Brand colour: blue `#1565C0` (dark blue `#0D47A1`), white mark.

- `logo-mark.svg` — the mark (magnifier + worker silhouette), white stroke on a
  blue rounded square. In-app it is drawn by `src/components/ui/LogoMark.tsx`
  (pass `inverted` for a white tile on blue headers).
- `icon.svg` → `../icon.png` (1024), `../play-store-icon-512.png`, `../favicon.png`.
- `adaptive-icon-foreground.svg` → `../android-icon-foreground.png`,
  `../android-icon-monochrome.png`, `../splash-icon.png` (mark on transparent).
  `../android-icon-background.png` is solid `#1565C0`.
- `splash.svg` — source for a full splash image (app.json uses `splash-icon.png`
  on a `#1565C0` background instead).

PNGs were rasterized from these SVGs with headless Chromium
(`--default-background-color=00000000 --screenshot`). Re-run that if the SVGs change.
