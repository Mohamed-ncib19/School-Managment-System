import { Readable } from "node:stream";
import type { ObjectMeta, PutOptions, PutResult, StorageDriver } from "./storage-driver";
import { withRetry, DEFAULT_DRIVER_OPTIONS, DriverOptions } from "./storage-driver";

/**
 * Dropbox — the fewest clicks a school can spend on an off-site backup.
 *
 * Chosen over the alternatives on the one axis that matters here: what the
 * administrator has to do. Backblaze means creating an account, a bucket, an
 * application key and finding a region — four screens on someone else's site.
 * Google means the operator wrestling the Cloud Console and a consent screen
 * before anyone can click anything. Dropbox's app registration is a single
 * form (name, "Scoped access", "App folder"), takes about two minutes, needs
 * no review, and then the school's entire job is: click, approve, done.
 *
 * `App folder` access is deliberate. The app can only ever see its own
 * directory — it cannot read the user's documents even in principle — which
 * makes the consent screen honest and the blast radius nil.
 *
 * No SDK: the four calls this needs are plain HTTPS, and Node 20 has fetch.
 * Adding a dependency to POST four URLs would be the expensive way to do it.
 */

const OAUTH_TOKEN_URL = "https://api.dropbox.com/oauth2/token";
const RPC_BASE = "https://api.dropboxapi.com/2";
const CONTENT_BASE = "https://content.dropboxapi.com/2";

/** Dropbox rejects a single-shot upload above 150 MB; stay clear of the edge. */
const SINGLE_SHOT_LIMIT = 140 * 1024 * 1024;
/** Chunk size for the session upload path. */
const CHUNK_BYTES = 8 * 1024 * 1024;
/** Refresh a little early rather than racing the expiry. */
const TOKEN_SKEW_MS = 60_000;

export interface DropboxConfig {
  /** Long-lived refresh token from the OAuth handshake. */
  refreshToken: string;
  /** The app's own credentials; supplied by the server, not the school. */
  appKey?: string;
  appSecret?: string;
}

interface DropboxError {
  error_summary?: string;
  error?: { [".tag"]?: string };
}

export class DropboxDriver implements StorageDriver {
  readonly id = "dropbox" as const;
  readonly displayName = "Dropbox";

  private readonly config: DropboxConfig;
  private readonly options: DriverOptions;

  private accessToken: string | null = null;
  private expiresAt = 0;
  /** In-flight refresh, so concurrent calls wait on one request. */
  private refreshing: Promise<string> | null = null;

  constructor(config: DropboxConfig, options: Partial<DriverOptions> = {}) {
    this.config = config;
    this.options = { ...DEFAULT_DRIVER_OPTIONS, ...options };
  }

  /** App-folder paths are relative to the app's own directory. */
  private path(key: string): string {
    const clean = key.replace(/^\/+/, "");
    if (clean.includes("..")) throw new Error(`Clé d'objet invalide : ${key}`);
    return `/${clean}`;
  }

