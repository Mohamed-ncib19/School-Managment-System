import { ApiClient } from "./client";

/**
 * Cloud safe save (cloud-backup) API. The backend exposes a setup wizard,
 * target management, a live status endpoint for the navbar indicator, and the
 * disaster-recovery restore flow (which is the only part reachable without a
 * session — it lives on the login screen for new hardware).
 */

export type SyncState = "synced" | "offline" | "syncing" | "attention" | "disabled" | "unconfigured";

export interface CloudTargetStatus {
  id: string;
  name: string;
  driverId: string;
  enabled: boolean;
  hasSecret: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface CloudBackupStatus {
  configured: boolean;
  state: SyncState;
  schoolId: string | null;
  instanceUuid: string | null;
  hostname: string | null;
  conflict: { hostname: string; instanceUuid: string; claimedAt: string } | null;
  queue: {
    pending: number;
    failed: number;
    total: number;
    oldestPendingAt: string | null;
    pendingBytes: number;
  };
  targets: CloudTargetStatus[];
  lastSync: string | null;
  lastSnapshot: string | null;
}

export interface DriverFieldDef {
  name: string;
  type: "url" | "text" | "password" | "number" | "select" | "folder" | "oauth";
  label: string;
  placeholder?: string;
  help?: string;
  required: boolean;
  secret: boolean;
  /** Developer credential (own OAuth client) — UI hides these behind a toggle. */
  advanced?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface DriverDefinition {
  id: string;
  displayName: string;
  description: string;
  requiresOAuth: boolean;
  /**
   * True when the server ships its own Google OAuth client, so connecting is
   * one button and the client id / secret fields are not sent at all.
   */
  oauthReady?: boolean;
  /** Free, no card, under a minute — shown on the first screen. */
  recommended?: boolean;
  /** What the school gets for nothing, stated plainly on the card. */
  freeTier?: string | null;
  /** Where to click in the provider's own site to obtain these values. */
  setupHelp?: string | null;
  fields: DriverFieldDef[];
}

export interface RecoveryPhrase {
  words: string[];
  /** Lowercase words joined by a single space — the canonical form to send back. */
  phrase: string;
  /** The phrase formatted for printing in a 3x4 grid. */
  grid: string[];
}

export interface RestorePlan {
  jobId: string;
  schoolId: string;
  snapshot: { key: string; created_at: string; covers_to_seq: number; uncompressed_bytes: number } | null;
  eventBatches: Array<{ key: string; from: number; to: number }>;
  appliedThroughSeq: number;
  totalEvents: number;
  objectCount: number;
}

export interface RestoreStatus {
  jobId: string;
  state: string;
  snapshotKey: string | null;
  appliedThroughSeq: number;
  updatedAt: string | null;
}

export interface RestoreInput {
  target: { driverId: string; config: Record<string, string> };
  schoolId: string;
  phrase: string;
}

export const cloudBackupApi = {
  status: () => ApiClient.get<CloudBackupStatus>("/cloud-backup/status"),

  drivers: () => ApiClient.get<DriverDefinition[]>("/cloud-backup/drivers"),

  createTarget: (body: { driverId: string; name?: string; config: Record<string, string> }) =>
    ApiClient.post<{ id: string; name: string; driverId: string; enabled: boolean }>("/cloud-backup/targets", body),

  updateTarget: (id: string, body: { name?: string; config?: Record<string, string>; enabled?: boolean }) =>
    ApiClient.put(`/cloud-backup/targets/${id}`, body),

  deleteTarget: (id: string) => ApiClient.del(`/cloud-backup/targets/${id}`) as unknown as Promise<{ ok: boolean }>,

  testTarget: (id: string) => ApiClient.post<{ ok: boolean; latencyMs: number }>(`/cloud-backup/targets/${id}/test`, {}),

  generatePhrase: () => ApiClient.post<RecoveryPhrase>("/cloud-backup/setup/generate-phrase", {}),

  /** Prefill for the wizard, derived from the school's own name. */
  setupSuggestion: () =>
    ApiClient.get<{ schoolId: string; source: "existing" | "name" | "fallback" }>(
      "/cloud-backup/setup/suggestion",
    ),

  /**
   * `confirmReplaceExisting` is required by the backend to re-key an install
   * that is already configured: doing so makes every object already in the
   * cloud permanently unreadable. The wizard is hidden once `configured` is
   * true, so nothing sends it today — it exists so a deliberate re-key has a
   * way to say so explicitly rather than happening by accident.
   */
  step1: (body: { schoolId: string; phrase: string; confirmReplaceExisting?: boolean }) =>
    ApiClient.post<{ schoolId: string; instanceUuid: string }>("/cloud-backup/setup/step-1", body),

  verifySetup: () =>
    ApiClient.post<{ ok: boolean; drained: boolean; pending: number; targets: Array<{ id: string; ok: boolean; lastError: string | null }> }>(
      "/cloud-backup/setup/verify",
      {},
    ),

  finishSetup: (schoolId: string) => ApiClient.post<{ snapshotKey: string | null }>("/cloud-backup/setup/finish", { schoolId }),

  backupNow: () => ApiClient.post("/cloud-backup/backup/now", {}),

  // --- GDrive OAuth (loopback) ---

  /**
   * `clientId` / `clientSecret` are omitted in the normal case — the server
   * uses the OAuth client the app ships with, so the administrator only picks
   * a Google account. They are sent only by a self-hoster who registered
   * their own client.
   */
  gdriveOAuthUrl: (body: { clientId?: string; clientSecret?: string; redirectUri: string }) =>
    ApiClient.post<{ url: string; state: string }>("/cloud-backup/oauth/gdrive/url", body),

  /**
   * Same consent URL, from the login screen during a restore — there is no
   * session on new hardware. Allowed only while this install has no backup
   * configured.
   */
  restoreGdriveOAuthUrl: (body: { clientId?: string; clientSecret?: string; redirectUri: string }) =>
    ApiClient.post<{ url: string; state: string }>("/cloud-backup/restore/oauth/gdrive/url", body),

  /** Dropbox consent URL. The app supplies its own key/secret server-side. */
  dropboxOAuthUrl: (body: { appKey?: string; appSecret?: string; redirectUri: string }) =>
    ApiClient.post<{ url: string; state: string }>("/cloud-backup/oauth/dropbox/url", body),

  restoreDropboxOAuthUrl: (body: { appKey?: string; appSecret?: string; redirectUri: string }) =>
    ApiClient.post<{ url: string; state: string }>("/cloud-backup/restore/oauth/dropbox/url", body),

  /**
   * Manual code exchange for connecting from another computer on the LAN.
   * The administrator opens the consent URL on any device and pastes the
   * `code` here; the server exchanges it against the pending handshake, so
   * no secret crosses the browser.
   */
  oauthExchange: (body: { state: string; code: string }) =>
    ApiClient.post<{ ok: boolean; refreshToken: string }>("/cloud-backup/oauth/exchange", body),

  /** Same exchange from the login screen during a restore on new hardware. */
  restoreOAuthExchange: (body: { state: string; code: string }) =>
    ApiClient.post<{ ok: boolean; refreshToken: string }>("/cloud-backup/restore/oauth/exchange", body),

  /**
   * Fixed loopback redirect for the "other computer" flow.
   *
   * The popup flow uses the page's own origin (works sitting at the server),
   * but the copy-code link may be opened from any LAN machine — so it must
   * NOT echo that machine's address: Google Desktop clients only accept
   * loopback, and Dropbox only accepts pre-registered URIs. The target never
   * loads (the code is copied out of the address bar), so loopback is
   * correct everywhere. Publisher registers exactly these two per provider
   * (Dropbox needs them listed; Google Desktop allows any loopback port).
   */
  manualOAuthRedirectUri: (provider: "dropbox" | "gdrive") =>
    `http://127.0.0.1:3000/api/cloud-backup/oauth/${provider}/callback`,

  // --- Restore (public) ---

  restoreCheck: () => ApiClient.get<{ allowed: boolean }>("/cloud-backup/restore/check"),

  restoreStart: (body: RestoreInput) => ApiClient.post<RestorePlan>("/cloud-backup/restore/start", body),

  restoreStatus: (jobId: string) => ApiClient.get<RestoreStatus>(`/cloud-backup/restore/${jobId}`),

  restoreSnapshot: (jobId: string, body: Omit<RestoreInput, "target"> & { target: RestoreInput["target"] }) =>
    ApiClient.post<{ ok: boolean }>(`/cloud-backup/restore/${jobId}/snapshot`, body),

  restoreReplay: (jobId: string, body: Omit<RestoreInput, "target"> & { target: RestoreInput["target"] }) =>
    ApiClient.post<{ appliedThroughSeq: number; appliedCount: number }>(`/cloud-backup/restore/${jobId}/replay`, body),

  restoreFinish: (jobId: string, body: Omit<RestoreInput, "target"> & { target: RestoreInput["target"] }) =>
    ApiClient.post<{ instanceUuid: string; hostname: string }>(`/cloud-backup/restore/${jobId}/finish`, body),

  restoreCancel: (jobId: string) => ApiClient.post<{ ok: boolean }>(`/cloud-backup/restore/${jobId}/cancel`, {}),
};