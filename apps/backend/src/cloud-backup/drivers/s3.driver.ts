import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type {
  DriverOptions,
  ObjectMeta,
  PutOptions,
  PutResult,
  StorageDriver,
} from "./storage-driver";
import { withRetry, DEFAULT_DRIVER_OPTIONS } from "./storage-driver";

/**
 * S3-compatible driver covering Cloudflare R2, Backblaze B2, Wasabi, MinIO
 * and AWS S3 itself. The endpoint is always user-supplied — AWS is never
 * hard-coded. Supports both path-style (MinIO, most self-hosted gateways) and
 * virtual-host-style addressing.
 */

export type S3Addressing = "path" | "virtual";

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  addressing: S3Addressing;
  /** Optional session token for providers that use temporary credentials. */
  sessionToken?: string;
}

const PROBE_PREFIX = "__iq_probe__";

export class S3Driver implements StorageDriver {
  readonly id = "s3" as const;
  readonly displayName = "S3 compatible";

  private readonly config: S3Config;
  private readonly options: DriverOptions;

  constructor(config: S3Config, options: Partial<DriverOptions> = {}) {
    this.config = config;
    this.options = { ...DEFAULT_DRIVER_OPTIONS, ...options };
  }

  private cachedClient: S3Client | null = null;

  private client(): S3Client {
    // One client per driver instance. Constructing one per call leaked a
    // connection pool and its sockets on every drain cycle — roughly 1,400 a
    // day at the default interval.
    if (this.cachedClient) return this.cachedClient;
    this.cachedClient = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region || "us-east-1",
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
        sessionToken: this.config.sessionToken,
      },
      forcePathStyle: this.config.addressing === "path",
      requestHandler: {
        connectionTimeout: this.options.timeoutMs,
        socketTimeout: this.options.timeoutMs,
      } as never,
    });
    return this.cachedClient;
  }

  /** Releases the underlying sockets. Safe to call more than once. */
  destroy(): void {
    this.cachedClient?.destroy();
    this.cachedClient = null;
  }

  private classify(err: unknown): Error {
    const name = (err as { name?: string })?.name ?? "";
    const code = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 404 || name === "NoSuchBucket") {
      return new Error(`Bucket or object not found (HTTP 404) — vérifiez le nom du bucket et que le compte y a accès.`);
    }
    if (name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch" || code === 403) {
      return new Error(
        "Authentification refusée (403) — clés d'accès invalides ou permissions insuffisantes sur le bucket.",
      );
    }
    if (name === "RequestTimeTooSkewed" || /clock skew/i.test(message)) {
      return new Error("Horloge du serveur décalée (clock skew) — l'horloge de ce poste doit être réglée à l'heure.");
    }
    if (name === "UnknownEndpoint" || name === "ENOTFOUND" || /ENOTFOUND|DNS|getaddrinfo/i.test(message)) {
      return new Error("Échec de résolution DNS — l'URL du endpoint est introuvable.");
    }
    if (/ENETUNREACH|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) {
      return new Error("Serveur injoignable — vérifiez le endpoint et la connexion réseau.");
    }
    return new Error(message);
  }

  async testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }> {
    const probe = Buffer.from(`iq-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const key = `${PROBE_PREFIX}/${probe.toString("base64url").slice(0, 40)}.bin`;
    const started = Date.now();
    try {
      await withRetry(
        async () => {
          await this.client().send(
            new PutObjectCommand({
              Bucket: this.config.bucket,
              Key: key,
              Body: probe,
              ContentLength: probe.length,
            }),
          );
          const got = await this.client().send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
          const bytes = await got.Body?.transformToByteArray();
          if (!bytes || Buffer.compare(Buffer.from(bytes), probe) !== 0) {
            throw new Error("Le contenu lu ne correspond pas au contenu écrit (round-trip mismatch).");
          }
          // Probe objects are the one thing worth removing: the namespace is
          // append-only for BACKUP data, not for connectivity litter.
          await this.client().send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key })).catch(() => undefined);
        },
        this.options,
      );
      return { ok: true, latencyMs: Date.now() - started, probe: key };
    } catch (err) {
      throw this.classify(err);
    }
  }

  async put(key: string, stream: Readable, sizeHint?: number, _opts?: PutOptions): Promise<PutResult> {
    try {
      await withRetry(async () => {
        await this.client().send(
          new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: key,
            Body: stream,
            ContentLength: sizeHint,
          }),
        );
      }, this.options);
      return { key, size: sizeHint ?? 0 };
    } catch (err) {
      throw this.classify(err);
    }
  }

  async get(key: string): Promise<Readable> {
    try {
      const response = await withRetry(async () => {
        const res = await this.client().send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
        const body = res.Body;
        if (!body) throw new Error("Réponse vide du serveur.");
        if (typeof (body as any).transformToWebStream === "function") {
          return Readable.fromWeb((body as any).transformToWebStream() as import("node:stream/web").ReadableStream);
        }
        return Readable.from(body as any);
      }, this.options);
      return response;
    } catch (err) {
      throw this.classify(err);
    }
  }

  async list(prefix: string): Promise<ObjectMeta[]> {
    const items: ObjectMeta[] = [];
    try {
      await withRetry(async () => {
        let token: string | undefined;
        do {
          const res = await this.client().send(
            new ListObjectsV2Command({
              Bucket: this.config.bucket,
              Prefix: prefix,
              ContinuationToken: token,
            }),
          );
          for (const obj of res.Contents ?? []) {
            items.push({
              key: obj.Key!,
              size: obj.Size ?? 0,
              lastModified: obj.LastModified?.toISOString() ?? null,
            });
          }
          token = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (token);
      }, this.options);
      return items;
    } catch (err) {
      throw this.classify(err);
    }
  }

  async head(key: string): Promise<{ size: number; lastModified: string }> {
    try {
      const res = await withRetry(
        () => this.client().send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key })),
        this.options,
      );
      return {
        size: res.ContentLength ?? 0,
        lastModified: res.LastModified?.toISOString() ?? "",
      };
    } catch (err) {
      throw this.classify(err);
    }
  }

  /**
   * Privileged single-object removal for the legacy-format purge only.
   * Never called by sync, snapshot or restore paths.
   */
  async remove(key: string): Promise<void> {
    try {
      await withRetry(
        () => this.client().send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key })),
        this.options,
      );
    } catch (err) {
      throw this.classify(err);
    }
  }
}