"use client";

import { useState } from "react";
import { Power } from "lucide-react";
import { systemApi } from "@/lib/api/system.api";
import { useTranslation } from "@/lib/i18n/context";

/**
 * The Shut Down button in the navbar. Confirms, calls POST /api/system/stop
 * (super_admin), which spawns the platform stop engine; the engine kills the
 * API and web servers and (Windows) the portable database, so this tab dies
 * right after the confirmation is shown. PostgreSQL on macOS/Linux keeps
 * running by design — same as the old stop scripts.
 */
export default function ShutdownButton() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [failed, setFailed] = useState(false);

  const confirmShutdown = async () => {
    setShuttingDown(true);
    setFailed(false);
    try {
      const result = await systemApi.stop();
      if (!result.ok || !result.started) setFailed(true);
    } catch {
      setFailed(true);
    }
  };

  return (
    <>
      <button
        onClick={() => setShow(true)}
        className="h-9 w-9 flex items-center justify-center rounded-btn bg-background border border-border hover:bg-danger/10 hover:border-danger/40 transition-colors"
        aria-label={t("system.shutdownAria")}
        title={t("system.shutdownAria")}
      >
        <Power size={16} className="text-text-secondary" />
      </button>

      {show && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="shutdown-title"
          aria-describedby="shutdown-body"
          onClick={() => !shuttingDown && setShow(false)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-modal bg-surface p-6 shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="shutdown-title" className="mb-2 text-h4 font-bold text-text-primary">
              {t("system.shutdownTitle")}
            </h3>

            {failed ? (
              <p role="alert" className="mb-6 text-sm text-danger">{t("system.shutdownFailed")}</p>
            ) : shuttingDown ? (
              <p className="mb-6 text-sm text-text-secondary">{t("system.shuttingDown")}</p>
            ) : (
              <p id="shutdown-body" className="mb-6 text-sm text-text-secondary">
                {t("system.shutdownConfirm")}
              </p>
            )}

            <div className="flex justify-end gap-3">
              {!shuttingDown && (
                <button className="btn btn-secondary text-sm" onClick={() => setShow(false)}>
                  {t("system.cancel")}
                </button>
              )}
              {!failed && (
                <button
                  className="btn btn-danger text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={confirmShutdown}
                  disabled={shuttingDown}
                  aria-busy={shuttingDown || undefined}
                >
                  {shuttingDown ? t("system.stopping") : t("system.shutdownNow")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}