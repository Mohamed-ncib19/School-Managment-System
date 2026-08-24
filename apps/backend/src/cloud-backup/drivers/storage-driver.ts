import type { Readable } from "node:stream";
import { isRetryable } from "./retry-policy";

/**
 * The one interface every storage backend implements. Business logic knows
 * nothing about buckets, PROPFIND or OAuth — it only ever talks to this.
 *
 * There is deliberately NO delete() here. The cloud copy is append-only by
 * design: object keys are immutable and unique, nothing is ever overwritten,
 * and a local record deletion becomes an event describing what happened — it
 * never removes a cloud object. Retention pruning, if it is ever added, must
 * be a separate privileged path with its own credentials, never reachable
 * from the running instance.
 *
 * Adding a fourth driver (FTP, SFTP, Backblaze-native, …) must require zero
 * changes outside its own file plus one entry in the driver registry.
 */

export interface ObjectMeta {
  key: string;
  size: number;
  /** Last modified ISO string if the provider reports it, else null. */
  lastModified: string | null;
}

export interface PutResult {
  key: string;
  size: number;
}

/**
 * `s3:<preset>` ids are the same S3 driver with the endpoint, region and
 * addressing style supplied by the app instead of by the administrator.
 */
export type DriverId = "folder" | "dropbox" | "s3" | "webdav" | "gdrive" | `s3:${string}`;

export interface PutOptions {
  /**
   * Backup objects are immutable and unique, so the default is false — a
   * collision means a key was reused, which must fail loudly. The instance
   * registry is the one mutable object in the namespace and passes true.
   */
  overwrite?: boolean;
}

export interface StorageDriver {
  readonly id: DriverId;
  readonly displayName: string;

  /**
   * Round-trip connectivity check. Must perform a real write+read+compare of
   * a small probe object and fail with a precise, actionable error:
   * bad credentials / bucket or folder not found / DNS failure / clock skew /
   * permission denied. Never a generic "failed".
   */
  testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }>;

  /** Streams `stream` to `key`. Callers pass an exact Content-Length via sizeHint. */
  put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult>;

  /** Returns a stream for the object at `key`. */
  get(key: string): Promise<Readable>;

  /** Lists object metadata under a key prefix. */
  list(prefix: string): Promise<ObjectMeta[]>;
}

/** Every driver call is bounded by these and retried with exponential backoff
 * plus jitter. */
export interface DriverOptions {
  timeoutMs: number;
  maxRetries: number;
  /** Base delay in ms for the first retry. */
  backoffBaseMs: number;
  /** Cap on the backoff delay in ms. */
  backoffMaxMs: number;
}

export const DEFAULT_DRIVER_OPTIONS: DriverOptions = {
  timeoutMs: 30_000,
  maxRetries: 4,
  backoffBaseMs: 1_000,
  backoffMaxMs: 30_000,
};

/** Sleep with full jitter — the standard way to keep a herd of retrying
 * clients from re-synchronising on the same delay. */
export function sleepWithJitter(baseMs: number, maxMs: number): Promise<void> {
  const cap = Math.min(baseMs, maxMs);
  const delay = Math.random() * cap;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** Wraps a driver call in a timeout + bounded retry loop with full jitter. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: Partial<DriverOptions> = {},
): Promise<T> {
  const o = { ...DEFAULT_DRIVER_OPTIONS, ...opts };
  let attempt = 0;
  let backoff = o.backoffBaseMs;
  for (;;) {
    try {
      return await withTimeout(fn(), o.timeoutMs);
    } catch (err) {
      // A permanent failure will fail identically four more times; surfacing
      // it now is what lets the setup wizard say "bad key" instead of hanging
      // for two and a half minutes on a typo.
      if (!isRetryable(err)) throw err;
      attempt++;
      if (attempt > o.maxRetries) throw err;
      await sleepWithJitter(backoff, o.backoffMaxMs);
      backoff = Math.min(backoff * 2, o.backoffMaxMs);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs} ms`)), timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}