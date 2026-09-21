import { Readable } from "node:stream";
import type { drive_v3, Auth } from "googleapis";
import type {
  DriverOptions,
  ObjectMeta,
  PutOptions,
  PutResult,
  StorageDriver,
} from "./storage-driver";
import { withRetry, DEFAULT_DRIVER_OPTIONS } from "./storage-driver";

/**
 * Google Drive driver.
 *
 * Uses the OAuth2 authorization-code flow with a locally-stored refresh token
 * (the standard desktop-app flow). The admin creates a Desktop OAuth client in
 * the Google Cloud Console, then the setup wizard: 1) starts a temporary
 * loopback server on 127.0.0.1, 2) opens the consent URL, 3) captures the
 * redirect, exchanges the code and stores the refresh token in the credential
 * store. Uploads go to a dedicated folder per school; the object key maps to
 * the file name with '/' replaced by '|' so listing stays prefix-queryable.
 */

export interface GDriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /**
   * School-scoped folder id. Resolved from the object key on first use and
   * cached; there is deliberately no `schoolId` field, because during setup
   * the destination is configured before the school id exists.
   */
  rootFolderId?: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const BACKUP_FOLDER_PREFIX = "iq-academy-backup-";

/**
 * Lazy googleapis loader.
 *
 * `googleapis` bundles every Google API surface and costs ~1.5 s to require.
 * A static import made every backend boot — and every test that touches the
 * driver registry — pay that, on installs that will never configure a Drive
 * target. Types are still imported statically; only the runtime module is
 * deferred to the first Drive call.
 */
let googleapisPromise: Promise<typeof import("googleapis")> | null = null;

async function loadGoogleapis(): Promise<typeof import("googleapis")> {
  if (!googleapisPromise) googleapisPromise = import("googleapis");
  return googleapisPromise;
}

async function driveClient(auth: Auth.OAuth2Client): Promise<drive_v3.Drive> {
  const { google } = await loadGoogleapis();
  return google.drive({ version: "v3", auth });
}

