"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Power, PowerOff } from "lucide-react";
import { systemApi } from "@/lib/api/system.api";
import { useTranslation } from "@/lib/i18n/context";

/**
 * The Shut Down button in the navbar. Confirms, calls POST /api/system/stop
 * (super_admin), which spawns the platform stop engine; the engine kills the
 * API and web servers and (Windows) the portable database, so this tab dies
 * right after the confirmation is shown. PostgreSQL on macOS/Linux keeps
 * running by design — same as the old stop scripts.
 *
 * While the engine works the modal shows a staged progress. The browser
 * cannot poll the backend for real engine state (the engine kills it), so the
 * stages mirror the engine's own order — web portal, API, database, then
 * verify — and tick locally. Once the request succeeds the tab reloads itself
 * after the engine window (~16s), landing on the browser's offline page once
 * the servers are down. If a reload ever happens while the servers are still
 * up (engine failure), the ShutdownFailedBanner catches it on the next boot.
 */
const SHUTDOWN_STEPS = ["shutdownStep1", "shutdownStep2", "shutdownStep3", "shutdownStep4"] as const;

export const SHUTDOWN_PENDING_FLAG = "sms_shutdown_pending";

export default function ShutdownButton() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState(0);

  const confirmShutdown = async () => {
    setShuttingDown(true);
    setFailed(false);
    try {
      const result = await systemApi.stop();
      if (!result.ok || !result.started) {
        setFailed(true);
      } else {
        // The engine needs a few seconds to kill the web server — reloading
        // right away would bring the app back up. Wait past the engine's
        // window, then reload: the tab should now hit "can't reach".
        setTimeout(() => {
          try {
            sessionStorage.setItem(SHUTDOWN_PENDING_FLAG, "1");
          } catch {
            /* ignore */
          }
          window.location.reload();
        }, 16_000);
      }
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    if (!shuttingDown || failed) return;
    // The engine order: web portal, API, (portable) database, port check.
    const stepTimer = setInterval(() => setStep((s) => (s < SHUTDOWN_STEPS.length - 1 ? s + 1 : s)), 4000);
    return () => clearInterval(stepTimer);
  }, [shuttingDown, failed]);

  const progress = ((step + 1) / SHUTDOWN_STEPS.length) * 100;

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

      {show &&
        createPortal(
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
              <div className="mb-6">
                <p id="shutdown-body" className="mb-4 text-sm text-text-secondary">
                  {t("system.shuttingDown")}
                </p>

                <div
                  className="flex items-start gap-3 rounded-btn border border-border bg-background p-3"
                  role="progressbar"
                  aria-label={t("system.shutdownProgress")}
                  aria-valuenow={Math.round(progress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <PowerOff size={16} className="mt-0.5 shrink-0 text-text-secondary" />
                  <div className="min-w-0 flex-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft dark:bg-white/10">
                      <div
                        className="h-full rounded-full bg-gold transition-all duration-700 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs font-medium text-text-primary">{t(SHUTDOWN_STEPS[step])}</p>
                    <p className="mt-0.5 text-[11px] text-text-secondary">
                      {t("system.shutdownProgress")}
                    </p>
                  </div>
                </div>
              </div>
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
</div>,
          document.body,
        )}
    </>
  );
}