  private classify(err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid_grant|invalid_access_token|expired_access_token/i.test(message)) {
      return new Error(
        "Autorisation Dropbox expirée ou révoquée — reconnectez le compte dans Paramètres → Sécurité des données.",
      );
    }
    if (/insufficient_space|no_write_permission/i.test(message)) {
      return new Error("Espace Dropbox insuffisant — libérez de la place ou passez à une offre supérieure.");
    }
    if (/path\/not_found|not_found/i.test(message)) {
      return new Error("Fichier introuvable dans Dropbox.");
    }
    if (/too_many_requests|rate.?limit/i.test(message)) {
      return new Error("Dropbox limite temporairement les requêtes — la sauvegarde reprendra automatiquement.");
    }
    if (/ENOTFOUND|getaddrinfo|DNS/i.test(message)) {
      return new Error("Échec de résolution DNS — Dropbox est injoignable.");
    }
    if (/ENETUNREACH|ECONNREFUSED|ETIMEDOUT|timeout|fetch failed/i.test(message)) {
      return new Error("Dropbox injoignable — vérifiez la connexion réseau.");
    }
    return new Error(message);
  }

  /**
   * A valid access token, refreshed from the long-lived refresh token.
   *
   * Dropbox access tokens last four hours; the worker runs for months, so
   * every call goes through here. Concurrent callers share one refresh rather
   * than each firing their own.
   */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - TOKEN_SKEW_MS) return this.accessToken;
    if (this.refreshing) return this.refreshing;

    const { appKey, appSecret, refreshToken } = this.config;
    if (!appKey || !appSecret) {
      throw new Error(
        "Aucune application Dropbox n'est configurée sur ce serveur (DROPBOX_APP_KEY / DROPBOX_APP_SECRET).",
      );
    }

    this.refreshing = (async () => {
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
      const auth = Buffer.from(`${appKey}:${appSecret}`).toString("base64");
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Dropbox token refresh failed (${res.status}): ${text}`);
      const parsed = JSON.parse(text) as { access_token: string; expires_in: number };
      this.accessToken = parsed.access_token;
      this.expiresAt = Date.now() + parsed.expires_in * 1000;
      return this.accessToken;
    })().finally(() => {
      this.refreshing = null;
    });

    return this.refreshing;
  }

  /** JSON-in, JSON-out endpoint. */
  private async rpc<T>(endpoint: string, payload: unknown): Promise<T> {
    const token = await this.token();
    const res = await fetch(`${RPC_BASE}${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Dropbox ${endpoint} (${res.status}): ${describe(text)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Binary-body endpoint; arguments ride in a header. */
  private async content(endpoint: string, arg: unknown, body?: Buffer): Promise<Response> {
    const token = await this.token();
    const res = await fetch(`${CONTENT_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        // Dropbox requires this header to be ASCII-safe JSON.
        "Dropbox-API-Arg": asciiJson(arg),
        "Content-Type": "application/octet-stream",
      },
      body,
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dropbox ${endpoint} (${res.status}): ${describe(text)}`);
    }
    return res;
  }

  async testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }> {
    const started = Date.now();
    const probe = Buffer.from(`iq-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const key = `__iq_probe__/${probe.toString("base64url").slice(0, 40)}.bin`;
    try {
      await withRetry(async () => {
        await this.content("/files/upload", { path: this.path(key), mode: "overwrite", mute: true }, probe);
        const res = await this.content("/files/download", { path: this.path(key) });
        const read = Buffer.from(await res.arrayBuffer());
        if (Buffer.compare(read, probe) !== 0) {
          throw new Error("Le contenu lu ne correspond pas au contenu écrit (round-trip mismatch).");
        }
        // Local litter is worth removing; backup objects never are.
        await this.rpc("/files/delete_v2", { path: this.path(key) }).catch(() => undefined);
      }, this.options);
      return { ok: true, latencyMs: Date.now() - started, probe: key };
    } catch (err) {
      throw this.classify(err);
    }
  }

  async put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult> {
    const path = this.path(key);
    const mode = opts?.overwrite ? "overwrite" : "add";
    try {
      // Buffer only when the object is small enough for a single request;
      // anything larger streams through an upload session so a big snapshot
      // never has to sit in memory whole.
      if (sizeHint !== undefined && sizeHint <= SINGLE_SHOT_LIMIT) {
        const body = await collect(stream);
        await withRetry(
          () => this.content("/files/upload", { path, mode, mute: true, autorename: false }, body),
          this.options,
        );
        return { key, size: body.length };
      }
      const size = await this.uploadSession(path, stream, mode);
      return { key, size };
    } catch (err) {
      throw this.classify(err);
    }
  }

  /**
   * Chunked upload for objects above the single-shot limit.
   *
   * Deliberately not wrapped in withRetry: a session is stateful, so a retry
   * would have to restart it from the beginning with a fresh stream. The
   * caller re-opens the object and tries again on the next drain cycle.
   */
  private async uploadSession(path: string, stream: Readable, mode: string): Promise<number> {
    let offset = 0;
    let sessionId: string | null = null;
    let pending = Buffer.alloc(0);

    const flush = async (chunk: Buffer, last: boolean): Promise<void> => {
      if (sessionId === null) {
        const started = await this.content("/files/upload_session/start", { close: false }, chunk);
        sessionId = ((await started.json()) as { session_id: string }).session_id;
        offset += chunk.length;
        return;
      }
      if (last) {
        await this.content(
          "/files/upload_session/finish",
          {
            cursor: { session_id: sessionId, offset },
            commit: { path, mode, mute: true, autorename: false },
          },
          chunk,
        );
        offset += chunk.length;
        return;
      }
      await this.content(
        "/files/upload_session/append_v2",
        { cursor: { session_id: sessionId, offset }, close: false },
        chunk,
      );
      offset += chunk.length;
    };

    for await (const piece of stream) {
      pending = Buffer.concat([pending, Buffer.isBuffer(piece) ? piece : Buffer.from(piece as Uint8Array)]);
      while (pending.length >= CHUNK_BYTES) {
        await flush(pending.subarray(0, CHUNK_BYTES), false);
        pending = pending.subarray(CHUNK_BYTES);
      }
    }
    // The final call must be `finish`, even when the tail is empty.
    if (sessionId === null) await flush(pending, false);
    await flush(pending.length > 0 || offset === 0 ? pending : Buffer.alloc(0), true);
    return offset;
  }

  async get(key: string): Promise<Readable> {
    try {
      const res = await withRetry(() => this.content("/files/download", { path: this.path(key) }), this.options);
      if (!res.body) throw new Error("Réponse vide de Dropbox.");
      return Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
    } catch (err) {
      throw this.classify(err);
    }
  }

  async list(prefix: string): Promise<ObjectMeta[]> {
    const items: ObjectMeta[] = [];
    // Dropbox lists a folder, not a prefix. List the deepest folder the
    // prefix names, recursively, then filter — the same shape the folder
    // driver uses.
    const folder = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
    const root = folder ? this.path(folder) : "";

    try {
      let res = await withRetry(
        () =>
          this.rpc<ListFolderResult>("/files/list_folder", {
            path: root,
            recursive: true,
            limit: 2000,
          }),
        this.options,
      );
      for (;;) {
        for (const entry of res.entries) {
          if (entry[".tag"] !== "file") continue;
          const key = entry.path_display.replace(/^\//, "");
          if (!key.startsWith(prefix)) continue;
          items.push({
            key,
            size: entry.size ?? 0,
            lastModified: entry.server_modified ?? null,
          });
        }
        if (!res.has_more) break;
        res = await this.rpc<ListFolderResult>("/files/list_folder/continue", { cursor: res.cursor });
      }
      return items;
    } catch (err) {
      // An absent folder is an empty listing, not a fault.
      if (/not_found/i.test(err instanceof Error ? err.message : "")) return [];
      throw this.classify(err);
    }
  }
}

interface ListFolderResult {
  entries: Array<{ [".tag"]: string; path_display: string; size?: number; server_modified?: string }>;
  cursor: string;
  has_more: boolean;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Dropbox-API-Arg must be ASCII. Object keys are ASCII today, but a header
 * that silently corrupts on one accented character is the kind of thing that
 * surfaces as an unexplained upload failure a year from now.
 */
function asciiJson(value: unknown): string {
  const json = JSON.stringify(value);
  let out = "";
  for (const ch of json) {
    const code = ch.codePointAt(0) ?? 0;
    // A code-point scan rather than a regex range: a character class holding
    // literal high characters is invisible in a diff and gets silently
    // mangled by editors and encoding conversions.
    out += code < 0x20 || code > 0x7e ? "\\u" + code.toString(16).padStart(4, "0") : ch;
  }
  return out;
}


/** Dropbox errors arrive as JSON with a human-ish summary; prefer it. */
function describe(body: string): string {
  try {
    const parsed = JSON.parse(body) as DropboxError;
    return parsed.error_summary ?? body;
  } catch {
    return body;
  }
}
