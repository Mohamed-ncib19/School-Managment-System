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
  TestTube2,
  UploadCloud,
  Database,
  ChevronDown,
  KeyRound,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import GoogleMark from "@/components/shared/google-mark";
import { ManualOAuthConnect } from "@/components/shared/manual-oauth-connect";
import DriverCard from "@/components/settings/driver-card";
import { cn } from "@/lib/utils/format";
import {
  cloudBackupApi,
  DriverDefinition,
  DriverFieldDef,
  CloudBackupStatus,
  CloudTargetStatus,
} from "@/lib/api/cloud-backup.api";
import { useCloudSyncStore } from "@/hooks/use-cloud-sync-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageLoader } from "@/components/shared/skeletons";

const errorMessage = (err: unknown): string => {
  // The API wraps failures as { data: null, error: { message, code, ... } } —
  // read the envelope first, or every error renders as axios's raw
  // "Request failed with status code 400".
  const envelope = (err as any)?.response?.data?.error;
  if (envelope?.message) return Array.isArray(envelope.message) ? envelope.message.join(" ") : envelope.message;
  const axios = (err as any)?.response?.data;
  if (axios?.message) return Array.isArray(axios.message) ? axios.message.join(" ") : axios.message;
  return (err as Error)?.message ?? "Une erreur est survenue";
};

const PHRASE_SESSION_KEY = "iq-cloud-safe-save-phrase";

/**
 * Data safety — the cloud safe save section of the Settings page. Shows the
 * live sync status, the configured destinations, and hosts the 4-step setup
 * wizard (destination + secret password → school ID → verify → first
 * snapshot). The wizard mirrors the disaster-recovery contract: the admin's
 * secret password is the only key to the encrypted copies.
 */
