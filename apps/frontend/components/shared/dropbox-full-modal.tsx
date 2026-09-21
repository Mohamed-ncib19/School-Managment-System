"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff } from "lucide-react";
import { useCloudSyncStore } from "@/hooks/use-cloud-sync-store";
import { useTranslation } from "@/lib/i18n/context";

/**
 * App-wide Dropbox-full dialog. Appears on every dashboard visit while an
 * enabled Dropbox destination reports insufficient space — the sync worker
 * cannot make progress until the account has room again, so this is shown
 * next to (not instead of) the per-target error in Settings → Data safety.
 *
 * Dismissal lasts for the current mount only: the next visit (or a fresh
 * full signal after recovery) shows it again. No external links — the steps
 * point at the account the school already connected, and the primary action
 * opens the in-app destinations list to re-test after freeing space.
 */
export default function DropboxFullModal() {
  const { t } = useTranslation();
  const router = useRouter();
  const status = useCloudSyncStore((s) => s.status);
  const [dismissed, setDismissed] = useState(false);

  const full = (status?.targets ?? []).some((target) => target.enabled && target.quotaFull);

  useEffect(() => {
    if (!full) setDismissed(false);
  }, [full]);

  if (!full || dismissed) return null;

  const openDestinations = () => {
    setDismissed(true);
    router.push("/settings");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dropbox-full-title"
      aria-describedby="dropbox-full-body"
    >
      <div className="mx-4 w-full max-w-md rounded-modal bg-surface p-6 shadow-modal">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-danger-soft dark:bg-danger-dark-soft text-danger">
            <CloudOff size={20} />
          </div>
          <h3 id="dropbox-full-title" className="text-h4 font-bold text-text-primary">
            {t("cloudSafeSave.dropboxFullTitle", "Espace Dropbox plein")}
          </h3>
        </div>

        <p id="dropbox-full-body" className="mb-4 text-sm text-text-secondary">
          {t(
            "cloudSafeSave.dropboxFullText",
            "La sauvegarde est en pause : le compte Dropbox connecté n'a plus de place. Les copies déjà envoyées sont intactes, mais plus rien de nouveau ne part tant que le compte n'a pas de place libre. Le quota concerne tout le compte Dropbox, pas seulement le dossier de l'application.",
          )}
        </p>

        <ol className="mb-5 list-decimal space-y-2 pl-5 text-sm text-text-primary">
          <li>
            {t(
              "cloudSafeSave.dropboxFullStep1",
              "Vérifiez l'espace : sur Dropbox, ouvrez les paramètres du compte connecté et regardez le quota utilisé.",
            )}
          </li>
          <li>
            {t(
              "cloudSafeSave.dropboxFullStep2",
              "Libérez de la place : supprimez ou déplacez des fichiers volumineux, puis videz les fichiers supprimés.",
            )}
          </li>
          <li>
            {t(
              "cloudSafeSave.dropboxFullStep3",
              "Ou passez à une offre supérieure depuis les paramètres de ce même compte Dropbox.",
            )}
          </li>
          <li>
            {t(
              "cloudSafeSave.dropboxFullStep4",
              "Revenez ici : Paramètres → Sécurité des données → Tester la destination, puis Capture complète.",
            )}
          </li>
        </ol>

        <div className="flex justify-end gap-3">
          <button className="btn btn-secondary text-sm" onClick={() => setDismissed(true)}>
            {t("common.later", "Plus tard")}
          </button>
          <button className="btn btn-primary text-sm" onClick={openDestinations}>
            {t("cloudSafeSave.dropboxFullAction", "Voir les destinations")}
          </button>
        </div>
      </div>
    </div>
  );
}
