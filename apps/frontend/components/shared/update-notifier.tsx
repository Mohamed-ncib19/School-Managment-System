"use client";

import { useEffect, useRef } from "react";
import { useUpdateStore } from "@/hooks/use-update-store";
import { updatesApi, UpdateStatus } from "@/lib/api/updates.api";
import { useTranslation } from "@/lib/i18n/context";
import UpdateProgressTracker from "./update-progress";

const SNOOZE_KEY = "update-snoozed-sha";
const PROGRESS_POLL_MS = 2_000;
const PROGRESS_MAX_MS = 25 * 60_000;
// The backend claims the journal as "running" before spawning the engine, so
// "idle" this long after "Update now" means the engine window never started —
// fail loudly instead of polling for 25 minutes.
const PROGRESS_IDLE_MS = 90_000;

/**
 * Polls the backend's update check while the dashboard is open. When a newer
 * commit exists on the release branch it shows a dialog:
 *
 *   "A new version is available"  ->  Update now / Update later
 *
 * "Update later" hides the dialog until a NEW sha arrives (the current one is
 * snoozed for this session). "Update now" calls /api/updates/apply, which the
 * backend answers before launching the update script; that script stops the
 * servers, pulls, migrates and restarts the app - so this page simply dies.
 * While the engine runs, /api/updates/progress is polled and rendered by
 * UpdateProgressTracker (shared with the Settings section).
 *
 * Status, dialog state and apply live in use-update-store so the navbar
 * indicator and the Settings section drive the same dialog.
 */
export default function UpdateNotifier() {
  const { t } = useTranslation();
  const status = useUpdateStore((s) => s.status);
  const open = useUpdateStore((s) => s.open);
  const applying = useUpdateStore((s) => s.applying);
  const failed = useUpdateStore((s) => s.failed);
  const progress = useUpdateStore((s) => s.progress);
  const snoozed = useRef<string | null>(null);

  const track = (result: UpdateStatus | null) => {
    if (!result) return;
    useUpdateStore.setState({ status: result });
    if (result.available && result.latest?.sha && result.latest.sha !== snoozed.current) {
      useUpdateStore.getState().openDialog();
    }
  };

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const RETRY_FAILED_MS = 5 * 60_000;

    const check = async (force: boolean) => {
      if (cancelled) return;
      const result = await useUpdateStore.getState().refresh(force);
      if (!result) return;
      track(result);
      // When the check itself failed (no git, no internet, bad token), retry
      // after 5 minutes instead of waiting for the next 30-minute poll so a
      // fixed token/config is picked up quickly.
      if (retryTimer) clearTimeout(retryTimer);
      if (result.reason) retryTimer = setTimeout(() => void check(true), RETRY_FAILED_MS);
    };
    void check(true);
    const minutes = Number(process.env.NEXT_PUBLIC_UPDATE_CHECK_MINUTES ?? "30");
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const timer = setInterval(() => void check(false), minutes * 60_000);
    const onFocus = () => void check(false);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While an update is being applied, follow the engine's progress journal
  // until it reports a terminal state (done / failed / stalled). The engine
  // stops these servers, so a terminal "done" is what the next boot sees.
  useEffect(() => {
    if (!applying) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;
      const p = await useUpdateStore.getState().refreshProgress();
      if (!p) return;
      if (p.state === "done" || p.state === "failed" || p.state === "stalled") {
        useUpdateStore.setState({ applying: false, failed: p.state !== "done" });
      } else if (Date.now() - startedAt > PROGRESS_MAX_MS) {
        useUpdateStore.setState({ applying: false, failed: true });
      } else if ((!p || p.state === "idle") && Date.now() - startedAt > PROGRESS_IDLE_MS) {
        // Engine never reported: no window, no journal. Tell the operator to
        // update via the desktop control panel (Stop, then Start) instead.
        useUpdateStore.setState({ applying: false, failed: true });
      }
    };

    void poll();
    timer = setInterval(poll, PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [applying]);

  const updateLater = () => {
    const sha = useUpdateStore.getState().status?.latest?.sha;
    if (sha) {
      snoozed.current = sha;
      try {
        sessionStorage.setItem(SNOOZE_KEY, sha);
      } catch {
        /* storage unavailable — keep it in-memory only */
      }
    }
    useUpdateStore.getState().closeDialog();
  };

  const updateNow = async () => {
    const store = useUpdateStore.getState();
    store.setFailed(false);
    store.setProgress(null);
    store.setApplying(true);
    try {
      const result = await updatesApi.apply();
      if (!result.ok || !result.started) {
        store.setApplying(false);
        store.setFailed(true);
      }
    } catch {
      store.setApplying(false);
      store.setFailed(true);
    }
  };

  if (!open || !status?.latest) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-title"
      aria-describedby="update-body"
    >
      <div className="mx-4 w-full max-w-md rounded-modal bg-surface p-6 shadow-modal">
        <h3 id="update-title" className="mb-2 text-h4 font-bold text-text-primary">
          {t("updates.title")}
        </h3>

        <p id="update-body" className="mb-4 text-sm text-text-secondary">
          {t("updates.availableText")}
        </p>

        {failed && (
          <p role="alert" className="mb-4 text-sm text-danger">
            {t("updates.failed")}
          </p>
        )}
        {applying && !progress && (
          <p className="mb-4 text-sm text-text-secondary">{t("updates.applying")}</p>
        )}
        {progress && progress.state !== "idle" && <UpdateProgressTracker />}

        <div className="flex justify-end gap-3">
          {!applying && (
            <button className="btn btn-secondary text-sm" onClick={updateLater}>
              {t("updates.later")}
            </button>
          )}
          <button
            className="btn btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-60"
            onClick={updateNow}
            disabled={applying}
            aria-busy={applying || undefined}
          >
            {applying ? t("updates.starting") : t("updates.now")}
          </button>
        </div>
      </div>
    </div>
  );
}