export default function DataSafetySection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: drivers } = useQuery({ queryKey: ["cloud-drivers"], queryFn: cloudBackupApi.drivers });
  // Realtime card: polls /status every 5s while this section is open, so the
  // state, pending events and destinations follow the backend on their own.
  // The Actualiser button stays for an immediate check on demand.
  const statusQuery = useQuery({
    queryKey: ["cloud-status"],
    queryFn: cloudBackupApi.status,
    refetchInterval: 5_000,
  });
  // The navbar pill reads the shared store (30s poll): mirror each fresh
  // fetch into it so every surface agrees, with the card's own poll leading.
  const liveStatus = useCloudSyncStore((s) => s.status);
  useEffect(() => {
    if (statusQuery.data) useCloudSyncStore.setState({ status: statusQuery.data, checking: false });
  }, [statusQuery.data]);

  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const st = await useCloudSyncStore.getState().refresh();
      queryClient.setQueryData(["cloud-status"], st);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [queryClient]);

  // Fresh query data first (5s poll), shared store as fallback for first paint:
  // the store can lag up to 30s behind and must never shadow a newer fetch.
  const status = (statusQuery.data ?? liveStatus ?? undefined) as CloudBackupStatus | undefined;
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

        {statusQuery.isLoading && !status ? (
          <PageLoader text={t("common.loading", "Chargement…")} />
        ) : configured ? (
          <ConfiguredOverview
            status={status!}
            drivers={drivers ?? []}
            onRefresh={refresh}
            onSnapshotNow={runSnapshotNow}
          />
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
  drivers,
  onRefresh,
  onSnapshotNow,
}: {
  status: CloudBackupStatus;
  drivers: DriverDefinition[];
  onRefresh: () => Promise<void>;
  onSnapshotNow: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [snapBusy, setSnapBusy] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addIds, setAddIds] = useState<string[]>([]);
  // Confirmation of the sealed secret password when linking one more
  // destination to an already-configured install (verified, never stored).
  const [addSecret, setAddSecret] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [testState, setTestState] = useState<Record<string, { running: boolean; ok: boolean | null; text: string | null }>>({});
  const [showRekey, setShowRekey] = useState(false);
  const [rekeySecret, setRekeySecret] = useState("");
  const [rekeyConfirm, setRekeyConfirm] = useState("");
  const [rekeyAck, setRekeyAck] = useState(false);
  const [rekeyBusy, setRekeyBusy] = useState(false);
  const [rekeyError, setRekeyError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [snapResult, setSnapResult] = useState<{ ok: boolean; text: string } | null>(null);

  const runToggleAuto = async (next: boolean) => {
    setAutoBusy(true);
    try {
      await cloudBackupApi.updateSettings({ autoExport: next });
      setSnapResult(null);
      await onRefresh();
    } catch (err) {
      setSnapResult({ ok: false, text: errorMessage(err) });
    } finally {
      setAutoBusy(false);
    }
  };

  // Lost-password escape hatch: the current secret (old phrase never received)
  // cannot be recovered, only replaced. Re-keying seals a NEW password and
  // reseeds the cloud meta objects; copies already on the cloud become
  // unreadable, local data is untouched, and the next capture re-uploads
  // under the new password. Uses the existing step-1 re-key guard server-side.
  const runRekey = async () => {
    if (!status.schoolId) return;
    setRekeyError(null);
    if (rekeySecret.trim().length < 8) {
      setRekeyError(t("cloudSafeSave.secretPasswordTooShort", "Mot de passe secret : 8 caractères minimum."));
      return;
    }
    if (rekeySecret !== rekeyConfirm) {
      setRekeyError(t("cloudSafeSave.secretPasswordMismatch", "Les deux mots de passe ne correspondent pas."));
      return;
    }
    if (!rekeyAck) return;
    setRekeyBusy(true);
    try {
      await cloudBackupApi.step1({
        schoolId: status.schoolId,
        phrase: rekeySecret,
        confirmReplaceExisting: true,
      });
      await cloudBackupApi.finishSetup(status.schoolId);
      setRekeySecret("");
      setRekeyConfirm("");
      setRekeyAck(false);
      setShowRekey(false);
      setSnapResult({ ok: true, text: t("cloudSafeSave.rekeyDone", "Nouveau mot de passe actif — lancez une capture complète.") });
      await onRefresh();
    } catch (err) {
      setRekeyError(errorMessage(err));
    } finally {
      setRekeyBusy(false);
    }
  };

  const runSnapshotOnce = async () => {
    setSnapBusy(true);
    setSnapResult(null);
    try {
      await onSnapshotNow();
      setSnapResult({
        ok: true,
        text: t("cloudSafeSave.snapshotDone", "Export envoyé — voir « Dernière synchronisation » ci-dessus."),
      });
    } catch (err) {
      setSnapResult({ ok: false, text: errorMessage(err) });
    } finally {
      setSnapBusy(false);
    }
  };

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

  const driverLabel = (driverId: string) =>
    drivers.find((d) => d.id === driverId)?.displayName ?? driverId;

  const runTest = async (id: string) => {
    setTestState((prev) => ({ ...prev, [id]: { running: true, ok: null, text: null } }));
    try {
      const res = (await cloudBackupApi.testTarget(id)) as unknown as {
        ok?: boolean;
        latencyMs?: number;
        data?: { ok?: boolean; latencyMs?: number };
      };
      const ms = res?.latencyMs ?? res?.data?.latencyMs;
      setTestState((prev) => ({
        ...prev,
        [id]: {
          running: false,
          ok: true,
          text: `${t("cloudSafeSave.testOk", "Test réussi")}${typeof ms === "number" ? ` (${ms} ms)` : ""}`,
        },
      }));
    } catch (err) {
      setTestState((prev) => ({ ...prev, [id]: { running: false, ok: false, text: errorMessage(err) } }));
    }
  };

  const runDelete = async (id: string, name: string) => {
    if (!window.confirm(t("cloudSafeSave.confirmDeleteTarget", "Retirer cette destination ? Les copies déjà envoyées restent sur le cloud.") + `\n${name}`)) return;
    setDeleteBusy(id);
    try {
      await cloudBackupApi.deleteTarget(id);
      await onRefresh();
    } catch (err) {
      setTestState((prev) => ({ ...prev, [id]: { running: false, ok: false, text: errorMessage(err) } }));
    } finally {
      setDeleteBusy(null);
    }
  };

  const runPurge = async (id: string, name: string) => {
    if (!window.confirm(t("cloudSafeSave.confirmPurgeTarget", "Supprimer définitivement cette destination de la liste ? Les copies déjà envoyées restent sur le cloud.") + `\n${name}`)) return;
    setDeleteBusy(id);
    try {
      await cloudBackupApi.deleteTarget(id);
      await onRefresh();
    } catch (err) {
      setTestState((prev) => ({ ...prev, [id]: { running: false, ok: false, text: errorMessage(err) } }));
    } finally {
      setDeleteBusy(null);
    }
  };

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
            try {
              await onRefresh();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
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

      {status.targets.length === 0 && (
        <div className="rounded-btn border border-gold/40 bg-gold/10 px-4 py-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-text-primary flex-1 min-w-[200px]">
            {t("cloudSafeSave.noTargetsGuide", "Aucune destination liée — la synchronisation est en pause. Ajoutez une destination pour la reprendre.")}
          </p>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() => {
              setShowTargets(true);
              setShowAdd(true);
            }}
          >
            <Plus size={13} />
            {t("cloudSafeSave.addDestination", "Ajouter une destination")}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-btn border border-border bg-background px-4 py-3">
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-medium text-text-primary">
            {t("cloudSafeSave.autoExportTitle", "Export automatique")}
          </p>
          <p className="text-xs text-text-secondary">
            {status.autoExport
              ? t("cloudSafeSave.autoExportOn", "Un nouveau JSON part ~10 s après chaque changement.")
              : t("cloudSafeSave.autoExportOff", "Exports manuels uniquement — rien ne part tout seul.")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={status.autoExport}
          aria-label={t("cloudSafeSave.autoExportTitle", "Export automatique")}
          onClick={() => void runToggleAuto(!status.autoExport)}
          disabled={autoBusy}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            status.autoExport ? "bg-success-strong" : "bg-neutral-soft",
            autoBusy && "opacity-60",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
              status.autoExport ? "left-[22px]" : "left-0.5",
            )}
          />
        </button>
      </div>

      <div className="rounded-btn border border-gold/40 bg-background px-4 py-3">
        <button
          type="button"
          className="text-sm font-medium text-text-primary flex items-center gap-2"
          onClick={() => setShowRekey((v) => !v)}
          aria-expanded={showRekey || undefined}
        >
          <KeyRound size={14} className="text-gold-500 dark:text-gold-400 shrink-0" />
          {t("cloudSafeSave.showRekey", "Mot de passe perdu ? Redéfinir le mot de passe secret")}
          <ChevronDown size={14} className={cn("transition-transform", showRekey && "rotate-180")} />
        </button>
        {showRekey && (
          <form className="mt-3 space-y-3" onSubmit={(e) => e.preventDefault()}>
            <p className="text-xs text-text-secondary">
              {t("cloudSafeSave.rekeyText", "Le mot de passe actuel est perdu (ancienne phrase jamais reçue). Définissez-en un nouveau : les copies déjà sur le cloud deviendront illisibles, vos données locales ne changent pas, et la prochaine capture repart sous le nouveau mot de passe.")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="rekey-secret" className="block text-xs font-medium text-text-primary mb-1">
                  {t("cloudSafeSave.secretPasswordLabel", "Mot de passe secret")} *
                </label>
                <input
                  id="rekey-secret"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  placeholder={t("cloudSafeSave.secretPasswordPlaceholder", "8 caractères minimum")}
                  value={rekeySecret}
                  onChange={(e) => setRekeySecret(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="rekey-secret-confirm" className="block text-xs font-medium text-text-primary mb-1">
                  {t("cloudSafeSave.secretPasswordConfirm", "Confirmer le mot de passe")} *
                </label>
                <input
                  id="rekey-secret-confirm"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  value={rekeyConfirm}
                  onChange={(e) => setRekeyConfirm(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-xs text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={rekeyAck}
                onChange={(e) => setRekeyAck(e.target.checked)}
                className="accent-primary h-4 w-4 mt-0.5"
              />
              {t("cloudSafeSave.rekeyAck", "Je comprends que les copies cloud existantes deviendront illisibles.")}
            </label>
            {rekeyError && <p className="text-xs text-danger">{rekeyError}</p>}
            <button
              type="button"
              className="btn btn-primary text-sm"
              onClick={() => void runRekey()}
              disabled={rekeyBusy || !rekeyAck || rekeySecret.trim().length < 8 || rekeySecret !== rekeyConfirm}
              aria-busy={rekeyBusy || undefined}
            >
              {rekeyBusy ? <RefreshCw size={14} className="animate-spin" /> : <KeyRound size={14} />}
              {rekeyBusy
                ? t("cloudSafeSave.rekeyDoing", "Redéfinition en cours…")
                : t("cloudSafeSave.rekeyButton", "Redéfinir le mot de passe")}
            </button>
          </form>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          className="btn btn-secondary text-sm"
          onClick={() => void runSnapshotOnce()}
          disabled={snapBusy}
          aria-busy={snapBusy || undefined}
        >
          {snapBusy ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
          {snapBusy
            ? t("cloudSafeSave.snapshotStarting", "Capture demandée…")
            : t("cloudSafeSave.snapshotNow", "Capture complète maintenant")}
        </button>
        <button
          className="btn btn-secondary text-sm"
          onClick={() => setShowTargets((v) => !v)}
          aria-expanded={showTargets || undefined}
        >
          <Cloud size={14} />
          {t("cloudSafeSave.destinationsTitle", "Destinations")} ({status.targets.length})
          <ChevronDown size={14} className={cn("transition-transform", showTargets && "rotate-180")} />
        </button>
      </div>

      {snapResult && (
        <p
          role={snapResult.ok ? "status" : "alert"}
          className={cn(
            "flex items-start gap-1.5 text-sm",
            snapResult.ok
              ? "text-success-strong dark:text-success-dark-strong"
              : "text-danger-strong dark:text-danger-dark-strong",
          )}
        >
          {snapResult.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
          <span>{snapResult.text}</span>
        </p>
      )}

      {showTargets && (
        <div className="rounded-btn border border-border bg-background p-4 space-y-3">
          {status.targets.length === 0 && (
            <p className="text-xs text-text-secondary">{t("cloudSafeSave.noTargets", "Aucune destination liée.")}</p>
          )}
          {status.targets.map((target) => {
            const test = testState[target.id];
            const deleting = deleteBusy === target.id;
            return (
              <div key={target.id} className="rounded-btn border border-border bg-surface p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-text-primary flex-1 min-w-0 truncate">{target.name}</p>
                  <span className="text-[11px] text-text-secondary">{driverLabel(target.driverId)}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      target.enabled
                        ? "bg-success-soft dark:bg-success-dark-soft text-success-strong dark:text-success-dark-strong"
                        : "bg-neutral-soft text-text-secondary",
                    )}
                  >
                    {target.enabled
                      ? t("cloudSafeSave.targetEnabled", "Active")
                      : t("cloudSafeSave.targetRetired", "Retirée")}
                  </span>
                </div>
                <div className="mt-1.5 space-y-1 text-xs text-text-secondary">
                  <p>
                    {t("cloudSafeSave.targetLastSuccess", "Dernier succès :")}{" "}
                    <span className="text-text-primary">
                      {target.lastSuccessAt
                        ? new Date(target.lastSuccessAt).toLocaleString("fr-FR")
                        : t("common.never", "Jamais")}
                    </span>
                    {target.consecutiveFailures > 0 && (
                      <span className="text-danger">
                        {" "}· {target.consecutiveFailures} {t("cloudSafeSave.targetFailures", "échecs")}
                      </span>
                    )}
                  </p>
                  {target.lastError && (
                    <p className="flex items-start gap-1.5 text-danger-strong dark:text-danger-dark-strong">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      <span>{target.lastError}</span>
                    </p>
                  )}
                  {test && !test.running && test.text && (
                    <p className={cn("flex items-start gap-1.5", test.ok ? "text-success-strong dark:text-success-dark-strong" : "text-danger-strong dark:text-danger-dark-strong")}>
                      {test.ok ? <CheckCircle2 size={12} className="shrink-0 mt-0.5" /> : <AlertTriangle size={12} className="shrink-0 mt-0.5" />}
                      <span>{test.text}</span>
                    </p>
                  )}
                </div>
                <div className="mt-2.5 flex gap-2 flex-wrap items-center">
                  {target.enabled ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary text-xs min-h-[32px]"
                        onClick={() => void runTest(target.id)}
                        disabled={test?.running || deleting}
                      >
                        {test?.running ? <RefreshCw size={12} className="animate-spin" /> : <TestTube2 size={12} />}
                        {t("cloudSafeSave.testTarget", "Tester")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary text-xs min-h-[32px] hover:text-danger"
                        onClick={() => void runDelete(target.id, target.name)}
                        disabled={test?.running || deleting}
                      >
                        {deleting ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        {t("cloudSafeSave.deleteTarget", "Retirer")}
                      </button>
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-text-secondary">
                        {t("cloudSafeSave.targetRetiredNote", "Retirée de la synchronisation — les copies déjà envoyées restent sur le cloud.")}
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary text-xs min-h-[32px] hover:text-danger"
                        onClick={() => void runPurge(target.id, target.name)}
                        disabled={deleting}
                      >
                        {deleting ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        {t("cloudSafeSave.purgeTarget", "Supprimer définitivement")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {showAdd ? (
            <div className="pt-1">
              <div className="flex justify-end mb-2">
                <button type="button" className="btn btn-secondary text-xs" onClick={() => setShowAdd(false)}>
                  {t("fields.cancel")}
                </button>
              </div>
              <StepTargets
                drivers={drivers}
                targetIds={addIds}
                setTargetIds={setAddIds}
                linkedDriverIds={status.targets.map((target) => target.driverId)}
                busy={addBusy}
                setBusy={setAddBusy}
                error={addError}
                setError={setAddError}
                askSecret={false}
                confirmSecret
                secret={addSecret}
                setSecret={setAddSecret}
                onNext={async () => {
                  setShowAdd(false);
                  setAddIds([]);
                  setAddSecret("");
                  await onRefresh();
                }}
              />
            </div>
          ) : (
            <button type="button" className="btn btn-secondary text-xs" onClick={() => setShowAdd(true)}>
              <Plus size={13} />
              {t("cloudSafeSave.addDestination", "Ajouter une destination")}
            </button>
          )}
        </div>
      )}
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
  const [linkedDriverIds, setLinkedDriverIds] = useState<string[]>([]);
  const [schoolId, setSchoolId] = useState("");
  // Admin-chosen secret password (replaces the generated 12-word phrase): it
  // is the encryption key for every destination, typed once at connection and
  // reusable for each additional destination. Never stored — sealed server-side
  // at step 1, kept here only until the wizard finishes.
  const [secret, setSecret] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return sessionStorage.getItem(PHRASE_SESSION_KEY) ?? "";
    } catch {
      return "";
    }
  });

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

  // Pick up destinations linked in an earlier run: the link lives server-side,
  // so leaving and coming back must not demand reconnecting. Targets created
  // above join the list through setTargetIds as usual.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const st = await cloudBackupApi.status();
        if (!cancelled) {
          const ids = (st.targets ?? []).filter((t) => t.enabled).map((t) => t.id);
          if (ids.length > 0) setTargetIds((current) => [...current, ...ids.filter((id) => !current.includes(id))]);
          setLinkedDriverIds((st.targets ?? []).filter((t) => t.enabled).map((t) => t.driverId));
        }
      } catch {
        /* step 1 starts empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const next = () => setStep((s) => s + 1);

  // Leaving and coming back mid-wizard must not lose the typed secret (the
  // old phrase survived the same way); it is cleared onDone by the parent.
  useEffect(() => {
    try {
      if (secret) sessionStorage.setItem(PHRASE_SESSION_KEY, secret);
      else sessionStorage.removeItem(PHRASE_SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [secret]);

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

      <ol className="flex items-center gap-2 mb-6" aria-label={t("cloudSafeSave.steps", "Ã‰tapes")}>
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
          linkedDriverIds={linkedDriverIds}
          busy={busy}
          setBusy={setBusy}
          error={error}
          setError={setError}
          askSecret
          confirmSecret={false}
          secret={secret}
          setSecret={setSecret}
          onNext={next}
        />
      )}

      {step === 1 && (
        <StepPhrase
          schoolId={schoolId}
          setSchoolId={setSchoolId}
          secret={secret}
          setSecret={setSecret}
          onNext={next}
          onBack={() => setStep(0)}
        />
      )}

      {step === 2 && (
        <StepVerify
          schoolId={schoolId}
          secret={secret}
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
  linkedDriverIds,
  busy,
  setBusy,
  error,
  setError,
  askSecret,
  confirmSecret,
  secret,
  setSecret,
  onNext,
}: {
  drivers: DriverDefinition[];
  targetIds: string[];
  setTargetIds: (ids: string[]) => void;
  linkedDriverIds: string[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;
  /** Wizard only: capture the admin secret password at connection time. */
  askSecret: boolean;
  /** Configured setup only: confirm the existing secret password to link one more destination. */
  confirmSecret: boolean;
  secret: string;
  setSecret: (v: string) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Consent links already issued per oauth field: the paste panel opens on
  // its own with the link, so approving anywhere (popup, another tab, a
  // phone) always lands back here instead of a stuck spinner.
  const [oauthLinks, setOauthLinks] = useState<Record<string, { url: string; state: string }>>({});

  const def = drivers.find((d) => d.id === picked) ?? null;

  // Developer credentials (own OAuth client) hide behind a toggle: a school
  // must never face "Client ID" inputs for the one-click providers.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const visibleFields = def?.fields.filter((f) => !f.advanced) ?? [];
  const advancedFields = def?.fields.filter((f) => f.advanced) ?? [];
  const requiredFields = showAdvanced ? (def?.fields ?? []) : visibleFields;
  // One list for the form below: developer credentials join only behind the toggle.
  const shownFields = showAdvanced ? (def?.fields ?? []) : visibleFields;

  // Admin secret password, captured at connection for Dropbox / external disk.
  // A further destination reuses it through the checkbox below instead of
  // asking for a new one: one password encrypts every destination.
  const [reuseSecret, setReuseSecret] = useState(true);
  const [secretConfirm, setSecretConfirm] = useState("");
  const SECRET_IDS = ["folder", "dropbox"];
  const showSecret = (askSecret || confirmSecret) && def !== null && SECRET_IDS.includes(def.id);
  const hasLinked = targetIds.length > 0 || linkedDriverIds.length > 0;
  const canReuse = askSecret && !confirmSecret && !!showSecret && secret.trim().length > 0 && hasLinked;
  const secretReady =
    !showSecret ||
    (canReuse && reuseSecret) ||
    (confirmSecret
      ? secret.trim().length > 0
      : secret.trim().length >= 8 && secret === secretConfirm);

  /**
   * Connect an account for an OAuth destination.
   *
   * The server holds the app credentials for both providers, so this asks the
   * administrator for nothing â€” they pick an account and approve. `values`
   * only carries credentials when a self-hoster registered their own app.
   *
   * One consent URL feeds both connect paths: the popup opens it directly,
   * the "other computer" mode shows it as a link whose `code` is pasted back.
   * The redirect target never needs to load on the approving device.
   */
  const requestOAuthUrl = async (): Promise<{ url: string; state: string }> => {
    if (!def) throw new Error("No driver selected");
    const isDropbox = def.id === "dropbox";
    const redirectUri = `${window.location.origin}/api/cloud-backup/oauth/${
      isDropbox ? "dropbox" : "gdrive"
    }/callback`;
    return isDropbox
      ? cloudBackupApi.dropboxOAuthUrl({
          appKey: values["appKey"] || undefined,
          appSecret: values["appSecret"] || undefined,
          redirectUri,
        })
      : cloudBackupApi.gdriveOAuthUrl({
          clientId: values["clientId"] || undefined,
          clientSecret: values["clientSecret"] || undefined,
          redirectUri,
        });
  };

  /**
   * Copy-code variant: fixed loopback redirect (see manualOAuthRedirectUri),
   * so the link works opened from any machine — never the LAN address.
   */
  const requestManualOAuthUrl = async (): Promise<{ url: string; state: string }> => {
    if (!def) throw new Error("No driver selected");
    const isDropbox = def.id === "dropbox";
    const provider = isDropbox ? "dropbox" : "gdrive";
    const redirectUri = cloudBackupApi.manualOAuthRedirectUri(provider);
    return isDropbox
      ? cloudBackupApi.dropboxOAuthUrl({
          appKey: values["appKey"] || undefined,
          appSecret: values["appSecret"] || undefined,
          redirectUri,
        })
      : cloudBackupApi.gdriveOAuthUrl({
          clientId: values["clientId"] || undefined,
          clientSecret: values["clientSecret"] || undefined,
          redirectUri,
        });
  };

  const runOAuth = async (fieldName: string) => {
    if (!def) return;
    const isDropbox = def.id === "dropbox";
    const messageType = isDropbox ? "iq-dropbox-oauth" : "iq-gdrive-oauth";
    setSaving(true);
    setError(null);
    try {
      const { url, state } = await requestOAuthUrl();
      // Publish the link first: whatever happens with the popup, the code
      // has somewhere to be pasted.
      setOauthLinks((v) => ({ ...v, [fieldName]: { url, state } }));
      const popup = window.open(url, messageType, "width=560,height=720");
      // The popup carries on on its own from here — the button must not spin
      // forever if the approval happens in another tab.
      setSaving(false);
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
              const res = await cloudBackupApi.oauthExchange({ state: ev.data.state, code: ev.data.code });
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
      setSaving(false);
      setError(errorMessage(err));
    }
  };

  const saveTarget = async () => {
    if (!def) return;
    setError(null);
    if (showSecret && confirmSecret) {
      // Configured install: the key is sealed since step 1 — prove the admin
      // knows it before attaching another destination to the same ciphertext.
      if (!secret.trim()) {
        setError(t("cloudSafeSave.secretPasswordRequired", "Saisissez le mot de passe secret pour lier cette destination."));
        return;
      }
      setSaving(true);
      try {
        const check = await cloudBackupApi.verifyPassword({ phrase: secret });
        if (!check?.ok) throw new Error(t("cloudSafeSave.secretPasswordWrong", "Mot de passe secret incorrect."));
      } catch (err) {
        setSaving(false);
        setError(errorMessage(err));
        return;
      }
    } else if (showSecret && !(canReuse && reuseSecret)) {
      if (secret.trim().length < 8) {
        setError(t("cloudSafeSave.secretPasswordTooShort", "Mot de passe secret : 8 caractères minimum."));
        return;
      }
      if (secret !== secretConfirm) {
        setError(t("cloudSafeSave.secretPasswordMismatch", "Les deux mots de passe ne correspondent pas."));
        return;
      }
      setSaving(true);
    } else {
      setSaving(true);
    }
    try {
      const result = await cloudBackupApi.createTarget({ driverId: def.id, config: values });
      setTargetIds([...targetIds, result.id]);
      setValues({});
      setOauthLinks({});
      setPicked(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // Setup offers exactly two destinations — the safe, free, one-minute
  // ones (external disk, Dropbox). Google Drive is retired from new setups
  // (its consent wall refuses most schools) but existing Drive backups stay
  // readable through the restore dialog, which does not filter on selectable.
  // Expert drivers (S3, WebDAV…) still work through the API and appear
  // in the restore dialog, but a school setting up backup should never have
  // to choose between providers. Dropbox leads: no vendor validation,
  // no test-user list, LAN-friendly — the login-and-link flow.
  const SIMPLE_IDS = ["folder", "dropbox"];
  const simple = SIMPLE_IDS.map((id) => drivers.find((d) => d.id === id)).filter(
    (d): d is DriverDefinition => d !== undefined && d.selectable !== false,
  );
  const primary = simple.length > 0 ? simple : drivers.filter((d) => d.recommended);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-text-primary mb-2">{t("cloudSafeSave.step1Title", "Choisissez une destination")}</p>
        <p className="text-xs text-text-secondary mb-4">
          {t("cloudSafeSave.step1Subtitle", "Où garder une copie chiffrée de vos données. Une suffit, deux c'est mieux.")}
        </p>

        {targetIds.length > 0 && (
          <p className="rounded-btn border border-success/30 bg-success-soft dark:bg-success-dark-soft px-4 py-3 text-sm text-success-strong dark:text-success-dark-strong mb-4">
            {t(
              "cloudSafeSave.alreadyLinked",
              "{n} destination(s) déjà liée(s) — Continuer, ou ajoutez-en une autre ci-dessous.",
            ).replace("{n}", String(targetIds.length))}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {primary.map((d) => (
            <DriverCard
              key={d.id}
              driver={d}
              selected={picked === d.id}
              onSelect={() => {
                setPicked(d.id);
                setShowAdvanced(false);
                setOauthLinks({});
                setError(null);
              }}
            />
          ))}
        </div>

        {def && (
          <div className="mt-4 space-y-4 rounded-btn border border-border bg-background p-4">
            {def.setupHelp && (
              // Where to click in the provider's own site. For someone who has
              // never created a bucket this is the most useful thing here.
              <div className="rounded-btn border border-primary/30 bg-primary-50 dark:bg-primary/10 px-4 py-3">
                <p className="text-xs leading-relaxed text-text-secondary whitespace-pre-line">{def.setupHelp}</p>
              </div>
            )}
            {shownFields.map((field) => (
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
                    <option value="">â€”</option>
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
                            ? t("cloudSafeSave.dropboxConnected", "Compte Dropbox connectÃ©")
                            : t("cloudSafeSave.googleConnected", "Compte Google connectÃ©")}
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
                    {!values[field.name] && (
                      <ManualOAuthConnect
                        getUrl={() => requestManualOAuthUrl()}
                        exchange={(body) => cloudBackupApi.oauthExchange(body)}
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

            {advancedFields.length > 0 && (
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

            {showSecret && (
              <form className="rounded-btn border border-gold/40 bg-gold/10 px-4 py-3 space-y-3" onSubmit={(e) => e.preventDefault()}>
                <div className="flex items-center gap-2">
                  <KeyRound size={14} className="text-gold-500 dark:text-gold-400 shrink-0" />
                  <p className="text-sm font-semibold text-text-primary">
                    {t("cloudSafeSave.secretPasswordLabel", "Mot de passe secret")}
                  </p>
                </div>
                <p className="text-xs text-text-secondary">
                  {confirmSecret
                    ? t("cloudSafeSave.confirmSecretPasswordHelp", "Confirmez le mot de passe secret qui chiffre les sauvegardes — seule une personne qui le connaît peut lier une destination.")
                    : t("cloudSafeSave.secretPasswordHelp", "Il chiffre les copies sur cette destination. Sans lui, aucune restauration n'est possible.")}
                </p>
                {confirmSecret ? (
                  <div>
                    <label htmlFor="tgt-secret-confirm-only" className="block text-xs font-medium text-text-primary mb-1">
                      {t("cloudSafeSave.secretPasswordLabel", "Mot de passe secret")} *
                    </label>
                    <input
                      id="tgt-secret-confirm-only"
                      type="password"
                      autoComplete="current-password"
                      className="input"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                    />
                  </div>
                ) : (
                  <>
                {canReuse && (
                  <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reuseSecret}
                      onChange={(e) => setReuseSecret(e.target.checked)}
                      className="accent-primary h-4 w-4"
                    />
                    {t("cloudSafeSave.useSamePassword", "Utiliser le même mot de passe")}
                  </label>
                )}
                {(!canReuse || !reuseSecret) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="tgt-secret" className="block text-xs font-medium text-text-primary mb-1">
                        {t("cloudSafeSave.secretPasswordLabel", "Mot de passe secret")} *
                      </label>
                      <input
                        id="tgt-secret"
                        type="password"
                        autoComplete="new-password"
                        className="input"
                        placeholder={t("cloudSafeSave.secretPasswordPlaceholder", "8 caractères minimum")}
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="tgt-secret-confirm" className="block text-xs font-medium text-text-primary mb-1">
                        {t("cloudSafeSave.secretPasswordConfirm", "Confirmer le mot de passe")} *
                      </label>
                      <input
                        id="tgt-secret-confirm"
                        type="password"
                        autoComplete="new-password"
                        className="input"
                        value={secretConfirm}
                        onChange={(e) => setSecretConfirm(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {canReuse && reuseSecret && (
                  <p className="text-xs text-text-secondary">
                    {t("cloudSafeSave.useSamePasswordNote", "Cette destination utilisera le même mot de passe secret.")}
                  </p>
                )}
                  </>
                )}
              </form>
            )}

            {linkedDriverIds.includes(def.id) ? (
              <p className="rounded-btn border border-success/30 bg-success-soft dark:bg-success-dark-soft px-4 py-3 text-sm text-success-strong dark:text-success-dark-strong">
                {t("cloudSafeSave.driverAlreadyLinked", "Cette destination est déjà liée — Continuer ci-dessous.")}
              </p>
            ) : (
              <div className="flex gap-3">
                <button type="button" className="btn btn-primary text-sm" onClick={() => void saveTarget()} disabled={saving || !secretReady || !requiredFields.every((f) => !f.required || (values[f.name] ?? "").trim())} aria-busy={saving || undefined}>
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                  {t("cloudSafeSave.addTarget", "Tester et enregistrer")}
                </button>
                <button type="button" className="btn btn-secondary text-sm" onClick={() => setPicked(null)}>
                  {t("common.cancel", "Annuler")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {targetIds.length > 0 && (
        <div className="rounded-btn border border-success/30 bg-success-soft dark:bg-success-dark-soft px-4 py-3 text-sm text-success-strong dark:text-success-dark-strong flex items-center gap-2">
          <CheckCircle2 size={16} />
          {t("cloudSafeSave.targetsReady", "{n} destination(s) enregistrÃ©e(s)").replace("{n}", String(targetIds.length))}
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
  secret,
  setSecret,
  onNext,
  onBack,
}: {
  schoolId: string;
  setSchoolId: (v: string) => void;
  secret: string;
  setSecret: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  // Fallback when the secret was not typed at connection (or to change it):
  // prefilled when step 1 already captured it. Touching the confirmation is
  // what arms the match check, so a prefilled secret is not blocked by an
  // empty confirm box.
  const [confirm, setConfirm] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const secretValid = secret.trim().length >= 8 && (!confirmTouched || secret === confirm);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-text-primary mb-2">{t("cloudSafeSave.step2Title", "Identifiant d'école et mot de passe secret")}</p>
        <p className="text-xs text-text-secondary mb-4">
          {t("cloudSafeSave.step2Subtitle", "L'identifiant d'école sert d'espace de stockage. Le mot de passe est la seule clé des données chiffrées : il n'est jamais stocké sur cette machine ni sur le cloud.")}
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

      <form className="rounded-btn border border-border bg-background p-4 space-y-3" onSubmit={(e) => e.preventDefault()}>
        <div className="flex items-center gap-2">
          <KeyRound size={14} className="text-gold-500 dark:text-gold-400 shrink-0" />
          <p className="text-sm font-semibold text-text-primary">{t("cloudSafeSave.secretPasswordTitle", "Mot de passe secret")}</p>
        </div>
        <p className="text-xs text-text-secondary">
          {t("cloudSafeSave.secretPasswordHelp", "Il chiffre les copies sur Dropbox et le disque externe. Sans lui, aucune restauration n'est possible.")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="wizard-secret" className="block text-xs font-medium text-text-primary mb-1">
              {t("cloudSafeSave.secretPasswordLabel", "Mot de passe secret")} *
            </label>
            <input
              id="wizard-secret"
              type="password"
              autoComplete="new-password"
              className="input"
              placeholder={t("cloudSafeSave.secretPasswordPlaceholder", "8 caractères minimum")}
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setConfirmTouched(false);
                setConfirm("");
              }}
            />
          </div>
          <div>
            <label htmlFor="wizard-secret-confirm" className="block text-xs font-medium text-text-primary mb-1">
              {t("cloudSafeSave.secretPasswordConfirm", "Confirmer le mot de passe")} *
            </label>
            <input
              id="wizard-secret-confirm"
              type="password"
              autoComplete="new-password"
              className="input"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setConfirmTouched(true);
              }}
            />
          </div>
        </div>
        {confirmTouched && secret !== confirm && (
          <p className="text-xs text-danger">
            {t("cloudSafeSave.secretPasswordMismatch", "Les deux mots de passe ne correspondent pas.")}
          </p>
        )}
      </form>

      <div className="flex justify-between">
        <button className="btn btn-secondary text-sm" onClick={onBack}>
          {t("common.back", "Retour")}
        </button>
        <button className="btn btn-primary text-sm" onClick={onNext} disabled={!secretValid || !schoolId.trim()}>
          {t("common.next", "Continuer")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepVerify({
  schoolId,
  secret,
  busy,
  setBusy,
  error,
  setError,
  onNext,
  onBack,
}: {
  schoolId: string;
  secret: string;
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
  // The check needs no decision from the administrator, so it starts on its
  // own and moves on when everything answers. Failures stay put with Retry.
  const autoStarted = useRef(false);
  // Step 1 writes the school identity and seals any previous one: running it
  // twice trips the reconfigure guard ("déjà configurée… irréversible"), so
  // retries re-verify only. Unmount (Retour) resets this with everything else.
  const step1Done = useRef(false);

  const run = async () => {
    // Never send an empty step-1: the server can only answer 400, which reads
    // like a system fault for what is actually a missing field. Name it and
    // point back instead.
    if (!secret.trim() || !schoolId.trim()) {
      setError(
        t(
          "cloudSafeSave.missingIdOrPhrase",
          "L'identifiant d'école ou le mot de passe manque — retournez à l'étape précédente et vérifiez les deux champs.",
        ),
      );
      return;
    }
    setError(null);
    setRunning(true);
    setBusy(true);
    try {
      if (!step1Done.current) {
        await cloudBackupApi.step1({ schoolId: schoolId.trim(), phrase: secret });
        step1Done.current = true;
      }
      const v = await cloudBackupApi.verifySetup();
      setResult(v);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
      setBusy(false);
    }
  };

  useEffect(() => {
    // StrictMode double-mounts in dev; the ref keeps the probe to one run.
    if (autoStarted.current) return;
    autoStarted.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!result?.ok) return;
    // Let the green checks register, then continue on their own.
    const id = setTimeout(onNext, 1500);
    return () => clearTimeout(id);
  }, [result?.ok, onNext]);

  return (
    <div className="space-y-5">
      <p className="text-sm font-medium text-text-primary">{t("cloudSafeSave.step3Title", "VÃ©rification de bout en bout")}</p>
      <p className="text-xs text-text-secondary">
        {running && !result
          ? t("cloudSafeSave.verifyingAuto", "VÃ©rification en cours â€” chaque destination est testÃ©e automatiquementâ€¦")
          : t("cloudSafeSave.step3Subtitle", "Une Ã©criture de test est chiffrÃ©e et envoyÃ©e vers chaque destination, puis relue. Toute destination doit rÃ©pondre avant de valider.")}
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
                ? t("cloudSafeSave.verifyOk", "Destination vÃ©rifiÃ©e")
                : `${t("cloudSafeSave.verifyFailed", "Ã‰chec")} â€” ${tgt.lastError ?? ""}`}
            </div>
          ))}
          {result.ok ? (
            <p className="text-sm text-success-strong dark:text-success-dark-strong font-medium">{t("cloudSafeSave.verifyAllOk", "Toutes les destinations sont prÃªtes.")}</p>
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
            {result ? t("cloudSafeSave.reverify", "Re-vÃ©rifier") : t("cloudSafeSave.verifyNow", "VÃ©rifier")}
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
  // No decision to make here either: the capture starts on its own.
  const autoStarted = useRef(false);

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

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "done") {
    return (
      <div className="space-y-4 text-center py-4">
        <CheckCircle2 size={40} className="mx-auto text-success dark:text-success-dark" />
        <p className="text-h4 font-bold text-text-primary">{t("cloudSafeSave.doneTitle", "Sauvegarde cloud activÃ©e")}</p>
        <p className="text-sm text-text-secondary">
          {t("cloudSafeSave.doneText", "La premiÃ¨re capture complÃ¨te a Ã©tÃ© chiffrÃ©e et envoyÃ©e. La synchronisation continue dÃ©sormais en arriÃ¨re-plan, toutes les minutes.")}
        </p>
        <button className="btn btn-primary" onClick={() => void onDone()}>
          {t("common.close", "Fermer")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm font-medium text-text-primary">{t("cloudSafeSave.step4Title", "PremiÃ¨re capture complÃ¨te")}</p>
      <p className="text-xs text-text-secondary">
        {t("cloudSafeSave.step4Subtitle", "La base entiÃ¨re est exportÃ©e, compressÃ©e, chiffrÃ©e puis envoyÃ©e. Cela peut prendre quelques minutes sur une grosse base.")}
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-3">
        <button className="btn btn-primary text-sm" onClick={() => void run()} disabled={state === "running"} aria-busy={state === "running" || undefined}>
          <Database size={14} />
          {state === "running" ? t("cloudSafeSave.snapshotting", "Capture en coursâ€¦") : t("cloudSafeSave.snapshotStart", "Lancer la capture")}
        </button>
        {state === "failed" && (
          <button className="btn btn-secondary text-sm" onClick={() => void run()}>
            {t("common.retry", "RÃ©essayer")}
          </button>
        )}
      </div>
    </div>
  );
}