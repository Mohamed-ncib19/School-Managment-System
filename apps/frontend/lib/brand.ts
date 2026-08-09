/**
 * School-brand mark helpers. The monogram is derived from the school name
 * chosen at installation ("first two letters, uppercase") so every school gets
 * its own mark without uploading a logo. The same rule feeds the favicon
 * (server-side, layout metadata) and the sidebar tile (client-side).
 * Pure module — intentionally NOT a "use client" file so server components
 * (app/icon.tsx, generateMetadata) can import it.
 */

const BRAND_NAVY = "#264EAE";
const BRAND_GOLD = "#F5B940";

/** First two letters of the school name, uppercased. "SM" on empty input. */
export function schoolInitials(name: string): string {
  const letters = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
  return (letters.slice(0, 2) || "SM").toUpperCase();
}

/** The monogram as a standalone SVG (for favicons / <img> fallbacks). */
export function schoolMarkSvg(name: string, size = 96): string {
  const letters = schoolInitials(name);
  const fontSize = Math.round(size * 0.42);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${Math.round(size * 0.21)}" fill="${BRAND_NAVY}"/>` +
    `<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" ` +
    `font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold" ` +
    `fill="${BRAND_GOLD}">${letters}</text>` +
    `</svg>`
  );
}

/** Same SVG as a data: URL usable directly as <link rel="icon" href=…>. */
export function schoolMarkDataUrl(name: string): string {
  return `data:image/svg+xml,${encodeURIComponent(schoolMarkSvg(name))}`;
}

export const SCHOOL_BRAND = { navy: BRAND_NAVY, gold: BRAND_GOLD } as const;