"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { systemApi } from "@/lib/api/system.api";
import { useTranslation } from "@/lib/i18n/context";
import { SHUTDOWN_PENDING_FLAG } from "@/components/shared/shutdown-button";

/**
 * After a shutdown from the web portal the tab reloads itself. If that
 * reload lands while the servers are still alive (the engine failed to stop
 * them), this banner — mounted in the dashboard shell — warns the operator
 * and suggests stop.bat. If the API is unreachable the shutdown worked and
 * nothing is shown (the browser's own offline page takes over anyway).
 */
export default function ShutdownFailedBanner() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let pending = false;
    try {
      pending = sessionStorage.getItem(SHUTDOWN_PENDING_FLAG) === "1";
    } catch {
      /* ignore */
    }
    if (!pending) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    systemApi
      .get()
      .then(() => setShow(true))
      .catch(() => {
        /* API unreachable → the system really is down */
      })
      .finally(() => {
        clearTimeout(timeout);
        try {
          sessionStorage.removeItem(SHUTDOWN_PENDING_FLAG);
        } catch {
          /* ignore */
        }
      });
    return () => controller.abort();
  }, []);

  if (!show) return null;

  return (
    <div
      className="fixed right-4 top-4 z-[60] flex max-w-sm items-start gap-3 rounded-modal border border-warning/40 bg-surface p-4 shadow-modal"
      role="alert"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-primary">{t("system.shutdownFailedTitle")}</p>
        <p className="mt-1 text-xs text-text-secondary">{t("system.shutdownFailedBanner")}</p>
      </div>
      <button
        type="button"
        onClick={() => setShow(false)}
        className="shrink-0 rounded-btn p-1 text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
        aria-label={t("system.close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}