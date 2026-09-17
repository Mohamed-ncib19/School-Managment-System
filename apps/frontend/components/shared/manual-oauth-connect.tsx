"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, KeyRound } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";

/**
 * "Sur un autre poste ?" — manual OAuth code entry for connecting a cloud
 * account from any computer on the LAN.
 *
 * The popup flow only works sitting at the server (loopback redirect). Here
 * the administrator instead opens the SAME consent URL on any device, copies
 * the `code` out of the address bar after the provider redirects (that page
 * never needs to load), and pastes it below. `getUrl` fetches a fresh consent
 * URL + handshake state, `exchange` swaps the pasted code server-side, and
 * `onToken` receives the refresh token exactly like the popup path.
 */
export function ManualOAuthConnect({
  getUrl,
  exchange,
  onToken,
  initialLink = null,
}: {
  getUrl: () => Promise<{ url: string; state: string }>;
  exchange: (body: { state: string; code: string }) => Promise<{ refreshToken: string }>;
  onToken: (refreshToken: string) => void;
  /**
   * When the caller already issued a consent URL (connect button), the panel
   * opens on its own with that link — the administrator approves wherever
   * they like and pastes the code right here. No second click needed.
   */
  initialLink?: { url: string; state: string } | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<{ url: string; state: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialLink) {
      setLink(initialLink);
      setOpen(true);
    }
  }, [initialLink]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await getUrl());
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("cloudSafeSave.copyFailed", "Copie impossible — sélectionnez le lien manuellement."));
    }
  };

  const submit = async () => {
    if (!link || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await exchange({ state: link.state, code: code.trim() });
      onToken(res.refreshToken);
      setOpen(false);
      setLink(null);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs text-text-secondary hover:text-primary underline mt-2"
        onClick={() => void start()}
        disabled={busy}
      >
        <KeyRound size={12} className="inline mr-1" aria-hidden="true" />
        {t("cloudSafeSave.otherComputer", "Sur un autre poste ? Connectez sans être devant le serveur")}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-btn border border-border bg-background p-3 space-y-3">
      <p className="text-xs text-text-secondary">
        {t(
          "cloudSafeSave.manualOAuthHelp",
          "1. Ouvrez le lien sur n'importe quel appareil et acceptez. 2. Recopiez ici le code affiché sur la page.",
        )}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={link?.url ?? ""}
          onFocus={(e) => e.target.select()}
          className="input font-mono text-xs flex-1"
          aria-label={t("cloudSafeSave.consentLink", "Lien d'autorisation")}
        />
        <button type="button" className="btn btn-secondary text-xs shrink-0" onClick={() => void copy()}>
          {copied ? (
            <CheckCircle2 size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          {copied
            ? t("cloudSafeSave.copied", "Copié")
            : t("cloudSafeSave.copyLink", "Copier")}
        </button>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("cloudSafeSave.pasteCode", "Collez le code ici")}
          className="input font-mono text-sm flex-1"
          aria-label={t("cloudSafeSave.pasteCode", "Collez le code ici")}
        />
        <button
          type="button"
          className="btn btn-primary text-xs shrink-0"
          onClick={() => void submit()}
          disabled={busy || !code.trim()}
        >
          {t("cloudSafeSave.validateCode", "Valider")}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
