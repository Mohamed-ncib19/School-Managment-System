"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudOff,
  ShieldCheck,
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Printer,
  TestTube2,
  UploadCloud,
  Database,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import GoogleMark from "@/components/shared/google-mark";
import DriverCard from "@/components/settings/driver-card";
import { cn } from "@/lib/utils/format";
import {
  cloudBackupApi,
  DriverDefinition,
  RecoveryPhrase,
  CloudBackupStatus,
  CloudTargetStatus,
} from "@/lib/api/cloud-backup.api";
import { useCloudSyncStore } from "@/hooks/use-cloud-sync-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const errorMessage = (err: unknown): string => {
  const axios = (err as any)?.response?.data;
  if (axios?.message) return Array.isArray(axios.message) ? axios.message.join(" ") : axios.message;
  return (err as Error)?.message ?? "Une erreur est survenue";
};

const PHRASE_SESSION_KEY = "iq-cloud-safe-save-phrase";

/**
 * Data safety — the cloud safe save section of the Settings page. Shows the
 * live sync status, the configured destinations, and hosts the 4-step setup
 * wizard (destination → school ID + recovery phrase → verify → first
 * snapshot). The wizard mirrors the disaster-recovery contract: the phrase is
 * shown exactly once and must be written down on the printable sheet.
 */
