"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/shared/sidebar";
import Navbar from "@/components/shared/navbar";
import PageBreadcrumbs from "@/components/shared/page-breadcrumbs";
import ShutdownFailedBanner from "@/components/shared/shutdown-failed-banner";

/** Most specific route first — the first match wins. */
const TITLES: ReadonlyArray<[RegExp, string]> = [
  [/^\/hierarchy/, "Hierarchy"],
  [/^\/attendance-sheet/, "Attendance Sheet"],
  [/^\/students\/[^/]+\/payments/, "Payment History"],
  [/^\/payments/, "Payments"],
  [/^\/import/, "Import Data"],
  [/^\/audit/, "Audit"],
  [/^\/settings/, "Settings"],
  [/^\/dashboard/, "Dashboard"],
];

function titleFor(pathname: string) {
  return TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? "Dashboard";
}

/**
 * Rendered once by the (dashboard) layout. AuthGuard already withholds the tree
 * until after mount, so there's no SSR mismatch to guard against here.
 */
export default function DashboardShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Hierarchy screens (catch-all route, flat entity pages and student screens)
  // get the entity-name breadcrumb; everywhere else keeps the static title.
  const showBreadcrumb = /^\/(hierarchy|levels|professors|groups|students)(\/|$)/.test(pathname);

  return (
    <div className="min-h-screen flex bg-background">
      <ShutdownFailedBanner />
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div
        className={`flex-1 flex flex-col min-h-screen transition-all duration-150 ${
          collapsed ? "lg:ml-[68px]" : "lg:ml-60"
        }`}
      >
        <Navbar
          onToggleSidebar={() => setMobileOpen(!mobileOpen)}
          title={titleFor(pathname)}
          breadcrumb={showBreadcrumb ? <PageBreadcrumbs pathname={pathname} /> : undefined}
        />
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
