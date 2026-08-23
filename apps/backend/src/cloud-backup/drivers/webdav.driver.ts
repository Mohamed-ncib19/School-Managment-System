import { Readable } from "node:stream";
import type { AuthType, FileStat, WebDAVClient } from "webdav";
import type {
  DriverOptions,
  ObjectMeta,
  PutOptions,
  PutResult,
  StorageDriver,
} from "./storage-driver";
import { withRetry, DEFAULT_DRIVER_OPTIONS } from "./storage-driver";

/**
 * WebDAV driver covering Nextcloud, ownCloud and generic WebDAV servers. The
 * `webdav` npm package is ESM-only; this app compiles to CommonJS, so the
 * module is loaded once per process with a dynamic import (supported on the
 * Node 20.9+ runtime this project targets).
 */

export interface WebDavConfig {
  baseUrl: string;
  username: string;
  password: string;
  /** Remote folder under which the `{school_id}/` namespace lives. */
  folder: string;
  /** Optional custom TLS CA bundle path (corporate proxies/self-signed). */
  caPath?: string;
}

let webdavModulePromise: Promise<typeof import("webdav")> | null = null;

async function loadWebdav(): Promise<typeof import("webdav")> {
  if (!webdavModulePromise) {
    webdavModulePromise = import("webdav");
  }
  return webdavModulePromise;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export class WebDavDriver implements StorageDriver {
  readonly id = "webdav" as const;
  readonly displayName = "WebDAV";

  private readonly config: WebDavConfig;
  private readonly options: DriverOptions;
  private clientPromise: Promise<WebDAVClient> | null = null;

  constructor(config: WebDavConfig, options: Partial<DriverOptions> = {}) {
    this.config = config;
    this.options = { ...DEFAULT_DRIVER_OPTIONS, ...options };
  }

  private async client(): Promise<WebDAVClient> {
    if (!this.clientPromise) {
      this.clientPromise = loadWebdav().then(async ({ createClient }) => {
        const options: Record<string, unknown> = {
          username: this.config.username,
          password: this.config.password,
          authType: "password" as AuthType,
        };
        if (this.config.caPath) {
          // A corporate proxy or a self-hosted Nextcloud with a private CA.
          // The CA is ADDED to the trust store; verification is never
          // disabled, which is what the error copy already promises. The
          // previous implementation passed an undefined agent, i.e. nothing.
          const { readFileSync } = await import("node:fs");
          const { Agent } = await import("node:https");
          options.httpsAgent = new Agent({ ca: readFileSync(this.config.caPath) });
        }
        return createClient(trimTrailingSlash(this.config.baseUrl), options as never);
      });
    }
    return this.clientPromise;
  }

  private path(key: string): string {
    // The namespace root lives under `folder`; keys already carry the
    // `{school_id}/` prefix.
    return `${trimTrailingSlash(this.config.folder)}/${key}`;
  }

  private async ensureFolders(client: WebDAVClient, key: string): Promise<void> {
    const parts = key.split("/");
    parts.pop(); // drop the file name
    let current = trimTrailingSlash(this.config.folder);
    for (const part of parts) {
      if (!part) continue;
      current += `/${part}`;
      try {
        if (!(await client.exists(current))) {
          await client.createDirectory(current, { recursive: false });
        }
      } catch {
        // Directory already exists or server created it implicitly — either
        // way the next request will reveal the truth.
      }
    }
  }

  private classify(err: unknown): Error {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : String(err);
    if (status === 401 || status === 403 || /unauthorized|forbidden|invalid credentials/i.test(message)) {
      return new Error("Authentification refusée — nom d'utilisateur ou mot de passe d'application invalide.");
    }
    if (status === 404 || /404/i.test(message)) {
      return new Error("Dossier introuvable (404) — vérifiez l'URL WebDAV et le chemin du dossier distant.");
    }
    if (status === 405 || status === 501 || /method not allowed|unsupported/i.test(message)) {
      return new Error("Le serveur ne prend pas en charge WebDAV — vérifiez que l'URL pointe vers le point WebDAV.");
    }
    if (/ENOTFOUND|getaddrinfo|DNS/i.test(message)) {
      return new Error("Échec de résolution DNS — l'URL du serveur WebDAV est introuvable.");
    }
    if (/ENETUNREACH|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) {
      return new Error("Serveur injoignable — vérifiez la connexion réseau et l'URL.");
    }
    if (/self.signed|certificate/i.test(message)) {
      return new Error("Certificat TLS invalide — la vérification du certificat ne peut pas être désactivée.");
    }
    return new Error(message);
  }

  async testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }> {
    const client = await this.client();
    const probe = Buffer.from(`iq-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const key = `__iq_probe__/${probe.toString("base64url").slice(0, 40)}.bin`;
    const started = Date.now();
    try {
      await withRetry(async () => {
        await this.ensureFolders(client, key);
        await client.putFileContents(this.path(key), probe, { contentLength: probe.length, overwrite: true });
        const read = await client.getFileContents(this.path(key), { format: "binary" });
        const buffer = Buffer.isBuffer(read) ? read : Buffer.from(read as ArrayBuffer);
        if (Buffer.compare(buffer, probe) !== 0) {
          throw new Error("Le contenu lu ne correspond pas au contenu écrit (round-trip mismatch).");
        }
      }, this.options);
      return { ok: true, latencyMs: Date.now() - started, probe: key };
    } catch (err) {
      throw this.classify(err);
    }
  }

  async put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult> {
    const client = await this.client();
    try {
      await withRetry(async () => {
        await this.ensureFolders(client, key);
        await client.putFileContents(this.path(key), stream, {
          contentLength: sizeHint ?? false,
          // Hard-coded `false` meant the instance registry — the one mutable
          // object in the namespace — could never be rewritten after its
          // first claim, silently disabling split-brain detection on WebDAV.
          overwrite: opts?.overwrite ?? false,
        });
      }, this.options);
      return { key, size: sizeHint ?? 0 };
    } catch (err) {
      throw this.classify(err);
    }
  }

  async get(key: string): Promise<Readable> {
    const client = await this.client();
    try {
      const readStream = await withRetry(async () => {
        const stream = client.createReadStream(this.path(key));
        // Surface async creation errors (404, auth) as a rejected promise
        // rather than an unhandled stream error.
        await new Promise<void>((resolve, reject) => {
          stream.once("readable", () => resolve());
          stream.once("error", reject);
        });
        return stream;
      }, this.options);
      return readStream;
    } catch (err) {
      throw this.classify(err);
    }
  }

  async list(prefix: string): Promise<ObjectMeta[]> {
    const client = await this.client();
    try {
      const items: ObjectMeta[] = [];
      await withRetry(async () => {
        const contents = await this.walk(client, this.path(prefix));
        for (const item of contents) {
          if (item.type === "file") {
            items.push({
              key: this.stripPrefix(item.filename),
              size: item.size ?? 0,
              lastModified: item.lastmod || null,
            });
          }
        }
      }, this.options);
      return items;
    } catch (err) {
      throw this.classify(err);
    }
  }

  private async walk(client: WebDAVClient, dir: string): Promise<FileStat[]> {
    const out: FileStat[] = [];
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = await client.getDirectoryContents(current);
      for (const child of children) {
        if (child.type === "directory") stack.push(child.filename);
        else out.push(child);
      }
    }
    return out;
  }

  private stripPrefix(fullPath: string): string {
    const base = this.path("");
    if (fullPath.startsWith(base)) {
      return fullPath.slice(base.length).replace(/^\/+/, "");
    }
    return fullPath;
  }
}