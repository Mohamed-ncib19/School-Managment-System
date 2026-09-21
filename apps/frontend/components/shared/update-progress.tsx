"use client";

import { useTranslation } from "@/lib/i18n/context";
import { useUpdateStore } from "@/hooks/use-update-store";

/**
 * Live progress of the platform update engine (the console that do-update.ps1
 * / update.sh opens). Driven entirely by the update store: once "update now"
 * is clicked the poller in UpdateNotifier starts refreshing
 * /api/updates/progress, and every surface (dialog, Settings) renders this
 * same tracker from the shared state.
 */
export default function UpdateProgressTracker() {
  const { t } = useTranslation();
  const progress = useUpdateStore((s) => s.progress);

  if (!progress || progress.state === "idle") return null;

  const running = progress.state === "running";
  const pct =
    progress.step != null && progress.stepTotal
      ? Math.min(100, Math.round((progress.step / progress.stepTotal) * 100))
      : running
        ? null
        : 100;

  const stepLabel =
    progress.label != null &&
    (progress.stepTotal && progress.step
      ? t("updates.progressStep", "Step {step}/{total}: {label}")
          .replace("{step}", String(progress.step))
          .replace("{total}", String(progress.stepTotal))
          .replace("{label}", progress.label)
      : progress.label);

  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-text-primary">
          {running ? stepLabel ?? t("updates.progressTitle", "Update in progress") : stepLabel}
        </span>
        {pct !== null && <span className="shrink-0 text-text-secondary">{pct}%</span>}
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuenow={pct ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full bg-primary transition-all ${running ? "animate-pulse" : ""}`}
          style={{ width: `${pct ?? 8}%` }}
        />
      </div>

      {progress.message && progress.message !== progress.label && (
        <p className="mt-1.5 text-xs text-text-secondary">{progress.message}</p>
      )}
      {progress.backupPath && (
        <p className="mt-1.5 text-xs text-text-secondary">
          {t("updates.progressBackup", "Safety backup verified")}: {" "}
          <span className="font-mono">{progress.backupPath}</span>
        </p>
      )}
      {progress.state === "done" && progress.healthOk === false && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {t(
            "updates.progressHealthFailed",
            "The update installed, but the API did not come back automatically. Your data is safe — start the system from the desktop shortcut.",
          )}
        </p>
      )}
      {progress.state === "done" && progress.healthOk !== false && (
        <p className="mt-1.5 text-xs text-success-strong">{t("updates.progressDone", "Update complete — the system is restarting.")}</p>
      )}
      {progress.destructive && progress.state === "failed" && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {t(
            "updates.progressDestructive",
            "The new version needs to change existing data columns. The update was stopped BEFORE anything was applied — your data is untouched. Contact support to install this version safely.",
          )}
        </p>
      )}
      {!progress.destructive && progress.state === "failed" && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {t("updates.progressFailed", "The update failed — check the update console or the logs\\update-*.log file.")}
        </p>
      )}
      {progress.state === "stalled" && (
        <p className="mt-1.5 text-xs text-danger">
          {t("updates.progressStalled", "The update seems to have stopped responding. Close the update console and try again.")}
        </p>
      )}
    </div>
  );
}