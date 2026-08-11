"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  TrendingUp,
  FileBarChart,
  History,
  Settings,
  ShieldOff,
} from "lucide-react";
import { cn } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import { isFeatureEnabled, useSystemSettings } from "@/hooks/use-system-settings";
import type { FeatureKey } from "@/hooks/use-system-settings";
import type { LucideIcon } from "lucide-react";

type FinancialSection = { href: string; label: string; icon: LucideIcon; exact?: boolean; feature: FeatureKey };

const SECTIONS: FinancialSection[] = [
  { href: "/financial", label: "financial.nav.dashboard", icon: LayoutDashboard, exact: true, feature: "financial.dashboard" },
  { href: "/financial/payments", label: "financial.nav.studentPayments", icon: Users, feature: "financial.studentPayments" },
  { href: "/financial/professors", label: "financial.nav.professorPayments", icon: UserCheck, feature: "financial.professorPayments" },
  { href: "/financial/analytics", label: "financial.nav.analytics", icon: TrendingUp, feature: "financial.analytics" },
  { href: "/financial/reports", label: "financial.nav.reports", icon: FileBarChart, feature: "financial.reports" },
  { href: "/financial/transactions", label: "financial.nav.transactions", icon: History, feature: "financial.transactions" },
  { href: "/financial/settings", label: "financial.nav.settings", icon: Settings, feature: "financial.settings" },
];

/**
 * The Financial Management shell.
 *
 * A horizontal sub-nav rather than another sidebar tree: these seven screens are
 * one workflow an administrator moves across constantly, and burying them in the
 * collapsible hierarchy nav would put two clicks between the dashboard and the
 * payments list it points at.
 */
export default function FinancialLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { data: system } = useSystemSettings();

  const activeSection = [...SECTIONS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((section) =>
      section.exact ? pathname === section.href : pathname === section.href || pathname.startsWith(section.href + "/"),
    );

  const disabled = activeSection
    ? !isFeatureEnabled(system?.features, activeSection.feature)
    : false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-h4 font-bold text-text-primary">{t("financial.title", "Financial Management")}</h2>
        <p className="text-xs text-text-secondary">
          {t("financial.subtitle", "Payments, payroll and revenue across the academy")}
        </p>
      </div>

      <nav aria-label={t("financial.title", "Financial Management")} className="border-b border-border">
        <ul className="flex items-center gap-1 overflow-x-auto scrollbar-thin -mb-px">
          {SECTIONS.map((section) => {
            const isActive = section.exact
              ? pathname === section.href
              : pathname === section.href || pathname.startsWith(section.href + "/");
            const Icon = section.icon;

            return (
              <li key={section.href} className="shrink-0">
                <Link
                  href={section.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-text-secondary hover:text-text-primary hover:border-border",
                  )}
                >
                  <Icon size={15} aria-hidden="true" />
                  {t(section.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {disabled ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border bg-neutral-soft/50 px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-secondary text-2xl text-text-tertiary">
            <ShieldOff />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-primary">{t("financial.disabled.title", "Module disabled")}</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-text-secondary">
              {t(
                "financial.disabled.hint",
                "This section is turned off in System Settings. Enable it there to access this screen.",
              )}
            </p>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}