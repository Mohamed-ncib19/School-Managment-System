"use client";

import { Check, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useUpdateStore } from "@/hooks/use-update-store";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils/format";

/**
 * The update pill in the navbar (every dashboard page). Reads the shared
 * update store and shows one of three states:
 * - gold dot on the download icon : a new version is available
 * - green check + green dot        : the system is up to date
 * - plain download icon            : first check still in flight
 *
 * Clicking re-checks against GitHub (bypassing the backend cache) and opens
 * the update dialog when a new version exists.
 */
export default function UpdateIndicator() {
  const { t } = useTranslation();
  const status = useUpdateStore((s) => s.status);
  const checking = useUpdateStore((s) => s.checking);
  const available = Boolean(status?.available);
  const upToDate = Boolean(status?.checkedAt && !status.available);

  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    const result = await useUpdateStore.getState().refresh(true);
    setBusy(false);
    if (result?.available) useUpdateStore.getState().openDialog();
  };

  const label = upToDate ? t("updates.upToDateTitle") : t("updates.indicatorAria");

  return (
    <button
      onClick={onClick}
      className="relative h-9 w-9 flex items-center justify-center rounded-btn bg-background border border-border hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors"
      aria-label={label}
      title={label}
      aria-busy={busy || checking || undefined}
    >
      {busy || checking ? (
        <RefreshCw size={16} className="animate-spin text-text-secondary" />
      ) : upToDate ? (
        <Check size={16} className="text-success-strong dark:text-success-dark-strong" />
      ) : (
        <Download size={16} className="text-text-secondary" />
      )}
      {!busy && !checking && (available || upToDate) && (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-surface",
            available ? "bg-gold" : "bg-success dark:bg-success-dark",
          )}
          aria-hidden="true"
        />
      )}
    </button>
  );
}