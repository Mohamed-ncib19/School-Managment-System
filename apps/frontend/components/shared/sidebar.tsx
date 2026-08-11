"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  Users,
  UserCheck,
  BookOpen,
  Settings,
  ChevronDown,
  Network,
  UserCog,
  CircleDollarSign,
  Upload,
  Layers,
  Wallet,
  TrendingUp,
  FileText,
  Receipt,
  SlidersHorizontal,
} from "lucide-react";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useTranslation } from "@/lib/i18n/context";
import { useHierarchyConfig, type HierarchyEntity } from "@/hooks/use-hierarchy-config";
import { useFinancialSettings } from "@/hooks/use-financial";
import { useSystemSettings, isFeatureEnabled, type FeatureKey } from "@/hooks/use-system-settings";
import { apiBaseUrl } from "@/lib/api/client";
import BrandMark from "./brand-mark";
import ContactSupport from "./contact-support";

/** The brand mark: the uploaded academy logo when set, else null (monogram). */
function useBrandLogo(): string | null {
  const { data: settings } = useFinancialSettings();
  if (settings?.logo_path) {
    return `${apiBaseUrl()}/financial/settings/logo?v=${new Date(settings.updated_at).getTime()}`;
  }
  return null;
}

const MAIN_NAV_ITEMS = [
  { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
];

// `href`s here must match the routes under app/(dashboard)/financial exactly.
// The dashboard is the segment's index route and the payroll screen lives at
// /financial/professors; pointing at /financial/dashboard or /financial/payroll
// gave two 404s in the sidebar.
const FINANCIAL_NAV_ITEMS = [
  { href: "/financial", label: "nav.financialDashboard", icon: TrendingUp, exact: true },
  { href: "/financial/payments", label: "nav.studentPayments", icon: Wallet },
  { href: "/financial/professors", label: "nav.professorPayments", icon: CircleDollarSign },
  { href: "/financial/analytics", label: "nav.revenueAnalytics", icon: TrendingUp },
  { href: "/financial/reports", label: "nav.financialReports", icon: FileText },
  { href: "/financial/transactions", label: "nav.transactionsHistory", icon: Receipt },
  { href: "/financial/settings", label: "nav.financialSettings", icon: SlidersHorizontal },
];

// Trailing block: import data comes last, just before the admin screens.
const ADMIN_NAV_ITEMS = [
  { href: "/import", label: "nav.import", icon: Upload },
  { href: "/audit", label: "nav.audit", icon: UserCog },
  { href: "/settings", label: "nav.settings", icon: Settings },
];

const ENTITY_ICONS: Record<HierarchyEntity, any> = {
  level: Layers,
  field: BookOpen,
  professor: UserCheck,
  group: Users,
  student: Users,
};

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function MobileOverlay({ onClick }: { onClick: () => void }) {
  return <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onClick} />;
}

/**
 * Parse hierarchy URL segments into structured data.
 * Returns an ordered list of { type, id, name } for each entity in the path.
 */
function parseHierarchyPath(
  pathname: string,
  entityOrder: HierarchyEntity[],
): Array<{ type: HierarchyEntity; id?: string; isLast: boolean }> {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "hierarchy" || segments.length < 2) return [];

  const result: Array<{ type: HierarchyEntity; id?: string; isLast: boolean }> = [];
  const validEntities: HierarchyEntity[] = ["level", "field", "professor", "group", "student"];

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (validEntities.includes(seg as HierarchyEntity)) {
      const nextSeg = segments[i + 1];
      const hasId = nextSeg && !validEntities.includes(nextSeg as HierarchyEntity);
      result.push({
        type: seg as HierarchyEntity,
        id: hasId ? nextSeg : undefined,
        isLast: false,
      });
      if (hasId) i++; // skip the id segment
    }
  }

  if (result.length > 0) {
    result[result.length - 1].isLast = true;
  }

  return result;
}