export async function buildOAuthClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<Auth.OAuth2Client> {
  const { google } = await loadGoogleapis();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export class GDriveDriver implements StorageDriver {
  readonly id = "gdrive" as const;
  readonly displayName = "Google Drive";

  private readonly config: GDriveConfig;
  private readonly options: DriverOptions;

  constructor(config: GDriveConfig, options: Partial<DriverOptions> = {}) {
    this.config = config;
    this.options = { ...DEFAULT_DRIVER_OPTIONS, ...options };
  }

  private async auth(): Promise<Auth.OAuth2Client> {
    const { google } = await loadGoogleapis();
    const auth = new google.auth.OAuth2(this.config.clientId, this.config.clientSecret);
    auth.setCredentials({ refresh_token: this.config.refreshToken });
    return auth;
  }

  private classify(err: unknown): Error {
    const e = err as { response?: { status?: number }; message?: string; errors?: Array<{ reason?: string }> };
    const status = e.response?.status;
    const reason = e.errors?.[0]?.reason ?? "";
    const message = e.message ?? String(err);
    if (status === 401 || reason === "authError" || /invalid_grant|invalid_grant/i.test(message)) {
      return new Error(
        "Authentification Google refusée — le jeton d'actualisation est invalide ou révoqué. Reconnectez le compte dans Paramètres.",
      );
    }
    if (status === 403 || reason === "rateLimitExceeded" || /quota/i.test(message)) {
      return new Error("Limite Google Drive atteinte (403/quota) — réessayez plus tard.");
    }
    if (status === 404 || /file not found|notFound/i.test(message)) {
      return new Error("Fichier ou dossier Google Drive introuvable (404).");
    }
    if (/ENOTFOUND|getaddrinfo|DNS/i.test(message)) {
      return new Error("Échec de résolution DNS — Google est injoignable.");
    }
    if (/ENETUNREACH|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) {
      return new Error("Serveur Google injoignable — vérifiez la connexion réseau.");
    }
    if (/certificate|self.signed/i.test(message)) {
      return new Error("Certificat TLS invalide — la vérification du certificat ne peut pas être désactivée.");
    }
    return new Error(message);
  }

  /** Name used on Drive for a fully-qualified object key. */
  private fileName(key: string): string {
    return key.replace(/\//g, "|");
  }

  /** Reverses fileName(): key prefix with '/' restored. */
  private fileNameToKey(name: string): string {
    return name.replace(/\|/g, "/");
  }

  private resolvedFolderId: string | null = null;

  private async rootFolder(auth: Auth.OAuth2Client, schoolId: string): Promise<string> {
    if (this.config.rootFolderId) return this.config.rootFolderId;
    // Cached: every put/get/list used to spend an extra files.list call
    // resolving the same folder.
    if (this.resolvedFolderId) return this.resolvedFolderId;
    const drive = await driveClient(auth);
    const folderName = `${BACKUP_FOLDER_PREFIX}${schoolId}`;
    const res = await drive.files.list({
      q: `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: "files(id, name)",
      pageSize: 1,
    });
    this.resolvedFolderId =
      res.data.files?.[0]?.id ??
      (
        await drive.files.create({
          requestBody: { name: folderName, mimeType: FOLDER_MIME },
          fields: "id",
        })
      ).data.id!;
    return this.resolvedFolderId;
  }

  async testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }> {
    const auth = await this.auth();
    const probe = Buffer.from(`iq-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const key = `__iq_probe__/${probe.toString("base64url").slice(0, 40)}.bin`;
    const started = Date.now();
    try {
      await withRetry(async () => {
        const drive = await driveClient(auth);
        // No parent folder, and nothing left behind.
        //
        // The test runs during setup, BEFORE the school id exists — the
        // wizard asks for a destination first — so it cannot probe the
        // school's own folder without inventing a name. It used to invent
        // "__probe__", creating a junk folder and validating a location no
        // backup would ever use. What actually needs proving here is
        // "these credentials can write to, read from and delete on Drive";
        // the real folder is created on the first upload, from the object
        // key. The `drive.file` scope means this file is invisible to
        // everything but this app, and it is removed immediately.
        const created = await drive.files.create({
          requestBody: { name: this.fileName(key) },
          media: { body: probe, mimeType: "application/octet-stream" },
          fields: "id",
        });
        const fileId = created.data.id!;
        const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
        const chunks: Buffer[] = [];
        for await (const chunk of res.data as unknown as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk));
        }
        const read = Buffer.concat(chunks);
        if (Buffer.compare(read, probe) !== 0) {
          throw new Error("Le contenu lu ne correspond pas au contenu écrit (round-trip mismatch).");
        }
        // Probe objects are the one thing worth removing: the namespace is
        // append-only for BACKUP data, not for connectivity litter.
        await drive.files.delete({ fileId }).catch(() => undefined);
      }, this.options);
      return { ok: true, latencyMs: Date.now() - started, probe: key };
    } catch (err) {
      throw this.classify(err);
    }
  }

  async put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult> {
    const auth = await this.auth();
    try {
      await withRetry(async () => {
        const drive = await driveClient(auth);
        const folderId = await this.rootFolder(auth, key.split("/")[0]);
        const name = this.fileName(key);
        if (opts?.overwrite) {
          // Drive happily stores two files with the same name, so a mutable
          // object (the instance registry) must replace the existing file
          // rather than adding a second one a later read might miss.
          const existing = await drive.files.list({
            q: `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
            fields: "files(id)",
            pageSize: 1,
          });
          const id = existing.data.files?.[0]?.id;
          if (id) {
            await drive.files.update({
              fileId: id,
              media: { body: stream, mimeType: "application/octet-stream" },
            });
            return;
          }
        }
        // Backup objects are unique and immutable; a name collision would mean
        // the object key was reused, which must never happen.
        await drive.files.create({
          requestBody: { name, parents: [folderId] },
          media: { body: stream, mimeType: "application/octet-stream" },
          fields: "id",
        });
      }, this.options);
      return { key, size: sizeHint ?? 0 };
    } catch (err) {
      throw this.classify(err);
    }
  }

  async get(key: string): Promise<Readable> {
    const auth = await this.auth();
    try {
      const stream = await withRetry(async () => {
        const drive = await driveClient(auth);
        const folderId = await this.rootFolder(auth, key.split("/")[0]);
        const res = await drive.files.list({
          q: `name = '${this.fileName(key).replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
          fields: "files(id, name)",
          pageSize: 1,
        });
        const file = res.data.files?.[0];
        if (!file?.id) throw new Error("Fichier introuvable dans Google Drive.");
        const dl = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "stream" });
        return dl.data as unknown as Readable;
      }, this.options);
      return stream;
    } catch (err) {
      throw this.classify(err);
    }
  }

  async list(prefix: string): Promise<ObjectMeta[]> {
    const auth = await this.auth();
    const items: ObjectMeta[] = [];
    try {
      await withRetry(async () => {
        const drive = await driveClient(auth);
        const folderId = await this.rootFolder(auth, prefix.split("/")[0]);
        let pageToken: string | undefined;
        const encodedPrefix = this.fileName(prefix);
        do {
          const res = await drive.files.list({
            q: `name contains '${encodedPrefix.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, size, modifiedTime)",
            pageSize: 1000,
            pageToken,
            orderBy: "createdTime",
          });
          for (const file of res.data.files ?? []) {
            items.push({
              key: this.fileNameToKey(file.name ?? ""),
              size: Number(file.size ?? 0),
              lastModified: file.modifiedTime ?? null,
            });
          }
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      }, this.options);
      return items;
    } catch (err) {
      throw this.classify(err);
    }
  }

  /**
   * Privileged single-object removal for the legacy-format purge only.
   * Never called by sync, snapshot or restore paths.
   */
  async remove(key: string): Promise<void> {
    const auth = await this.auth();
    try {
      await withRetry(async () => {
        const drive = await driveClient(auth);
        const folderId = await this.rootFolder(auth, key.split("/")[0]);
        const res = await drive.files.list({
          q: `name = '${this.fileName(key).replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
          fields: "files(id)",
          pageSize: 1,
        });
        const fileId = res.data.files?.[0]?.id;
        if (!fileId) throw new Error("Fichier introuvable dans Google Drive.");
        await drive.files.delete({ fileId });
      }, this.options);
    } catch (err) {
      throw this.classify(err);
    }
  }
}