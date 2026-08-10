"use client";

import { AlertCircle, RefreshCw, WifiOff, ShieldAlert, SearchX } from "lucide-react";

/**
 * Turns a thrown request error into something an administrator can act on.
 *
 * Axios errors stringify to "Request failed with status code 500", which tells
 * the person at the desk nothing. This maps the failure to what happened and
 * what to do about it, and always offers a way to try again.
 */
export function describeError(error: unknown): { title: string; detail: string; kind: "network" | "auth" | "notfound" | "server" | "unknown" } {
  const err = error as any;
  const status: number | undefined = err?.response?.status;

  /**
   * Validation failures arrive as a string[] - one entry per invalid field.
   * Rendering the array directly printed "[object Object]", so join them into
   * something the administrator can actually read and act on.
   */
  const rawMessage = err?.response?.data?.error?.message ?? err?.response?.data?.message;
  const serverMessage: string | undefined = Array.isArray(rawMessage)
    ? rawMessage.join(". ")
    : typeof rawMessage === "string"
      ? rawMessage
      : undefined;

  if (status === 400 && serverMessage) {
    return { kind: "unknown", title: "Veuillez vérifier les détails", detail: serverMessage };
  }

  if (err?.code === "ERR_NETWORK" || err?.message === "Network Error") {
    return {
      kind: "network",
      title: "Impossible de joindre le serveur",
      detail: "Le serveur de l'application ne répond pas. Vérifiez qu'il est en cours d'exécution, puis réessayez.",
    };
  }
  if (status === 401) {
    return { kind: "auth", title: "Votre session a expiré", detail: "Connectez-vous à nouveau pour continuer." };
  }
  if (status === 403) {
    return { kind: "auth", title: "Vous n'avez pas accès", detail: serverMessage ?? "Cette action nécessite des autorisations supplémentaires." };
  }
  if (status === 404) {
    return { kind: "notfound", title: "Introuvable", detail: serverMessage ?? "L'enregistrement demandé n'existe plus." };
  }
  if (status === 429) {
    return { kind: "server", title: "Trop de requêtes", detail: serverMessage ?? "Patientez un instant puis réessayez." };
  }
  if (status && status >= 500) {
    return { kind: "server", title: "Le serveur a rencontré un problème", detail: serverMessage ?? "L'incident a été enregistré. Réessayez dans un instant." };
  }
  if (status && status >= 400) {
    return { kind: "unknown", title: "La requête n'a pas pu être effectuée", detail: serverMessage ?? "Vérifiez les détails puis réessayez." };
  }
  return {
    kind: "unknown",
    title: "Une erreur est survenue",
    detail: serverMessage ?? err?.message ?? "Une erreur inattendue s'est produite.",
  };
}

const ICONS = {
  network: WifiOff,
  auth: ShieldAlert,
  notfound: SearchX,
  server: AlertCircle,
  unknown: AlertCircle,
} as const;

export function ErrorState({
  error,
  onRetry,
  isRetrying = false,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
  compact?: boolean;
}) {
  const { title, detail, kind } = describeError(error);
  const Icon = ICONS[kind];

  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center rounded-card border border-danger/20 bg-danger-soft/40 px-4 text-center dark:bg-danger-dark-soft ${
        compact ? "py-6" : "py-14"
      }`}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger dark:text-danger-dark">
        <Icon size={22} />
      </div>
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1 max-w-md text-xs text-text-secondary">{detail}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="btn btn-secondary mt-4 text-xs disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={14} className={isRetrying ? "animate-spin" : ""} />
          {isRetrying ? "Nouvelle tentative..." : "Réessayer"}
        </button>
      )}
    </div>
  );
}
