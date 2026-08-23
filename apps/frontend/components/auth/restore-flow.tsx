"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, X, ShieldCheck, Database, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils/format";
import {
  cloudBackupApi,
  DriverDefinition,
  RestorePlan,
  RestoreStatus,
} from "@/lib/api/cloud-backup.api";
import { useQuery } from "@tanstack/react-query";

const errorMessage = (err: unknown): string => {
  const axios = (err as any)?.response?.data;
  if (axios?.message) return Array.isArray(axios.message) ? axios.message.join(" ") : axios.message;
  return (err as Error)?.message ?? "Une erreur est survenue";
};

/**
 * Disaster-recovery restore, reachable from the login screen on new hardware.
 * The flow mirrors the setup: pick a destination, enter the school ID and the
 * recovery phrase, then apply the latest snapshot and replay the events that
 * happened after it. The backend job is resumable, so an interrupted restore
 * continues from where it stopped.
 */
export default function RestoreFlow() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [checkResult, setCheckResult] = useState<{ allowed: boolean } | null>(null);

  const check = useCallback(async () => {
    try {
      const r = await cloudBackupApi.restoreCheck();
      setCheckResult(r);
    } catch {
      setCheckResult(null);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (!open && checkResult?.allowed === false) return null;

  return (
    <>
      {checkResult?.allowed && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mx-auto mt-6 flex items-center gap-2 text-xs text-text-secondary hover:text-primary transition-colors"
        >
          <RotateCcw size={13} />
          {t("cloudSafeSave.restoreLink", "Restaurer depuis une sauvegarde cloud")}
        </button>
      )}
      {open && <RestoreDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function RestoreDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { data: drivers } = useQuery({ queryKey: ["cloud-drivers"], queryFn: cloudBackupApi.drivers });

  const [picked, setPicked] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [schoolId, setSchoolId] = useState("");
  const [phrase, setPhrase] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const [done, setDone] = useState(false);

  const def = drivers?.find((d) => d.id === picked) ?? null;
  const canStart = picked && schoolId.trim() && phrase.trim() && (def?.fields.every((f) => !f.required || (values[f.name] ?? "").trim()) ?? false);

  const targetInput = def
    ? {
        driverId: def.id,
        // Every field goes through, including the `oauth` refresh token.
        // Filtering it out left a Google Drive restore with no credential to
        // authenticate with, so that path could never work.
        config: Object.fromEntries(def.fields.map((f) => [f.name, values[f.name] ?? ""])),
      }
    : null;

  const start = async () => {
    if (!targetInput) return;
    setError(null);
    setBusy(true);
    try {
      const p = await cloudBackupApi.restoreStart({ target: targetInput, schoolId: schoolId.trim(), phrase: phrase.trim() });
      setPlan(p);
      setStatus({ jobId: p.jobId, state: "discovered", snapshotKey: p.snapshot?.key ?? null, appliedThroughSeq: p.appliedThroughSeq, updatedAt: null });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const applySnapshot = async () => {
    if (!plan || !targetInput) return;
    setError(null);
    setBusy(true);
    try {
      await cloudBackupApi.restoreSnapshot(plan.jobId, { target: targetInput, schoolId: schoolId.trim(), phrase: phrase.trim() });
      setStatus((s) => (s ? { ...s, state: "snapshot_applied" } : s));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const replay = async () => {
    if (!plan || !targetInput) return;
    setError(null);
    setBusy(true);
    try {
      const r = await cloudBackupApi.restoreReplay(plan.jobId, { target: targetInput, schoolId: schoolId.trim(), phrase: phrase.trim() });
      setStatus((s) => (s ? { ...s, state: "replayed", appliedThroughSeq: r.appliedThroughSeq } : s));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!plan || !targetInput) return;
    setError(null);
    setBusy(true);
    try {
      await cloudBackupApi.restoreFinish(plan.jobId, { target: targetInput, schoolId: schoolId.trim(), phrase: phrase.trim() });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const stage: "form" | "plan" | "restoring" | "done" = done ? "done" : plan ? (status?.state === "discovered" ? "plan" : "restoring") : "form";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-title"
    >
      <div className="mx-4 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-modal bg-surface p-6 shadow-modal">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 id="restore-title" className="text-h4 font-bold text-text-primary">
              {t("cloudSafeSave.restoreTitle", "Restaurer une sauvegarde cloud")}
            </h3>
            <p className="text-xs text-text-secondary mt-1">
              {t("cloudSafeSave.restoreSubtitle", "À utiliser uniquement sur un poste neuf — la base actuelle doit être vide.")}
            </p>
          </div>
          <button className="text-text-secondary hover:text-text-primary" onClick={onClose} aria-label={t("common.close", "Fermer")}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="rounded-btn border border-danger/30 bg-danger-soft dark:bg-danger-dark-soft text-danger-strong dark:text-danger-dark-strong text-sm px-4 py-3 flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="shrink-0" />
            {error}
          </div>
        )}

        {stage === "form" && (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-medium text-text-primary mb-2">{t("cloudSafeSave.step1Title", "Choisissez une destination")}</p>
              <div className="grid grid-cols-3 gap-3">
                {drivers?.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setPicked(d.id);
                      setError(null);
                    }}
                    className={cn(
                      "rounded-btn border p-3 text-left transition-colors",
                      picked === d.id ? "border-primary bg-primary-50 dark:bg-primary/10 ring-1 ring-primary" : "border-border bg-background hover:border-primary/50",
                    )}
                  >
                    <p className="text-sm font-semibold text-text-primary">{d.displayName}</p>
                    <p className="text-xs text-text-secondary mt-0.5">{d.description}</p>
                  </button>
                ))}
              </div>

              {def && (
                <div className="mt-4 space-y-3 rounded-btn border border-border bg-background p-4">
                  {/* No filter on `oauth`: there is no session on the login
                      screen, so the consent popup is unavailable here and the
                      refresh token has to be pasted in by hand. Hiding the
                      field left a Drive restore with no credential at all. */}
                  {def.fields
                    .map((field) => (
                      <div key={field.name}>
                        <label htmlFor={`res-${field.name}`} className="block text-sm font-medium text-text-primary mb-1.5">
                          {field.label}
                          {field.required && <span className="text-danger"> *</span>}
                        </label>
                        {field.type === "select" ? (
                          <select
                            id={`res-${field.name}`}
                            className="input"
                            value={values[field.name] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                          >
                            <option value="">—</option>
                            {field.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={`res-${field.name}`}
                            type={field.type === "password" ? "password" : "text"}
                            className="input"
                            placeholder={field.placeholder}
                            value={values[field.name] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                          />
                        )}
                        {field.type === "oauth" ? (
                          <p className="mt-1 text-xs text-text-secondary">
                            {t(
                              "cloudSafeSave.restoreRefreshToken",
                              "Collez le jeton d'actualisation Google noté lors de la configuration — la connexion Google n'est pas disponible avant l'ouverture de session.",
                            )}
                          </p>
                        ) : (
                          field.help && <p className="mt-1 text-xs text-text-secondary">{field.help}</p>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="res-school" className="block text-sm font-medium text-text-primary mb-1.5">
                  {t("cloudSafeSave.schoolId", "Identifiant d'école")}
                </label>
                <input id="res-school" className="input font-mono" value={schoolId} onChange={(e) => setSchoolId(e.target.value)} />
              </div>
              <div>
                <label htmlFor="res-phrase" className="block text-sm font-medium text-text-primary mb-1.5">
                  {t("cloudSafeSave.recoveryPhraseInput", "Phrase de récupération (12 mots)")}
                </label>
                <input
                  id="res-phrase"
                  className="input font-mono text-xs"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>

            <button className="btn btn-primary w-full" onClick={() => void start()} disabled={!canStart || busy} aria-busy={busy || undefined}>
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
              {t("cloudSafeSave.restoreStart", "Vérifier la sauvegarde")}
            </button>
          </div>
        )}

        {stage === "plan" && plan && (
          <div className="space-y-4">
            <div className="rounded-btn border border-border bg-background p-4 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-success-strong dark:text-success-dark-strong" />
                <span className="text-text-primary">{t("cloudSafeSave.phraseVerified", "Phrase vérifiée — la sauvegarde est accessible.")}</span>
              </div>
              {plan.snapshot ? (
                <p className="text-text-secondary">
                  {t("cloudSafeSave.planSnapshot", "Capture du {date} ({events} événements à rejouer)")
                    .replace("{date}", new Date(plan.snapshot.created_at).toLocaleDateString("fr-FR"))
                    .replace("{events}", plan.totalEvents.toLocaleString("fr-FR"))}
                </p>
              ) : (
                <p className="text-text-secondary">{t("cloudSafeSave.planNoSnapshot", "Aucune capture complète — seuls les événements seront restaurés.")}</p>
              )}
            </div>

            <button className="btn btn-primary w-full" onClick={() => void applySnapshot()} disabled={busy} aria-busy={busy || undefined}>
              <Database size={14} />
              {t("cloudSafeSave.restoreApplySnapshot", "Restaurer la capture")}
            </button>
          </div>
        )}

        {stage === "restoring" && plan && status && (
          <div className="space-y-4">
            <RestoreStep
              label={t("cloudSafeSave.stepSnapshot", "Capture restaurée")}
              state={status.state === "snapshot_applied" ? "done" : status.state === "discovered" ? "pending" : "done"}
            />
            <RestoreStep
              label={t("cloudSafeSave.stepReplay", "Rejeu des événements")}
              state={status.state === "replayed" ? "done" : status.state === "replaying" ? "running" : "pending"}
            />
            <RestoreStep
              label={t("cloudSafeSave.stepClaim", "Activation sur cette machine")}
              state={status.state === "complete" ? "done" : "pending"}
            />

            {status.state === "snapshot_applied" && (
              <button className="btn btn-primary w-full" onClick={() => void replay()} disabled={busy} aria-busy={busy || undefined}>
                <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
                {t("cloudSafeSave.restoreReplay", "Rejouer les événements")}
              </button>
            )}
            {status.state === "replayed" && (
              <button className="btn btn-primary w-full" onClick={() => void finish()} disabled={busy} aria-busy={busy || undefined}>
                <ShieldCheck size={14} />
                {t("cloudSafeSave.restoreFinish", "Activer cette machine")}
              </button>
            )}
          </div>
        )}

        {stage === "done" && (
          <div className="text-center py-4 space-y-3">
            <CheckCircle2 size={40} className="mx-auto text-success dark:text-success-dark" />
            <p className="text-h4 font-bold text-text-primary">{t("cloudSafeSave.restoreDone", "Restauration terminée")}</p>
            <p className="text-sm text-text-secondary">{t("cloudSafeSave.restoreDoneText", "Connectez-vous avec le compte administrateur habituel.")}</p>
            <button className="btn btn-primary" onClick={onClose}>
              {t("common.close", "Fermer")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RestoreStep({ label, state }: { label: string; state: "pending" | "running" | "done" }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {state === "done" ? (
        <CheckCircle2 size={16} className="text-success-strong dark:text-success-dark-strong shrink-0" />
      ) : state === "running" ? (
        <RefreshCw size={16} className="animate-spin text-gold shrink-0" />
      ) : (
        <span className="h-4 w-4 rounded-full border-2 border-neutral-soft shrink-0" />
      )}
      <span className={cn(state === "done" ? "text-text-primary" : "text-text-secondary")}>{label}</span>
    </div>
  );
}