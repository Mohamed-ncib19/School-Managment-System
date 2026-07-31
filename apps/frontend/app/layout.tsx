
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

export const metadata: Metadata = {
  title: "IQ Academy | Intern Management",
  description: "IQ Academy Intern Management System",
};

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
