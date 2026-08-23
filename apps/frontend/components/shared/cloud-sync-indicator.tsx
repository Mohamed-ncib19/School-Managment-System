"use client";

import { Cloud, CloudOff, RefreshCw, AlertTriangle } from "lucide-react";
import { useCloudSyncStore } from "@/hooks/use-cloud-sync-store";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils/format";
import type { SyncState } from "@/lib/api/cloud-backup.api";

const STATE_META: Record<SyncState, { labelKey: string; color: string; dot: string }> = {
  synced: {
    labelKey: "cloudSafeSave.statusSynced",
    color: "text-success-strong dark:text-success-dark-strong",
    dot: "bg-success dark:bg-success-dark",
  },
  offline: {
    labelKey: "cloudSafeSave.statusOffline",
    color: "text-danger",
    dot: "bg-danger",
  },
  syncing: {
    labelKey: "cloudSafeSave.statusSyncing",
    color: "text-text-secondary",
    dot: "bg-gold",
  },
  attention: {
    labelKey: "cloudSafeSave.statusAttention",
    color: "text-gold",
    dot: "bg-gold",
  },
  disabled: {
    labelKey: "cloudSafeSave.statusDisabled",
    color: "text-text-secondary",
    dot: "bg-text-disabled",
  },
  unconfigured: {
    labelKey: "cloudSafeSave.statusUnconfigured",
    color: "text-text-secondary",
    dot: "bg-text-disabled",
  },
};

/**
 * The cloud safe save pill in the navbar. Mirrors UpdateIndicator's styling
 * and reads the shared sync store (filled by CloudSyncNotifier). The pill is
 * always visible; clicking refreshes immediately and the title carries the
 * current state label.
 */
export default function CloudSyncIndicator() {
  const { t } = useTranslation();
  const status = useCloudSyncStore((s) => s.status);
  const checking = useCloudSyncStore((s) => s.checking);

  const state: SyncState = status?.state ?? "unconfigured";
  const meta = STATE_META[state];
  const label = t(meta.labelKey);

  return (
    <button
      onClick={() => void useCloudSyncStore.getState().refresh()}
      className="relative h-9 w-9 flex items-center justify-center rounded-btn bg-background border border-border hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors"
      aria-label={label}
      title={label}
      aria-busy={checking || undefined}
    >
      {checking ? (
        <RefreshCw size={16} className="animate-spin text-text-secondary" />
      ) : state === "offline" ? (
        <CloudOff size={16} className={meta.color} />
      ) : state === "attention" ? (
        <AlertTriangle size={16} className={meta.color} />
      ) : (
        <Cloud size={16} className={meta.color} />
      )}
      {!checking && status && (
        <span
          className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-surface", meta.dot)}
          aria-hidden="true"
        />
      )}
    </button>
  );
}