export default function DataSafetySection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: drivers } = useQuery({ queryKey: ["cloud-drivers"], queryFn: cloudBackupApi.drivers });
  const statusQuery = useQuery({ queryKey: ["cloud-status"], queryFn: cloudBackupApi.status });

  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const st = await useCloudSyncStore.getState().refresh();
    queryClient.setQueryData(["cloud-status"], st);
  }, [queryClient]);

  const status = (statusQuery.data ?? undefined) as CloudBackupStatus | undefined;
  const configured = status?.configured ?? false;

  const runSnapshotNow = async () => {
    setError(null);
    try {
      await cloudBackupApi.backupNow();
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="card max-w-xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
            <Cloud size={20} />
          </div>
          <div>
            <h3 className="text-h4 font-bold text-text-primary">{t("cloudSafeSave.title")}</h3>
            <p className="text-xs text-text-secondary">{t("cloudSafeSave.subtitle")}</p>
          </div>
        </div>

        {error && (
          <div className="rounded-btn border border-danger/30 bg-danger-soft dark:bg-danger-dark-soft text-danger-strong dark:text-danger-dark-strong text-sm px-4 py-3 flex items-center gap-2 mb-4">
            <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
            {error}
          </div>
        )}

        {configured ? (
          <ConfiguredOverview status={status!} onRefresh={refresh} onSnapshotNow={runSnapshotNow} />
        ) : (
          <div>
            <p className="text-sm text-text-secondary mb-4">{t("cloudSafeSave.unconfiguredText")}</p>
            <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
              <Plus size={16} />
              {t("cloudSafeSave.startSetup")}
            </button>
          </div>
        )}
      </div>

      {showWizard && !configured && (
        <SetupWizard
          drivers={drivers ?? []}
          onDone={async () => {
            setShowWizard(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConfiguredOverview({
  status,
  onRefresh,
  onSnapshotNow,
}: {
  status: CloudBackupStatus;
  onRefresh: () => Promise<void>;
  onSnapshotNow: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [snapBusy, setSnapBusy] = useState(false);

  const stateLabel =
    status.state === "synced"
      ? t("cloudSafeSave.statusSynced")
      : status.state === "offline"
        ? t("cloudSafeSave.statusOffline")
        : status.state === "syncing"
          ? t("cloudSafeSave.statusSyncing")
          : status.state === "attention"
            ? t("cloudSafeSave.statusAttention")
            : t("cloudSafeSave.statusDisabled");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status.state === "offline" ? (
            <CloudOff size={18} className="text-danger" />
          ) : status.state === "attention" ? (
            <AlertTriangle size={18} className="text-gold" />
          ) : (
            <ShieldCheck size={18} className="text-success-strong dark:text-success-dark-strong" />
          )}
          <span className="text-sm font-semibold text-text-primary">{stateLabel}</span>
        </div>
        <button
          className="btn btn-secondary text-sm"
          onClick={async () => {
            setBusy(true);
            await onRefresh();
            setBusy(false);
          }}
          aria-busy={busy || undefined}
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          {t("common.refresh", "Actualiser")}
        </button>
      </div>

      {status.conflict && (
        <div className="rounded-btn border border-gold/40 bg-gold/10 text-sm px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-gold shrink-0 mt-0.5" />
          <p className="text-text-primary">
            {t("cloudSafeSave.splitBrain", "Une autre machine synchronise déjà cette école")} — {status.conflict.hostname} (
            {new Date(status.conflict.claimedAt).toLocaleString("fr-FR")})
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-btn border border-border bg-background p-3">
          <dt className="text-xs text-text-secondary">{t("cloudSafeSave.schoolId", "Identifiant d'école")}</dt>
          <dd className="font-mono text-text-primary truncate">{status.schoolId}</dd>
        </div>
        <div className="rounded-btn border border-border bg-background p-3">
          <dt className="text-xs text-text-secondary">{t("cloudSafeSave.lastSync", "Dernière synchronisation")}</dt>
          <dd className="text-text-primary">
            {status.lastSync ? new Date(status.lastSync).toLocaleString("fr-FR") : t("common.never", "Jamais")}
          </dd>
        </div>
        <div className="rounded-btn border border-border bg-background p-3">
          <dt className="text-xs text-text-secondary">{t("cloudSafeSave.lastSnapshot", "Dernière capture complète")}</dt>
          <dd className="text-text-primary">
            {status.lastSnapshot ? new Date(status.lastSnapshot).toLocaleString("fr-FR") : t("common.never", "Jamais")}
          </dd>
        </div>
        <div className="rounded-btn border border-border bg-background p-3">
          <dt className="text-xs text-text-secondary">{t("cloudSafeSave.pendingEvents", "Événements en attente")}</dt>
          <dd className={cn("text-text-primary", status.queue.pending > 0 && "text-gold font-semibold")}>
            {status.queue.pending.toLocaleString("fr-FR")}
          </dd>
        </div>
      </dl>

      <div className="flex gap-3">
        <button className="btn btn-secondary text-sm" onClick={onSnapshotNow} aria-busy={snapBusy || undefined}>
          <Database size={14} />
          {t("cloudSafeSave.snapshotNow", "Capture complète maintenant")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SetupWizard({ drivers, onDone }: { drivers: DriverDefinition[]; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [phrase, setPhrase] = useState<RecoveryPhrase | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(PHRASE_SESSION_KEY);
      return raw ? (JSON.parse(raw) as RecoveryPhrase) : null;
    } catch {
      return null;
    }
  });
  const [confirmed, setConfirmed] = useState(false);

  // Prefill the school id from the name this install already carries, so the
  // wizard shows an answer instead of asking a question about namespaces.
  // Only ever fills an untouched field — never overwrites typing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const suggestion = await cloudBackupApi.setupSuggestion();
        if (!cancelled) setSchoolId((current) => current || suggestion.schoolId);
      } catch {
        /* the field stays empty and editable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const next = () => setStep((s) => s + 1);

  return (
    <div className="card max-w-xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
          <UploadCloud size={20} />
        </div>
        <div>
          <h3 className="text-h4 font-bold text-text-primary">{t("cloudSafeSave.wizardTitle")}</h3>
          <p className="text-xs text-text-secondary">{t("cloudSafeSave.wizardSubtitle")}</p>
        </div>
      </div>

      <ol className="flex items-center gap-2 mb-6" aria-label={t("cloudSafeSave.steps", "Étapes")}>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex items-center gap-2 flex-1">
            <span
              className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                i < step
                  ? "bg-success text-white"
                  : i === step
                    ? "bg-primary text-white"
                    : "bg-neutral-soft text-text-secondary",
              )}
            >
              {i < step ? <CheckCircle2 size={14} /> : i + 1}
            </span>
            {i < 3 && <span className={cn("h-0.5 flex-1 rounded", i < step ? "bg-success" : "bg-neutral-soft")} />}
          </li>
        ))}
      </ol>

      {error && (
        <div className="rounded-btn border border-danger/30 bg-danger-soft dark:bg-danger-dark-soft text-danger-strong dark:text-danger-dark-strong text-sm px-4 py-3 flex items-center gap-2 mb-4">
          <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
          {error}
        </div>
      )}

      {step === 0 && (
        <StepTargets
          drivers={drivers}
          targetIds={targetIds}
          setTargetIds={setTargetIds}
          busy={busy}
          setBusy={setBusy}
          error={error}
          setError={setError}
          onNext={next}
        />
      )}

      {step === 1 && (
        <StepPhrase
          schoolId={schoolId}
          setSchoolId={setSchoolId}
          phrase={phrase}
          setPhrase={setPhrase}
          confirmed={confirmed}
          setConfirmed={setConfirmed}
          busy={busy}
          setBusy={setBusy}
          error={error}
          setError={setError}
          onNext={next}
          onBack={() => setStep(0)}
        />
      )}

      {step === 2 && (
        <StepVerify
          schoolId={schoolId}
          phrase={phrase}
          busy={busy}
          setBusy={setBusy}
          error={error}
          setError={setError}
          onNext={next}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <StepFinish schoolId={schoolId} onDone={onDone} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepTargets({
  drivers,
  targetIds,
  setTargetIds,
  busy,
  setBusy,
  error,
  setError,
  onNext,
}: {
  drivers: DriverDefinition[];
  targetIds: string[];
  setTargetIds: (ids: string[]) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showOthers, setShowOthers] = useState(false);
  const [saving, setSaving] = useState(false);

  const def = drivers.find((d) => d.id === picked) ?? null;

  /**
   * Connect an account for an OAuth destination.
   *
   * The server holds the app credentials for both providers, so this asks the
   * administrator for nothing — they pick an account and approve. `values`
   * only carries credentials when a self-hoster registered their own app.
   */
  const runOAuth = async (fieldName: string) => {
    if (!def) return;
    const isDropbox = def.id === "dropbox";
    const messageType = isDropbox ? "iq-dropbox-oauth" : "iq-gdrive-oauth";
    setSaving(true);
    setError(null);
    try {
      const redirectUri = `${window.location.origin}/api/cloud-backup/oauth/${
        isDropbox ? "dropbox" : "gdrive"
      }/callback`;
      const { url } = isDropbox
        ? await cloudBackupApi.dropboxOAuthUrl({
            appKey: values["appKey"] || undefined,
            appSecret: values["appSecret"] || undefined,
            redirectUri,
          })
        : await cloudBackupApi.gdriveOAuthUrl({
            clientId: values["clientId"] || undefined,
            clientSecret: values["clientSecret"] || undefined,
            redirectUri,
          });

      const popup = window.open(url, messageType, "width=560,height=720");
      if (!popup) {
        setError(t("cloudSafeSave.popupBlocked", "Autorisez les fenêtres pop-up pour ce site."));
        setSaving(false);
        return;
      }
      const onMessage = (ev: MessageEvent) => {
        // The callback posts to this exact origin; anything else is not ours.
        if (ev.origin !== window.location.origin) return;
        if (ev.data?.type !== messageType) return;
        window.removeEventListener("message", onMessage);
        setSaving(false);
        if (ev.data.ok) {
          setValues((v) => ({ ...v, [fieldName]: ev.data.refreshToken }));
        } else {
          setError(ev.data.error ? String(ev.data.error) : t("cloudSafeSave.oauthDenied", "Autorisation refusée."));
        }
      };
      window.addEventListener("message", onMessage);
    } catch (err) {
      setSaving(false);
      setError(errorMessage(err));
    }
  };

  const saveTarget = async () => {
    if (!def) return;
    setError(null);
    setSaving(true);
    try {
      const result = await cloudBackupApi.createTarget({ driverId: def.id, config: values });
      setTargetIds([...targetIds, result.id]);
      setValues({});
      setPicked(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const recommended = drivers.filter((d) => d.recommended);
  // If a build ever ships without the flag, show everything rather than an
  // empty screen.
  const others = recommended.length > 0 ? drivers.filter((d) => !d.recommended) : [];
  const primary = recommended.length > 0 ? recommended : drivers;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-text-primary mb-2">{t("cloudSafeSave.step1Title", "Choisissez une destination")}</p>
        <p className="text-xs text-text-secondary mb-4">
          {t("cloudSafeSave.step1Subtitle", "La sauvegarde est dupliquée sur chaque destination active. Vous pouvez en ajouter plusieurs — au moins une est requise.")}
        </p>

        {/* Two choices, not six. Both free, neither needs a payment card, and
            either is done in under a minute. Everything else is real and still
            reachable, but a school that has no opinion should not have to
            form one. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {primary.map((d) => (
            <DriverCard
              key={d.id}
              driver={d}
              selected={picked === d.id}
              onSelect={() => {
                setPicked(d.id);
                setError(null);
              }}
            />
          ))}
        </div>

        {others.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowOthers((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-primary transition-colors"
            >
              <ChevronRight size={13} className={cn("transition-transform", showOthers && "rotate-90")} />
              {showOthers
                ? t("cloudSafeSave.hideOtherOptions", "Masquer les autres options")
                : t("cloudSafeSave.showOtherOptions", "Autres options (Backblaze, Nextcloud, S3…)")}
            </button>

            {showOthers && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {others.map((d) => (
                  <DriverCard
                    key={d.id}
                    driver={d}
                    selected={picked === d.id}
                    onSelect={() => {
                      setPicked(d.id);
                      setError(null);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {def && (
          <div className="mt-4 space-y-4 rounded-btn border border-border bg-background p-4">
            {def.setupHelp && (
              // Where to click in the provider's own site. For someone who has
              // never created a bucket this is the most useful thing here.
              <div className="rounded-btn border border-primary/30 bg-primary-50 dark:bg-primary/10 px-4 py-3">
                <p className="text-xs leading-relaxed text-text-secondary whitespace-pre-line">{def.setupHelp}</p>
              </div>
            )}
            {def.fields.map((field) => (
              <div key={field.name}>
                <label htmlFor={`tgt-${field.name}`} className="block text-sm font-medium text-text-primary mb-1.5">
                  {field.label}
                  {field.required && <span className="text-danger"> *</span>}
                </label>
                {field.type === "select" ? (
                  <select
                    id={`tgt-${field.name}`}
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
                ) : field.type === "folder" ? (
                  <input
                    id={`tgt-${field.name}`}
                    type="text"
                    className="input font-mono text-sm"
                    placeholder={field.placeholder}
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  />
                ) : field.type === "oauth" ? (
                  <>
                    {values[field.name] ? (
                      <div className="flex items-center gap-3 rounded-btn border border-success/30 bg-success-soft dark:bg-success-dark-soft px-4 py-3">
                        <CheckCircle2 size={16} className="shrink-0 text-success-strong dark:text-success-dark-strong" />
                        <span className="text-sm text-success-strong dark:text-success-dark-strong flex-1">
                          {def.id === "dropbox"
                            ? t("cloudSafeSave.dropboxConnected", "Compte Dropbox connecté")
                            : t("cloudSafeSave.googleConnected", "Compte Google connecté")}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-text-secondary hover:text-primary underline shrink-0"
                          onClick={() => void runOAuth(field.name)}
                          disabled={saving}
                        >
                          {t("cloudSafeSave.googleChangeAccount", "Changer de compte")}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary w-full justify-center gap-2"
                        onClick={() => void runOAuth(field.name)}
                        disabled={saving}
                      >
                        {saving ? (
                          <RefreshCw size={16} className="animate-spin" />
                        ) : def.id === "dropbox" ? (
                          <Cloud size={16} className="shrink-0 text-primary" />
                        ) : (
                          <GoogleMark className="h-4 w-4 shrink-0" />
                        )}
                        {def.id === "dropbox"
                          ? t("cloudSafeSave.dropboxConnect", "Se connecter avec Dropbox")
                          : t("cloudSafeSave.googleConnect", "Se connecter avec Google")}
                      </button>
                    )}
                    {def.id === "gdrive" && (
                      <p className="text-xs text-gold mt-1">{t("cloudSafeSave.googleLimitation")}</p>
                    )}
                  </>
                ) : (
                  <input
                    id={`tgt-${field.name}`}
                    type={field.type === "password" ? "password" : "text"}
                    className="input"
                    placeholder={field.placeholder}
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  />
                )}
                {field.help && <p className="text-xs text-text-secondary mt-1">{field.help}</p>}
              </div>
            ))}

            <div className="flex gap-3">
              <button type="button" className="btn btn-primary text-sm" onClick={() => void saveTarget()} disabled={saving || !def.fields.every((f) => !f.required || (values[f.name] ?? "").trim())}>
                <Plus size={14} />
                {t("cloudSafeSave.addTarget", "Tester et enregistrer")}
              </button>
              <button type="button" className="btn btn-secondary text-sm" onClick={() => setPicked(null)}>
                {t("common.cancel", "Annuler")}
              </button>
            </div>
          </div>
        )}
      </div>

      {targetIds.length > 0 && (
        <div className="rounded-btn border border-success/30 bg-success-soft dark:bg-success-dark-soft px-4 py-3 text-sm text-success-strong dark:text-success-dark-strong flex items-center gap-2">
          <CheckCircle2 size={16} />
          {t("cloudSafeSave.targetsReady", "{n} destination(s) enregistrée(s)").replace("{n}", String(targetIds.length))}
        </div>
      )}

      <div className="flex justify-end">
        <button className="btn btn-primary text-sm" onClick={onNext} disabled={targetIds.length === 0 || busy}>
          {t("common.next", "Continuer")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepPhrase({
  schoolId,
  setSchoolId,
  phrase,
  setPhrase,
  confirmed,
  setConfirmed,
  busy,
  setBusy,
  error,
  setError,
  onNext,
  onBack,
}: {
  schoolId: string;
  setSchoolId: (v: string) => void;
  phrase: RecoveryPhrase | null;
  setPhrase: (p: RecoveryPhrase | null) => void;
  confirmed: boolean;
  setConfirmed: (b: boolean) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  const generate = async () => {
    setError(null);
    setBusy(true);
    try {
      const p = await cloudBackupApi.generatePhrase();
      setPhrase(p);
      setConfirmed(false);
      try {
        sessionStorage.setItem(PHRASE_SESSION_KEY, JSON.stringify(p));
      } catch {
        /* storage unavailable */
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-text-primary mb-2">{t("cloudSafeSave.step2Title", "Identifiant d'école et phrase de récupération")}</p>
        <p className="text-xs text-text-secondary mb-4">
          {t("cloudSafeSave.step2Subtitle", "L'identifiant d'école sert d'espace de stockage. La phrase est la seule clé des données chiffrées : elle n'est jamais stockée sur cette machine ni sur le cloud.")}
        </p>

        <label htmlFor="school-id" className="block text-sm font-medium text-text-primary mb-1.5">
          {t("cloudSafeSave.schoolId", "Identifiant d'école")}
        </label>
        <input
          id="school-id"
          className="input font-mono"
          placeholder="ex. mon-ecole-2024"
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
        />
      </div>

      <div className="rounded-btn border border-border bg-background p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-text-primary">{t("cloudSafeSave.recoveryPhraseTitle", "Phrase de récupération")}</p>
          <button className="btn btn-secondary text-sm" onClick={() => void generate()} disabled={busy} aria-busy={busy || undefined}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
            {phrase ? t("cloudSafeSave.regenerate", "Régénérer") : t("cloudSafeSave.generate", "Générer")}
          </button>
        </div>

        {phrase ? (
          <>
            <div className="grid grid-cols-3 gap-2 print:grid-cols-4" id="recovery-sheet">
              {phrase.words.map((word, i) => (
                <div key={i} className="rounded-btn border border-border bg-surface px-3 py-2 text-sm font-mono flex items-center gap-2">
                  <span className="text-xs text-text-secondary w-5 text-right">{i + 1}.</span>
                  <span className="text-text-primary">{word}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-danger mt-3">
              {t("cloudSafeSave.phraseWarning", "Écrivez ces 12 mots dans l'ordre sur la feuille de secours. Sans elle, aucune restauration n'est possible en cas de perte de cet ordinateur.")}
            </p>
            <div className="flex gap-3 mt-3 print:hidden">
              <button className="btn btn-secondary text-sm" onClick={() => window.print()}>
                <Printer size={14} />
                {t("cloudSafeSave.printSheet", "Imprimer la feuille")}
              </button>
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="accent-primary h-4 w-4"
                />
                {t("cloudSafeSave.confirmWritten", "J'ai noté la phrase en lieu sûr.")}
              </label>
            </div>
          </>
        ) : (
          <p className="text-sm text-text-secondary">{t("cloudSafeSave.noPhraseYet", "Cliquez sur « Générer » — la phrase n'est montrée qu'une seule fois.")}</p>
        )}
      </div>

      <div className="flex justify-between">
        <button className="btn btn-secondary text-sm" onClick={onBack}>
          {t("common.back", "Retour")}
        </button>
        <button className="btn btn-primary text-sm" onClick={onNext} disabled={!phrase || !confirmed || !schoolId.trim() || busy}>
          {t("common.next", "Continuer")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepVerify({
  schoolId,
  phrase,
  busy,
  setBusy,
  error,
  setError,
  onNext,
  onBack,
}: {
  schoolId: string;
  phrase: RecoveryPhrase | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [result, setResult] = useState<Awaited<ReturnType<typeof cloudBackupApi.verifySetup>> | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!phrase) return;
    setError(null);
    setRunning(true);
    setBusy(true);
    try {
      await cloudBackupApi.step1({ schoolId: schoolId.trim(), phrase: phrase.normalized });
      const v = await cloudBackupApi.verifySetup();
      setResult(v);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm font-medium text-text-primary">{t("cloudSafeSave.step3Title", "Vérification de bout en bout")}</p>
      <p className="text-xs text-text-secondary">
        {t("cloudSafeSave.step3Subtitle", "Une écriture de test est chiffrée et envoyée vers chaque destination, puis relue. Toute destination doit répondre avant de valider.")}
      </p>

      {result && (
        <div className="space-y-2">
          {result.targets.map((tgt) => (
            <div
              key={tgt.id}
              className={cn(
                "rounded-btn border px-4 py-3 text-sm flex items-center gap-2",
                tgt.ok
                  ? "border-success/30 bg-success-soft dark:bg-success-dark-soft text-success-strong dark:text-success-dark-strong"
                  : "border-danger/30 bg-danger-soft dark:bg-danger-dark-soft text-danger-strong dark:text-danger-dark-strong",
              )}
            >
              {tgt.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {tgt.ok
                ? t("cloudSafeSave.verifyOk", "Destination vérifiée")
                : `${t("cloudSafeSave.verifyFailed", "Échec")} — ${tgt.lastError ?? ""}`}
            </div>
          ))}
          {result.ok ? (
            <p className="text-sm text-success-strong dark:text-success-dark-strong font-medium">{t("cloudSafeSave.verifyAllOk", "Toutes les destinations sont prêtes.")}</p>
          ) : (
            <p className="text-sm text-danger">{t("cloudSafeSave.verifyNotOk", "Corrigez la destination avant de continuer.")}</p>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <button className="btn btn-secondary text-sm" onClick={onBack} disabled={running}>
          {t("common.back", "Retour")}
        </button>
        <div className="flex gap-3">
          <button className="btn btn-secondary text-sm" onClick={() => void run()} disabled={running || busy} aria-busy={running || undefined}>
            <TestTube2 size={14} className={running ? "animate-pulse" : ""} />
            {result ? t("cloudSafeSave.reverify", "Re-vérifier") : t("cloudSafeSave.verifyNow", "Vérifier")}
          </button>
          <button className="btn btn-primary text-sm" onClick={onNext} disabled={!result?.ok || running}>
            {t("common.next", "Continuer")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepFinish({ schoolId, onDone }: { schoolId: string; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setState("running");
    setError(null);
    try {
      await cloudBackupApi.finishSetup(schoolId.trim());
      setState("done");
      await onDone();
    } catch (err) {
      setState("failed");
      setError(errorMessage(err));
    }
  };

  if (state === "done") {
    return (
      <div className="space-y-4 text-center py-4">
        <CheckCircle2 size={40} className="mx-auto text-success dark:text-success-dark" />
        <p className="text-h4 font-bold text-text-primary">{t("cloudSafeSave.doneTitle", "Sauvegarde cloud activée")}</p>
        <p className="text-sm text-text-secondary">
          {t("cloudSafeSave.doneText", "La première capture complète a été chiffrée et envoyée. La synchronisation continue désormais en arrière-plan, toutes les minutes.")}
        </p>
        <button className="btn btn-primary" onClick={() => void onDone()}>
          {t("common.close", "Fermer")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm font-medium text-text-primary">{t("cloudSafeSave.step4Title", "Première capture complète")}</p>
      <p className="text-xs text-text-secondary">
        {t("cloudSafeSave.step4Subtitle", "La base entière est exportée, compressée, chiffrée puis envoyée. Cela peut prendre quelques minutes sur une grosse base.")}
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-3">
        <button className="btn btn-primary text-sm" onClick={() => void run()} disabled={state === "running"} aria-busy={state === "running" || undefined}>
          <Database size={14} />
          {state === "running" ? t("cloudSafeSave.snapshotting", "Capture en cours…") : t("cloudSafeSave.snapshotStart", "Lancer la capture")}
        </button>
        {state === "failed" && (
          <button className="btn btn-secondary text-sm" onClick={() => void run()}>
            {t("common.retry", "Réessayer")}
          </button>
        )}
      </div>
    </div>
  );
}