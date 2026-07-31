"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useTranslation } from "@/lib/i18n/context";

const MAIN_NAV_ITEMS = [
  { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
  { href: "/students", label: "nav.students", icon: Users },
  { href: "/payments", label: "nav.payments", icon: CircleDollarSign },
  { href: "/import", label: "nav.import", icon: Upload },
];

const ADMIN_NAV_ITEMS = [
  { href: "/audit", label: "nav.audit", icon: UserCog },
  { href: "/settings", label: "nav.settings", icon: Settings },
];

interface HierarchyItem {
  href: string;
  rootHref: string;
  label: string;
  icon: any;
  pattern: RegExp;
}

const HIERARCHY_ITEMS: HierarchyItem[] = [
  { href: "/fields", rootHref: "/fields", label: "fieldsHierarchy.breadcrumbFields", icon: BookOpen, pattern: /^\/fields\/?$/ },
  { href: "/fields/{id}/professors", rootHref: "/professors", label: "fieldsHierarchy.breadcrumbProfessors", icon: UserCheck, pattern: /^\/fields\/[^/]+\/professors\/?$/ },
  { href: "/fields/{id}/professors/{profId}/levels", rootHref: "/levels", label: "fieldsHierarchy.breadcrumbLevels", icon: BookOpen, pattern: /^\/fields\/[^/]+\/professors\/[^/]+\/levels\/?$/ },
  { href: "/fields/{id}/professors/{profId}/levels/{levelId}/groups", rootHref: "/groups", label: "fieldsHierarchy.breadcrumbGroups", icon: Users, pattern: /^\/fields\/[^/]+\/professors\/[^/]+\/levels\/[^/]+\/groups\/?$/ },
  { href: "/fields/{id}/professors/{profId}/levels/{levelId}/groups/{groupId}/students", rootHref: "/students", label: "fieldsHierarchy.breadcrumbStudents", icon: Users, pattern: /^\/fields\/[^/]+\/professors\/[^/]+\/levels\/[^/]+\/groups\/[^/]+\/students\/?$/ },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function MobileOverlay({ onClick }: { onClick: () => void }) {
  return <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onClick} />;
}

function getHierarchyLevel(pathname: string): number {
  if (/^\/(professors|levels|groups|students)$/.test(pathname)) {
    const map: Record<string, number> = { professors: 1, levels: 2, groups: 3, students: 4 };
    const match = pathname.match(/^\/(professors|levels|groups|students)$/);
    if (match) return map[match[1]];
  }
  for (let i = HIERARCHY_ITEMS.length - 1; i >= 0; i--) {
    if (HIERARCHY_ITEMS[i].pattern.test(pathname)) {
      return i;
    }
  }
  return -1;
}

export default function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { t } = useTranslation();
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [activeHierarchyLevel, setActiveHierarchyLevel] = useState<number>(-1);

  const handleLogout = async () => {
    logout();
    router.push("/login");
  };

  const currentHierarchyLevel = getHierarchyLevel(pathname);
  const isInHierarchy = currentHierarchyLevel >= 0;
  const isFieldsActive = pathname === "/fields" || pathname.startsWith("/fields/") || /^\/(professors|levels|groups|students)$/.test(pathname);

  useEffect(() => {
    setActiveHierarchyLevel(currentHierarchyLevel);
  }, [currentHierarchyLevel]);

  const resolveHierarchyHref = (item: HierarchyItem): string => {
    if (!isInHierarchy) {
      return item.rootHref;
    }

    const fieldIdMatch = pathname.match(/^\/fields\/([^/]+)/);
    const profIdMatch = pathname.match(/\/professors\/([^/]+)/);
    const levelIdMatch = pathname.match(/\/levels\/([^/]+)/);
    const groupIdMatch = pathname.match(/\/groups\/([^/]+)/);

    const fieldId = fieldIdMatch?.[1];
    const profId = profIdMatch?.[1];
    const levelId = levelIdMatch?.[1];
    const groupId = groupIdMatch?.[1];

    if (item.href === "/fields") return "/fields";
    if (item.href.includes("professors") && !item.href.includes("levels")) {
      if (fieldId) return `/fields/${fieldId}/professors`;
      return item.rootHref;
    }
    if (item.href.includes("levels") && !item.href.includes("groups")) {
      if (fieldId && profId) return `/fields/${fieldId}/professors/${profId}/levels`;
      return item.rootHref;
    }
    if (item.href.includes("groups") && !item.href.includes("students")) {
      if (fieldId && profId && levelId) return `/fields/${fieldId}/professors/${profId}/levels/${levelId}/groups`;
      return item.rootHref;
    }
    if (item.href.includes("students")) {
      if (fieldId && profId && levelId && groupId) return `/fields/${fieldId}/professors/${profId}/levels/${levelId}/groups/${groupId}/students`;
      return item.rootHref;
    }

    return item.href;
  };

  return (
    <>
      {mobileOpen && <MobileOverlay onClick={onCloseMobile} />}
      <aside
                 className={`fixed top-0 left-0 z-50 h-screen bg-primary dark:bg-primary-900 text-white flex flex-col transition-all duration-150 ${
          collapsed ? "w-[68px]" : "w-60"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-white/10">
          {!collapsed && (
            <Link href="/dashboard" className="flex items-center gap-2">
              <img src="/images/logo.png" alt={t("app.name", "IQ Academy")} className="h-8 w-8 rounded-btn object-contain" />
              <span className="font-bold text-sm tracking-tight">{t("app.name", "IQ Academy")}</span>
            </Link>
          )}
          {collapsed && (
            <Link href="/dashboard" className="mx-auto">
              <img src="/images/logo.png" alt={t("app.name", "IQ Academy")} className="h-8 w-8 rounded-btn object-contain" />
            </Link>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleCollapse}
              className="hidden lg:flex h-8 w-8 items-center justify-center rounded-btn hover:bg-white/10 transition-colors"
              aria-label={collapsed ? t("common.expandSidebar") : t("common.collapseSidebar")}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <button
              onClick={onCloseMobile}
              className="lg:hidden flex h-8 w-8 items-center justify-center rounded-btn hover:bg-white/10"
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
                  isActive ? "bg-gold text-primary shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span>{t(item.label)}</span>}
              </Link>
            );
          })}

          {!collapsed ? (
            <div>
              <button
                onClick={() => setHierarchyOpen(!hierarchyOpen)}
                className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium transition-colors duration-150 w-full ${
                  isFieldsActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Network size={18} className="shrink-0" />
                <span className="flex-1 text-left">{t("nav.fields")}</span>
                <ChevronDown size={14} className={`transition-transform duration-150 ${hierarchyOpen ? "rotate-180" : ""}`} />
              </button>
              {hierarchyOpen && (
                <div className="ml-6 mt-1 space-y-1 border-l-2 border-white/10 pl-3">
                  {HIERARCHY_ITEMS.map((item, index) => {
                    const isActive = activeHierarchyLevel === index;
                    const Icon = item.icon;
                    const resolvedHref = resolveHierarchyHref(item);
                    const isBaseFields = index === 0;
                    return (
                      <Link
                        key={item.href}
                        href={resolvedHref}
                        onClick={onCloseMobile}
                        className={`flex items-center gap-2 rounded-btn px-3 py-2 text-xs font-medium transition-colors duration-150 ${
                          isActive ? "bg-gold text-primary shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <Icon size={14} className="shrink-0" />
                        <span>{t(item.label)}</span>
                      </Link>
                    );
                  })}

                  {isInHierarchy && (
                    <div className="mt-3 p-2 rounded-card bg-white/5 border border-white/10">
                      <p className="text-[10px] uppercase tracking-wider text-white/40 px-1 mb-2">{t("common.currentPosition", "Current Path")}</p>
                      <div className="space-y-1.5">
                        {HIERARCHY_ITEMS.slice(0, activeHierarchyLevel + 1).map((item, index) => {
                          const isActive = index === activeHierarchyLevel;
                          const Icon = item.icon;
                          return (
                            <div key={`path-${item.href}`} className="flex items-center gap-2">
                              <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${isActive ? "bg-gold" : "bg-white/30"}`} />
                              <Icon size={12} className={`shrink-0 ${isActive ? "text-gold" : "text-white/40"}`} />
                              <span className={`text-[11px] truncate ${isActive ? "text-white font-medium" : "text-white/50"}`}>
                                {t(item.label)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <button
                onClick={() => setHierarchyOpen(!hierarchyOpen)}
                className={`flex items-center justify-center w-full py-2.5 rounded-btn transition-colors duration-150 ${
                  isFieldsActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
                aria-label={t("nav.fields")}
              >
                <Network size={18} className="shrink-0" />
              </button>
              {hierarchyOpen && isInHierarchy && (
                <div className="mt-2 space-y-1 w-full">
                  {HIERARCHY_ITEMS.map((item, index) => {
                    const isActive = currentHierarchyLevel === index;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={resolveHierarchyHref(item)}
                        onClick={onCloseMobile}
                        className={`flex items-center justify-center w-full py-2 rounded-btn transition-colors duration-150 ${
                          isActive ? "bg-gold text-primary shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white"
                        }`}
                        aria-label={t(item.label)}
                      >
                        <Icon size={14} className="shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="!my-2 border-t border-white/10" />

          {ADMIN_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  isActive ? "bg-gold text-primary shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span>{t(item.label)}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3 space-y-2">
          {!collapsed && user && (
            <div className="flex items-center gap-3 px-2 py-1">
              <div className="h-8 w-8 rounded-full bg-sky-300/20 flex items-center justify-center text-xs font-bold shrink-0">
                {user.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.full_name}</p>
                <p className="text-xs text-white/50 capitalize">
                  {user.role.replace("_", " ")}
                </p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors w-full"
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
