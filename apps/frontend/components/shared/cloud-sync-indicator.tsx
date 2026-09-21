"use client";

import { useState } from "react";
import { Cloud, CloudOff, RefreshCw, AlertTriangle } from "lucide-react";
import { useCloudSyncStore } from "@/hooks/use-cloud-sync-store";
import { cloudBackupApi } from "@/lib/api/cloud-backup.api";
import { useToast } from "@/components/shared/toast";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils/format";
import type { SyncState } from "@/lib/api/cloud-backup.api";

const errorMessage = (err: unknown): string => {
  const axios = (err as any)?.response?.data;
  if (axios?.message) return Array.isArray(axios.message) ? axios.message.join(" ") : axios.message;
  return (err as Error)?.message ?? "Une erreur est survenue";
};

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
 * The cloud safe save button in the navbar. Clicking it forces a full backup
 * now (the same snapshot the auto mode and the Settings → Sauvegarde cloud
 * button run), then refreshes the status pill so the user sees the result.
 * The title/tooltip always carries the current state so the button doubles as
 * the status indicator.
 */
export default function CloudSyncIndicator() {
  const { t } = useTranslation();
  const toast = useToast();
  const status = useCloudSyncStore((s) => s.status);
  const checking = useCloudSyncStore((s) => s.checking);
  const [saving, setSaving] = useState(false);

  const state: SyncState = status?.state ?? "unconfigured";
  const meta = STATE_META[state];
  const dropboxFull = (status?.targets ?? []).some((target) => target.enabled && target.quotaFull);
  const pending = status?.queue.pending ?? 0;
  const busy = saving || checking;

  const label = dropboxFull
    ? t("cloudSafeSave.dropboxFullTitle", "Espace Dropbox plein")
    : pending > 0
      ? `${t(meta.labelKey)} — ${pending} ${t("cloudSafeSave.pendingEventsShort", "événement(s) en attente")}`
      : t(meta.labelKey);

  const actionLabel = dropboxFull
    ? t("cloudSafeSave.dropboxFullTitle", "Espace Dropbox plein")
    : t("cloudSafeSave.saveNow", "Sauvegarder dans le cloud maintenant");

  const saveNow = async () => {
    if (busy) return;
    setSaving(true);
    try {
      await cloudBackupApi.backupNow();
      toast.success(
        t("cloudSafeSave.saveStarted", "Sauvegarde cloud lancée"),
        t("cloudSafeSave.saveStartedDesc", "L'export complet est en cours — le statut se mettra à jour ici."),
      );
    } catch (err: any) {
      const message = errorMessage(err);
      if (/non configurée/i.test(message)) {
        toast.warning(
          t("cloudSafeSave.notConfigured", "Sauvegarde cloud non configurée"),
          t("cloudSafeSave.notConfiguredDesc", "Connectez une destination (Dropbox ou disque) dans Paramètres → Sauvegarde cloud."),
        );
      } else {
        toast.error(t("cloudSafeSave.saveFailed", "Sauvegarde impossible"), message);
      }
    } finally {
      setSaving(false);
      void useCloudSyncStore.getState().refresh();
    }
  };

  return (
    <button
      onClick={() => void saveNow()}
      className="relative h-9 w-9 flex items-center justify-center rounded-btn bg-background border border-border hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors disabled:opacity-60"
      aria-label={actionLabel}
      title={`${actionLabel} — ${label}`}
      aria-busy={busy || undefined}
      disabled={busy}
    >
      {busy ? (
        <RefreshCw size={16} className="animate-spin text-text-secondary" />
      ) : state === "offline" || dropboxFull ? (
        <CloudOff size={16} className="text-danger" />
      ) : state === "attention" ? (
        <AlertTriangle size={16} className={meta.color} />
      ) : (
        <Cloud size={16} className={meta.color} />
      )}
      {!busy && status && (
        <span
          className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-surface", meta.dot)}
          aria-hidden="true"
        />
      )}
    </button>
  );
}