"use client";

import AuthGuard from "@/components/shared/auth-guard";
import DashboardShell from "@/components/shared/dashboard-shell";
import UpdateNotifier from "@/components/shared/update-notifier";
import CloudSyncNotifier from "@/components/shared/cloud-sync-notifier";
import DropboxFullModal from "@/components/shared/dropbox-full-modal";
import { CurrencyConfigProvider } from "@/components/shared/currency-config-provider";

/**
 * The shell lives here rather than inside each page so the sidebar and navbar
 * stay mounted across navigations — pages swap out underneath them. The update
 * notifier sits here too so it can appear on top of any dashboard page.
 */
export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <CurrencyConfigProvider>
        <DashboardShell>{children}</DashboardShell>
        <UpdateNotifier />
        <DropboxFullModal />
        <CloudSyncNotifier />
      </CurrencyConfigProvider>
    </AuthGuard>
  );
}