export default function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { t } = useTranslation();
  const { entityOrder, getEntityLabel } = useHierarchyConfig();
  const brandLogo = useBrandLogo();
  const { data: system } = useSystemSettings();
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);

  const features = system?.features;
  const systemName = system?.system_name?.trim() || t("app.name");

  /** Hierarchy entities whose module is switched off, per feature toggle. */
  const ENTITY_FEATURE: Partial<Record<HierarchyEntity, FeatureKey>> = {
    level: "levels",
    field: "fields",
    professor: "professors",
    group: "groups",
    student: "students",
  };
  const visibleEntities = entityOrder.filter((entity) =>
    ENTITY_FEATURE[entity] ? isFeatureEnabled(features, ENTITY_FEATURE[entity] as FeatureKey) : true,
  );
  /** Financial screens, mapped to their own feature toggle. */
  const FINANCIAL_FEATURE: Record<string, FeatureKey> = {
    "/financial": "financial.dashboard",
    "/financial/payments": "financial.studentPayments",
    "/financial/professors": "financial.professorPayments",
    "/financial/analytics": "financial.analytics",
    "/financial/reports": "financial.reports",
    "/financial/transactions": "financial.transactions",
    "/financial/settings": "financial.settings",
  };
  const financialItems = FINANCIAL_NAV_ITEMS.filter((item) =>
    isFeatureEnabled(features, FINANCIAL_FEATURE[item.href]),
  );
  const financialEnabled = financialItems.length > 0;
  const adminItems = ADMIN_NAV_ITEMS.filter((item) => {
    if (item.href === "/import") return isFeatureEnabled(features, "import");
    if (item.href === "/audit") return isFeatureEnabled(features, "audit");
    return true;
  });

  // Auto-expand hierarchy section when on a hierarchy page
  const isOnHierarchyPage = pathname.startsWith("/hierarchy");
  const isOnFinancialPage = pathname.startsWith("/financial");
  useEffect(() => {
    if (isOnHierarchyPage) {
      setHierarchyOpen(true);
    }
    if (isOnFinancialPage) {
      setFinancialOpen(true);
    }
  }, [isOnHierarchyPage, isOnFinancialPage]);

  const handleLogout = async () => {
    logout();
    router.push("/login");
  };

  const hierarchyPath = parseHierarchyPath(pathname, entityOrder);

  /**
   * The catch-all route shows the NEXT entity after the last URL pair when
   * that pair carries an id (/hierarchy/field/abc displays professors, not
   * fields). Mirror that rule here so the highlighted item always matches
   * the page being viewed.
   */
  const activeEntity = useMemo(() => {
    if (hierarchyPath.length === 0) {
      // The bare /hierarchy route renders the first entity's list (levels).
      if (pathname === "/hierarchy") return entityOrder[0] ?? null;
      return null;
    }
    const last = hierarchyPath[hierarchyPath.length - 1];
    if (!last.id) return last.type;
    const idx = entityOrder.indexOf(last.type);
    if (idx >= 0 && idx < entityOrder.length - 1) return entityOrder[idx + 1];
    return last.type;
  }, [hierarchyPath, entityOrder, pathname]);

  return (
    <>
      {mobileOpen && <MobileOverlay onClick={onCloseMobile} />}
      <aside
        className={`fixed top-0 left-0 z-50 h-screen glass-sidebar border-r border-border text-text-primary flex flex-col transition-all duration-150 ${
          collapsed ? "w-[68px]" : "w-60"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-border">
          {!collapsed && (
            <Link href="/dashboard" className="flex items-center gap-2">
              {brandLogo ? (
                <img src={brandLogo} alt={systemName} className="h-8 w-8 rounded-btn object-contain" />
              ) : (
                <BrandMark name={systemName} className="h-8 w-8 text-[11px]" />
              )}
              <span className="font-bold text-sm tracking-tight truncate">{systemName}</span>
            </Link>
          )}
          {collapsed && (
            <Link href="/dashboard" className="mx-auto">
              {brandLogo ? (
                <img src={brandLogo} alt={systemName} className="h-8 w-8 rounded-btn object-contain" />
              ) : (
                <BrandMark name={systemName} className="h-8 w-8 text-[11px]" />
              )}
            </Link>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleCollapse}
              className="hidden lg:flex h-8 w-8 items-center justify-center rounded-btn hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-text-secondary"
              aria-label={collapsed ? t("common.expandSidebar") : t("common.collapseSidebar")}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <button
              onClick={onCloseMobile}
              className="lg:hidden flex h-8 w-8 items-center justify-center rounded-btn hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-text-secondary"
              aria-label={t("common.closeMenu")}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-4 px-3 space-y-1">
          {MAIN_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? "bg-black/[0.06] dark:bg-white/[0.08] text-text-primary font-semibold"
                    : "text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary"
                }`}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span>{t(item.label)}</span>}
              </Link>
            );
          }          )}

          {/* Financial Management section */}
          {financialEnabled && (
            <>
              {!collapsed ? (
            <div>
              <button
                onClick={() => setFinancialOpen(!financialOpen)}
                className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium transition-colors duration-150 w-full ${
                  isOnFinancialPage
                    ? "bg-black/[0.06] dark:bg-white/[0.08] text-text-primary font-semibold"
                    : "text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary"
                }`}
              >
                <Wallet size={18} className="shrink-0" />
                <span className="flex-1 text-left">{t("nav.financialManagement")}</span>
                <ChevronDown size={14} className={`transition-transform duration-150 ${financialOpen ? "rotate-180" : ""}`} />
              </button>
              {financialOpen && (
                <div className="ml-6 mt-1 space-y-1 border-l border-border pl-3">
                  {financialItems.map((item) => {
                    // The dashboard sits at the segment root, so prefix matching
                    // would light it up on every financial screen.
                    const isActive = item.exact
                      ? pathname === item.href
                      : pathname === item.href || pathname.startsWith(item.href + "/");
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onCloseMobile}
                        className={`flex items-center gap-2 rounded-btn px-3 py-2 text-xs font-medium transition-colors duration-150 ${
                          isActive
                            ? "bg-black/[0.06] dark:bg-white/[0.08] text-text-primary font-semibold"
                            : "text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary"
                        }`}
                      >
                        <Icon size={14} className="shrink-0" />
                        <span>{t(item.label)}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Collapsed financial */
            <div className="flex flex-col items-center">
              <button
                onClick={() =>
                  router.push(financialItems[0]?.href ?? "/financial")
                }
                className={`flex items-center justify-center w-full py-2.5 rounded-btn transition-colors duration-150 ${
                  isOnFinancialPage
                    ? "bg-black/[0.06] dark:bg-white/[0.08] text-text-primary"
                    : "text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary"
                }`}
                aria-label={t("nav.financialManagement")}
                title={t("nav.financialManagement")}
              >
                <Wallet size={18} />
              </button>
            </div>
          )}
            </>
          )}

          {/* Hierarchy section */}
          {!collapsed ? (
            <div>
              <button
                onClick={() => setHierarchyOpen(!hierarchyOpen)}
                className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium transition-colors duration-150 w-full ${
                  isOnHierarchyPage
                    ? "bg-black/[0.06] dark:bg-white/[0.08] text-text-primary font-semibold"
                    : "text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary"
                }`}
              >
                <Network size={18} className="shrink-0" />
                <span className="flex-1 text-left">{t("nav.fields")}</span>
                <ChevronDown size={14} className={`transition-transform duration-150 ${hierarchyOpen ? "rotate-180" : ""}`} />
              </button>
              {hierarchyOpen && (
                <div className="ml-6 mt-1 space-y-1 border-l border-border pl-3">
                  {visibleEntities.map((entity) => {
                    const isEntityActive = activeEntity === entity;
                    const Icon = ENTITY_ICONS[entity];
                    // Build root href for this entity type
                    const rootHref = `/hierarchy/${entity}`;
                    return (
                      <Link
                        key={entity}
                        href={rootHref}
                        onClick={onCloseMobile}
                        className={`flex items-center gap-2 rounded-btn px-3 py-2 text-xs font-medium transition-colors duration-150 ${
                          isEntityActive
                            ? "bg-black/[0.06] dark:bg-white/[0.08] text-text-primary font-semibold"
                            : "text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary"
                        }`}
                      >
                        <Icon size={14} className="shrink-0" />
                        <span>{getEntityLabel(entity)}</span>
                      </Link>
                    );
                  })}

                  </div>
              )}
            </div>
          ) : (
            /* Collapsed hierarchy */
            <div className="flex flex-col items-center">
              <button
                onClick={() =>
                  router.push(visibleEntities[0] ? `/hierarchy/${visibleEntities[0]}` : "/hierarchy")
                }
                className={`flex items-center justify-center w-full py-2.5 rounded-btn transition-colors duration-150 ${
                  isOnHierarchyPage
                    ? "bg-black/[0.06] dark:bg-white/[0.08] text-text-primary"
                    : "text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary"
                }`}
                aria-label={t("nav.fields")}
                title={t("nav.fields")}
              >
                <Network size={18} className="shrink-0" />
              </button>
            </div>
          )}

          <div className="!my-2 border-t border-border" />

          {adminItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? "bg-black/[0.06] dark:bg-white/[0.08] text-text-primary font-semibold"
                    : "text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary"
                }`}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="min-w-0 truncate">{t(item.label)}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3 space-y-2">
          <ContactSupport collapsed={collapsed} />
          {!collapsed && user && (
            <div className="flex items-center gap-3 px-2 py-1">
              <div className="h-8 w-8 rounded-full bg-neutral-soft text-neutral-strong flex items-center justify-center text-xs font-bold shrink-0">
                {user.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.full_name}</p>
                <p className="text-xs text-text-secondary capitalize">
                  {user.role.replace("_", " ")}
                </p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary transition-colors w-full"
          >
            <LogOut size={16} className="shrink-0" />
            {!collapsed && <span>{t("nav.signOut")}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

export { MobileOverlay };
