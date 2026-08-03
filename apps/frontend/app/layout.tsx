
import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import Providers from "./providers";
import { I18nProvider } from "@/lib/i18n/context";
import ThemeInit from "@/components/shared/theme-init";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-poppins",
});

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

/**
 * Version the favicon URL with the uploaded logo's last change. Browsers cache
 * favicons aggressively and mostly ignore revalidation, so a fresh /icon?v=N
 * URL is what actually forces them to pick up the new logo.
 */
async function faviconVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/financial/settings/logo`, { cache: "no-store" });
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
    const res = await fetch(`${API_BASE}/system-settings`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    const name = body?.data?.system_name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const [version, name] = await Promise.all([faviconVersion(), systemName()]);
  const title = name ? `${name} | Intern Management` : "IQ Academy | Intern Management";
  const metadata: Metadata = {
    title,
    description: "Intern Management System",
  };
  if (version) {
    metadata.icons = { icon: `/icon?v=${version}` };
  }
  return metadata;
}

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className={poppins.className}>
        <ThemeInit />
        <I18nProvider>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
