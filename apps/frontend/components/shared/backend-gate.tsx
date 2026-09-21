"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ServerCog } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";

/**
 * Backend availability overlay — mounted in the root layout as a SIBLING of
 * the app, never as a wrapper around it.
 *
 * Design rules (each one earned the hard way):
 *
 * 1. Children are ALWAYS rendered, unconditionally. The overlay merely covers
 *    the screen (fixed, opaque, top z-index). Conditional rendering of the
 *    app from here caused fatal root-level hydration mismatches.
 * 2. The overlay is client-state-only: server HTML and the first client
 *    render are identical (no overlay). It appears only after a health check
 *    has actually failed in the browser, so SSR can never disagree with
 *    hydration.
 * 3. Recovery reloads the page at most once per load; manual buttons always
 *    work. A flapping backend can never loop reloads.
 *
 * Situations covered:
 * - Boot: portal opened while the backend is still starting → "Démarrage…".
 * - Mid-session dropout (e.g. the updates engine restarting the service):
 *   ~30 s of failed checks → "Reconnexion…", auto-reload on recovery.
 */

/** Seconds gated before the manual-retry panel replaces the spinner. */
const STUCK_AFTER_SECONDS = 300;
/** Poll cadence while gated. */
const BOOT_POLL_MS = 2_000;
/** Watchdog cadence while healthy, and failures before alarming. */
const WATCH_POLL_MS = 10_000;
const WATCH_FAILURES_BEFORE_GATE = 3;

type GateState =
  | null
  | { kind: "boot" | "reconnect"; since: number }
  | { kind: "stuck" | "recovered"; since: number };

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes} min ${String(seconds).padStart(2, "0")} s`
    : `${seconds} s`;
}

export function BackendGate() {
  const { t } = useTranslation();
  const [gate, setGate] = useState<GateState>(null);

  const hasReloadedRef = useRef(false);
  const watchFailuresRef = useRef(0);
  const gateRef = useRef<GateState>(null);
  gateRef.current = gate;

  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const reloadOnce = useCallback(() => {
    if (hasReloadedRef.current) return;
    hasReloadedRef.current = true;
    window.location.reload();
  }, []);

  // One unified loop, started on mount (client only, so no SSR divergence):
  // - no gate active: light watchdog; 3 straight failures opens the gate.
  // - gate active: fast polling; first success closes it (reload once).
  // Self-scheduling setTimeout so the cadence can adapt per iteration.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const ok = await checkHealth();
      if (cancelled) return;
      const current = gateRef.current;

      if (current === null) {
        if (!ok) {
          watchFailuresRef.current += 1;
          if (watchFailuresRef.current >= WATCH_FAILURES_BEFORE_GATE) {
            setGate({ kind: "boot", since: Date.now() });
          }
        } else {
          watchFailuresRef.current = 0;
        }
      } else if (ok) {
        setGate((g) => (g && g.kind !== "recovered" ? { kind: "recovered", since: g.since } : g));
        reloadOnce();
      } else {
        const heldFor = (Date.now() - current.since) / 1000;
        if (current.kind === "boot" && heldFor >= STUCK_AFTER_SECONDS) {
          setGate({ kind: "stuck", since: current.since });
        } else if (current.kind === "recovered") {
          // Recovery reload didn't happen (or failed) and the backend died
          // again — go back to reconnecting instead of a stale banner.
          setGate({ kind: "reconnect", since: current.since });
        }
      }

      if (!cancelled) {
        const delay = gateRef.current === null ? WATCH_POLL_MS : BOOT_POLL_MS;
        timer = setTimeout(tick, delay);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkHealth, reloadOnce]);

  if (gate === null) return null;

  const stuck = gate.kind === "stuck";
  const recovered = gate.kind === "recovered";
  const reconnect = gate.kind === "reconnect";
  const elapsed = formatElapsed(Math.round((Date.now() - gate.since) / 1000));

  const title = recovered
    ? t("backendGate.recoveredTitle", "Serveur de nouveau disponible")
    : reconnect
      ? t("backendGate.reconnectTitle", "Reconnexion au serveur…")
      : stuck
        ? t("backendGate.stuckTitle", "Le serveur tarde à répondre")
        : t("backendGate.startingTitle", "Démarrage du serveur…");

  const body = recovered
    ? t(
        "backendGate.recoveredBody",
        "L'application va se recharger automatiquement. Si rien ne se passe, cliquez ci-dessous.",
      )
    : reconnect
      ? t(
          "backendGate.reconnectBody",
          "La connexion au serveur a été perdue. Cette page se rechargera automatiquement dès qu'il sera de nouveau joignable.",
        )
      : stuck
        ? t(
            "backendGate.stuckBody",
            "L'application se rechargera automatiquement dès que le serveur sera prêt. Vous pouvez aussi réessayer maintenant.",
          )
        : t(
            "backendGate.startingBody",
            "L'application sera disponible dans un instant. Cette page se mettra à jour automatiquement.",
          );

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background"
      role="alert"
      aria-live="polite"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <ServerCog
            className={`h-8 w-8 text-primary ${recovered ? "" : "animate-pulse"}`}
            aria-hidden
          />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
          <p className="text-sm leading-relaxed text-text-secondary">{body}</p>
        </div>

        {!recovered && (
          <div className="h-1 w-40 overflow-hidden rounded-full bg-primary/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
          </div>
        )}

        {recovered ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-btn bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t("backendGate.reload", "Recharger maintenant")}
          </button>
        ) : (
          <p className="text-xs tabular-nums text-text-secondary">
            {t("backendGate.waitingFor", "En attente depuis")} {elapsed}
          </p>
        )}

        {stuck && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-btn bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t("backendGate.retry", "Réessayer maintenant")}
            </button>
            <p className="text-xs leading-relaxed text-text-secondary">
              {t(
                "backendGate.stuckHint",
                "Si le problème persiste, vérifiez que le service est démarré sur cette machine.",
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
