// Accent theme options (doc Section 8: a single restrained accent). The choice
// is persisted in the `ren-accent` cookie and applied as data-accent on <html>
// (see app/layout.tsx + the [data-accent] rules in globals.css). Client-safe —
// no server deps.

export const ACCENT_COOKIE = "ren-accent";

export type AccentId = "blue" | "yellow" | "green";

export const DEFAULT_ACCENT: AccentId = "blue";

// `swatch` is a literal color for the picker preview (kept in sync with the
// [data-accent] values in globals.css).
export const ACCENTS: Record<AccentId, { label: string; swatch: string }> = {
  blue: { label: "Blue", swatch: "oklch(0.62 0.2 258)" },
  yellow: { label: "Yellow", swatch: "oklch(0.86 0.17 95)" },
  green: { label: "Green", swatch: "rgb(0 255 153)" },
};

export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];
