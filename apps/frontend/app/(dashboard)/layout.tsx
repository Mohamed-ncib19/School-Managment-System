"use client";

import AuthGuard from "@/components/shared/auth-guard";
import DashboardShell from "@/components/shared/dashboard-shell";
import { CurrencyConfigProvider } from "@/components/shared/currency-config-provider";

/**
 * The shell lives here rather than inside each page so the sidebar and navbar
 * stay mounted across navigations — pages swap out underneath them.
 */
export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <CurrencyConfigProvider>
        <DashboardShell>{children}</DashboardShell>
      </CurrencyConfigProvider>
    </AuthGuard>
  );
}
