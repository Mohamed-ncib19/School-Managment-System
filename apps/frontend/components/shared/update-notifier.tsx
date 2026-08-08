"use client";

import { useEffect, useRef } from "react";
import { useUpdateStore } from "@/hooks/use-update-store";
import { updatesApi, UpdateStatus } from "@/lib/api/updates.api";
import { useTranslation } from "@/lib/i18n/context";

const SNOOZE_KEY = "update-snoozed-sha";

function formatDate(date: string): string {
  if (!date) return "";
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
}

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
    const check = async () => {
      if (cancelled) return;
      track(await useUpdateStore.getState().refresh(false));
    };
    void check();
    const minutes = Number(process.env.NEXT_PUBLIC_UPDATE_CHECK_MINUTES ?? "30");
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const timer = setInterval(() => void check(), minutes * 60_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    store.setApplying(true);
    store.setFailed(false);
    try {
      const result = await updatesApi.apply();
      if (!result.ok || !result.started) store.setFailed(true);
    } catch {
      store.setFailed(true);
    }
    store.setApplying(false);
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
          {t("updates.installed")} <span className="font-mono">{status.installed?.short}</span> · {t("updates.latest")}{" "}
          <span className="font-mono">{status.latest.short}</span>
          {status.latest.author ? ` — ${status.latest.author}` : ""}
          <span className="mt-1 block truncate text-xs italic">{status.latest.message}</span>
          {status.latest.date && (
            <span className="mt-1 block text-xs">{formatDate(status.latest.date)}</span>
          )}
        </p>

        {failed && (
          <p role="alert" className="mb-4 text-sm text-danger">
            {t("updates.failed")}
          </p>
        )}
        {!failed && applying && (
          <p className="mb-4 text-sm text-text-secondary">{t("updates.applying")}</p>
        )}

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