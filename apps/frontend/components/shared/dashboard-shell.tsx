"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/shared/sidebar";
import Navbar from "@/components/shared/navbar";

/** Most specific route first — the first match wins. */
const TITLES: ReadonlyArray<[RegExp, string]> = [
  [/^\/fields\/[^/]+\/professors\/[^/]+\/levels\/[^/]+\/groups\/[^/]+\/students/, "Students"],
  [/^\/fields\/[^/]+\/professors\/[^/]+\/levels\/[^/]+\/groups/, "Groups"],
  [/^\/fields\/[^/]+\/professors\/[^/]+\/levels/, "Levels"],
  [/^\/fields\/[^/]+\/professors/, "Professors"],
  [/^\/fields/, "Fields & Hierarchy"],
  [/^\/students\/[^/]+\/payments/, "Payment History"],
  [/^\/payments/, "Payments"],
  [/^\/import/, "Import Data"],
  [/^\/teachers/, "Teachers"],
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

  return (
    <div className="min-h-screen flex bg-background">
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
        />
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
