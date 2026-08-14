/**
 * Curated accent palette for hierarchy entities. Stored as 6-digit hex; the
 * frontend renders them as accent bars on cards and rows.
 */
export const HIERARCHY_COLOR_PALETTE = [
  "#4F46E5", // indigo
  "#2563EB", // blue
  "#0EA5E9", // sky
  "#059669", // emerald
  "#16A34A", // green
  "#EAB308", // yellow
  "#F59E0B", // amber
  "#F97316", // orange
  "#EF4444", // red
  "#DB2777", // pink
  "#9333EA", // purple
  "#64748B", // slate
] as const;

export const HIERARCHY_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** `#RRGGBB` → `[r, g, b]`, or null when the value is not a 6-digit hex. */
function toRgb(hex: string): [number, number, number] | null {
  if (!HIERARCHY_COLOR_PATTERN.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Black or white, whichever is legible on `background`.
 *
 * Accent colours are picked by the operator, so a calendar tile cannot assume
 * white text: the palette includes `#EAB308` (yellow), against which white sits
 * at roughly 1.7:1 — below the 4.5:1 the text needs and effectively unreadable.
 * The event tiles hard-coded `#fff`, so a yellow-marked room produced a session
 * nobody could read.
 *
 * Uses the WCAG relative-luminance formula and compares the contrast of both
 * candidates rather than thresholding on brightness, which gets mid-tones wrong.
 */
export function readableTextColor(background: string | null | undefined): string {
  const rgb = background ? toRgb(background) : null;
  if (!rgb) return "#FFFFFF";

  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);

  // Contrast against white is (1.05) / (L + 0.05); against black, (L + 0.05) / 0.05.
  const againstWhite = 1.05 / (luminance + 0.05);
  const againstBlack = (luminance + 0.05) / 0.05;
  return againstBlack > againstWhite ? "#111827" : "#FFFFFF";
}

/** `#RRGGBB` at `alpha` as an `rgb(… / …)` string, for tints and washes. */
export function withAlpha(hex: string | null | undefined, alpha: number): string | undefined {
  const rgb = hex ? toRgb(hex) : null;
  if (!rgb) return undefined;
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})`;
}
