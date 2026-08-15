"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/shared/sidebar";
import Navbar from "@/components/shared/navbar";
import PageBreadcrumbs from "@/components/shared/page-breadcrumbs";
import ShutdownFailedBanner from "@/components/shared/shutdown-failed-banner";
import { AnimatedPage } from "@/components/shared/animated-page";
import WhiteboardFab from "@/components/shared/whiteboard-fab";

/** Most specific route first — the first match wins. */
const TITLES: ReadonlyArray<[RegExp, string]> = [
  [/^\/hierarchy/, "Hiérarchie"],
  [/^\/schedule\/entries/, "Séances d'Emploi du Temps"],
  [/^\/schedule\/classrooms/, "Salles de Classe"],
  [/^\/schedule\/time-slots/, "Plages Horaires"],
  [/^\/attendance-sheet/, "Feuille de Présence"],
  [/^\/students\/[^/]+\/payments/, "Historique des Paiements"],
  [/^\/payments/, "Paiements"],
  [/^\/financial\/payments/, "Paiements Étudiants"],
  [/^\/financial\/professors/, "Paiements Professeurs"],
  [/^\/financial\/analytics/, "Analytiques"],
  [/^\/financial\/reports/, "Rapports"],
  [/^\/financial\/transactions/, "Historique des Transactions"],
  [/^\/financial\/settings/, "Paramètres Financiers"],
  [/^\/financial/, "Finance"],
  [/^\/import/, "Import de Données"],
  [/^\/audit/, "Journal d'Audit"],
  [/^\/settings/, "Paramètres"],
  [/^\/dashboard/, "Tableau de bord"],
];

function titleFor(pathname: string) {
  return TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? "Tableau de bord";
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
          <AnimatedPage>{children}</AnimatedPage>
        </main>
      </div>
      <WhiteboardFab />
    </div>
  );
}
