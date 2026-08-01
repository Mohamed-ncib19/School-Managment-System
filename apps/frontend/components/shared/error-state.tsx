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
    return { kind: "unknown", title: "Please check the details", detail: serverMessage };
  }

  if (err?.code === "ERR_NETWORK" || err?.message === "Network Error") {
    return {
      kind: "network",
      title: "Cannot reach the server",
      detail: "The application server is not responding. Check that it is running, then try again.",
    };
  }
  if (status === 401) {
    return { kind: "auth", title: "Your session has expired", detail: "Sign in again to continue." };
  }
  if (status === 403) {
    return { kind: "auth", title: "You do not have access", detail: serverMessage ?? "This action requires additional permissions." };
  }
  if (status === 404) {
    return { kind: "notfound", title: "Not found", detail: serverMessage ?? "The record you asked for no longer exists." };
  }
  if (status === 429) {
    return { kind: "server", title: "Too many requests", detail: serverMessage ?? "Please wait a moment and try again." };
  }
  if (status && status >= 500) {
    return { kind: "server", title: "The server ran into a problem", detail: serverMessage ?? "This has been recorded. Try again in a moment." };
  }
  if (status && status >= 400) {
    return { kind: "unknown", title: "That request could not be completed", detail: serverMessage ?? "Please check the details and try again." };
  }
  return {
    kind: "unknown",
    title: "Something went wrong",
    detail: serverMessage ?? err?.message ?? "An unexpected error occurred.",
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
          {isRetrying ? "Retrying..." : "Try again"}
        </button>
      )}
    </div>
  );
}
