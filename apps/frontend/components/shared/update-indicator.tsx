"use client";

import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useUpdateStore } from "@/hooks/use-update-store";
import { useTranslation } from "@/lib/i18n/context";

/**
 * The update pill in the navbar (every dashboard page). Reads the shared
 * update store: a small gold dot on the icon means a new version is available
 * on the release branch. Clicking it re-checks against GitHub (bypassing the
 * backend cache) and opens the same modal as the automatic notifier.
 */
export default function UpdateIndicator() {
  const { t } = useTranslation();
  const status = useUpdateStore((s) => s.status);
  const checking = useUpdateStore((s) => s.checking);
  const available = Boolean(status?.available);

  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    const result = await useUpdateStore.getState().refresh(true);
    setBusy(false);
    if (result?.available) useUpdateStore.getState().openDialog();
  };

  return (
    <button
      onClick={onClick}
      className="relative h-9 w-9 flex items-center justify-center rounded-btn bg-background border border-border hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors"
      aria-label={t("updates.indicatorAria")}
      title={t("updates.indicatorAria")}
      aria-busy={busy || checking || undefined}
    >
      {busy || checking ? (
        <RefreshCw size={16} className="animate-spin text-text-secondary" />
      ) : (
        <Download size={16} className="text-text-secondary" />
      )}
      {available && !busy && !checking && (
        <span
          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold ring-2 ring-surface"
          aria-hidden="true"
        />
      )}
    </button>
  );
}