"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, X, ShieldCheck, Database, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import GoogleMark from "@/components/shared/google-mark";
import { ManualOAuthConnect } from "@/components/shared/manual-oauth-connect";
import { cn } from "@/lib/utils/format";
import {
  cloudBackupApi,
  DriverDefinition,
  RestorePlan,
  RestoreStatus,
} from "@/lib/api/cloud-backup.api";
import { useQuery } from "@tanstack/react-query";

const errorMessage = (err: unknown): string => {
  // Same envelope unwrap as the setup wizard: the API wraps failures as
  // { data: null, error: { message, ... } }.
  const envelope = (err as any)?.response?.data?.error;
  if (envelope?.message) return Array.isArray(envelope.message) ? envelope.message.join(" ") : envelope.message;
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

  const orderedDrivers = [...(drivers ?? [])].sort(
    (a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false),
  );
  const def = drivers?.find((d) => d.id === picked) ?? null;

  // Same rule as the setup wizard: developer credentials hide behind a
  // toggle, and hidden required fields must not block the form.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const shownFields = showAdvanced ? (def?.fields ?? []) : (def?.fields.filter((f) => !f.advanced) ?? []);
  const advancedCount = (def?.fields.filter((f) => f.advanced) ?? []).length;
  // Consent links already issued per oauth field: the paste panel opens on
  // its own with the link, so approving anywhere always lands back here.
  const [oauthLinks, setOauthLinks] = useState<Record<string, { url: string; state: string }>>({});

  /**
   * Connect a Dropbox or Google account from the login screen.
   *
   * The server holds the app credentials, so this asks for nothing —
   * without it the administrator would have to paste a refresh token they
   * never saw, because the whole point of an app-level client is that they
   * never handle one.
   */
  /**
   * One consent URL for both connect paths (see the settings wizard): the
   * popup opens it directly, the "other computer" mode shows it as a link
   * whose `code` is pasted back and exchanged below.
   */
  const requestRestoreOAuthUrl = async (): Promise<{ url: string; state: string }> => {
    const isDropbox = def?.id === "dropbox";
    if (!def) throw new Error("No driver selected");
    const redirectUri = `${window.location.origin}/api/cloud-backup/oauth/${
      isDropbox ? "dropbox" : "gdrive"
    }/callback`;
    return isDropbox
      ? cloudBackupApi.restoreDropboxOAuthUrl({
          appKey: values["appKey"] || undefined,
          appSecret: values["appSecret"] || undefined,
          redirectUri,
        })
      : cloudBackupApi.restoreGdriveOAuthUrl({
          clientId: values["clientId"] || undefined,
          clientSecret: values["clientSecret"] || undefined,
          redirectUri,
        });
  };

  /**
   * Copy-code variant: fixed loopback redirect (see manualOAuthRedirectUri),
   * so the link works opened from any machine — never the LAN address.
   */
  const requestRestoreManualOAuthUrl = async (): Promise<{ url: string; state: string }> => {
    const isDropbox = def?.id === "dropbox";
    if (!def) throw new Error("No driver selected");
    const provider = isDropbox ? "dropbox" : "gdrive";
    const redirectUri = cloudBackupApi.manualOAuthRedirectUri(provider);
    return isDropbox
      ? cloudBackupApi.restoreDropboxOAuthUrl({
          appKey: values["appKey"] || undefined,
          appSecret: values["appSecret"] || undefined,
          redirectUri,
        })
      : cloudBackupApi.restoreGdriveOAuthUrl({
          clientId: values["clientId"] || undefined,
          clientSecret: values["clientSecret"] || undefined,
          redirectUri,
        });
  };

  const runOAuth = async (fieldName: string) => {
    setBusy(true);
    setError(null);
    try {
      const isDropbox = def?.id === "dropbox";
      const messageType = isDropbox ? "iq-dropbox-oauth" : "iq-gdrive-oauth";
      const { url, state } = await requestRestoreOAuthUrl();
      // Publish the link first: whatever happens with the popup, the code
      // has somewhere to be pasted.
      setOauthLinks((v) => ({ ...v, [fieldName]: { url, state } }));
      const popup = window.open(url, messageType, "width=560,height=720");
      // The popup carries on on its own from here — the button must not spin
      // forever if the approval happens in another tab.
      setBusy(false);
      if (!popup) {
        setError(t("cloudSafeSave.popupBlocked", "Autorisez les fenêtres pop-up pour ce site."));
        return;
      }
      const onMessage = (ev: MessageEvent) => {
        // The callback posts to this exact origin; anything else is not ours.
        if (ev.origin !== window.location.origin) return;
        if (ev.data?.type !== messageType) return;
        window.removeEventListener("message", onMessage);
        // The popup hands back the authorization code (never a token); swap
        // it server-side, exactly like the copy-code flow does.
        void (async () => {
          try {
            if (ev.data.ok && ev.data.code) {
              const res = await cloudBackupApi.restoreOAuthExchange({ state: ev.data.state, code: ev.data.code });
              setValues((v) => ({ ...v, [fieldName]: res.refreshToken }));
              setOauthLinks((v) => {
                const next = { ...v };
                delete next[fieldName];
                return next;
              });
            } else {
              setError(ev.data.error ? String(ev.data.error) : t("cloudSafeSave.oauthDenied", "Autorisation refusée."));
            }
          } catch (err) {
            setError(errorMessage(err));
          }
        })();
      };
      window.addEventListener("message", onMessage);
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
    }
  };
  const canStart = picked && schoolId.trim() && phrase.trim() && (shownFields.every((f) => !f.required || (values[f.name] ?? "").trim()) ?? false);

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
              {/* Restore shows every destination, not just the recommended
                  two: whoever is standing here already has a backup somewhere
                  and needs to find that exact one. Recommended first, so the
                  common cases still lead. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {orderedDrivers.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setPicked(d.id);
                      setShowAdvanced(false);
                      setOauthLinks({});
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
                  {def.setupHelp && (
                    <div className="rounded-btn border border-primary/30 bg-primary-50 dark:bg-primary/10 px-3 py-2">
                      <p className="text-xs leading-relaxed text-text-secondary whitespace-pre-line">{def.setupHelp}</p>
                    </div>
                  )}
                  {/* No filter on `oauth`: there is no session on the login
                      screen, so the consent popup is unavailable here and the
                      refresh token has to be pasted in by hand. Hiding the
                      field left a Drive restore with no credential at all. */}
                  {shownFields
                    .map((field) => (
                      <div key={field.name}>
                        <label htmlFor={`res-${field.name}`} className="block text-sm font-medium text-text-primary mb-1.5">
                          {field.label}
                          {field.required && <span className="text-danger"> *</span>}
                        </label>
                        {field.type === "oauth" ? (
                          <>
                            {values[field.name] ? (
                              <div className="flex items-center gap-3 rounded-btn border border-success/30 bg-success-soft dark:bg-success-dark-soft px-4 py-3">
                                <CheckCircle2 size={16} className="shrink-0 text-success-strong dark:text-success-dark-strong" />
                                <span className="text-sm text-success-strong dark:text-success-dark-strong flex-1">
                                  {def?.id === "dropbox"
                                    ? t("cloudSafeSave.dropboxConnected", "Compte Dropbox connecté")
                                    : t("cloudSafeSave.googleConnected", "Compte Google connecté")}
                                </span>
                                <button
                                  type="button"
                                  className="text-xs text-text-secondary hover:text-primary underline shrink-0"
                                  onClick={() => void runOAuth(field.name)}
                                  disabled={busy}
                                >
                                  {t("cloudSafeSave.googleChangeAccount", "Changer de compte")}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-secondary w-full justify-center gap-2"
                                onClick={() => void runOAuth(field.name)}
                                disabled={busy}
                              >
                                {busy ? (
                                  <RefreshCw size={16} className="animate-spin" />
                                ) : (
                                  <GoogleMark className="h-4 w-4 shrink-0" />
                                )}
                                {def?.id === "dropbox"
                                  ? t("cloudSafeSave.dropboxConnect", "Se connecter avec Dropbox")
                                  : t("cloudSafeSave.googleConnect", "Se connecter avec Google")}
                              </button>
                            )}
                            {def?.id === "gdrive" && (
                              <p className="text-xs text-gold mt-1">{t("cloudSafeSave.googleLimitation")}</p>
                            )}
                            {!values[field.name] && (
                              <ManualOAuthConnect
                                getUrl={() => requestRestoreManualOAuthUrl()}
                                exchange={(body) => cloudBackupApi.restoreOAuthExchange(body)}
                                onToken={(token) => {
                                  setValues((v) => ({ ...v, [field.name]: token }));
                                  setOauthLinks((v) => {
                                    const next = { ...v };
                                    delete next[field.name];
                                    return next;
                                  });
                                }}
                                initialLink={oauthLinks[field.name] ?? null}
                              />
                            )}
                          </>
                        ) : field.type === "select" ? (
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
                        {field.help && <p className="mt-1 text-xs text-text-secondary">{field.help}</p>}
                      </div>
                    ))}
                  {advancedCount > 0 && (
                    <button
                      type="button"
                      className="text-xs text-text-secondary hover:text-primary underline"
                      onClick={() => setShowAdvanced((v) => !v)}
                    >
                      {showAdvanced
                        ? t("cloudSafeSave.hideOwnClient", "Masquer mes propres identifiants")
                        : t("cloudSafeSave.ownClient", "J'ai mon propre client OAuth (optionnel)")}
                    </button>
                  )}
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