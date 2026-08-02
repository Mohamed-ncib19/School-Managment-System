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
