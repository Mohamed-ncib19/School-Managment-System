
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Providers from "./providers";
import { I18nProvider } from "@/lib/i18n/context";
import ThemeInit from "@/components/shared/theme-init";
import { schoolMarkDataUrl } from "@/lib/brand";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

/**
 * `generateMetadata` is awaited before the HTML shell is sent, so anything it
 * fetches sits directly in front of every page's first byte.
 *
 * These two values — the uploaded logo's version and the school name — change
 * a handful of times in the product's life, so they are cached rather than
 * re-fetched per render, and time-boxed so a slow or dead API degrades to the
 * default branding instead of holding the page open.
 */
const METADATA_TTL_SECONDS = 300;
const METADATA_TIMEOUT_MS = 2_000;

/**
 * Version the favicon URL with the uploaded logo's last change. Browsers cache
 * favicons aggressively and mostly ignore revalidation, so a fresh /icon?v=N
 * URL is what actually forces them to pick up the new logo.
 */
async function faviconVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/financial/settings/logo`, {
      next: { revalidate: METADATA_TTL_SECONDS },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return res.headers.get("x-logo-version");
  } catch {
    return null;
  }
}

/**
 * The system name is configurable per school (settings → System). The GET
 * route is public, so the browser tab can show it without any token.
 */
async function systemName(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/system-settings`, {
      next: { revalidate: METADATA_TTL_SECONDS },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const name = body?.data?.system_name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The favicon is the uploaded logo when one exists ({/icon?v=N} busts the
 * browser's aggressive favicon cache), else the school monogram — the first
 * two letters of the school name — as a data URI, so no request round-trip.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [version, name] = await Promise.all([faviconVersion(), systemName()]);
  const title = name ? `${name} | Système de Gestion Scolaire` : "Système de Gestion Scolaire";
  const metadata: Metadata = {
    title,
    description: "Système de gestion scolaire",
  };
  metadata.icons = version
    ? { icon: `/icon?v=${version}` }
    : { icon: schoolMarkDataUrl(name ?? "") };
  return metadata;
}

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className={inter.className}>
        <ThemeInit />
        <I18nProvider>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
