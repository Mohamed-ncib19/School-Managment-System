import { Readable } from "node:stream";
import type { ObjectMeta, PutOptions, PutResult, StorageDriver } from "../../drivers/storage-driver";

/**
 * In-memory StorageDriver for tests.
 *
 * Records the full body of every put so a test can assert what actually
 * landed — which is the only way to catch a consumed-stream bug, since an
 * exhausted stream uploads successfully, just empty.
 */
export class MemoryDriver implements StorageDriver {
  readonly id = "s3" as const;
  readonly displayName = "Memory";

  readonly puts = new Map<string, Buffer>();
  readonly putCount = new Map<string, number>();
  private failures = 0;

  /** Make the next `n` put attempts throw, to exercise the retry path. */
  failNextPuts(n: number): void {
    this.failures = n;
  }

  async testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }> {
    return { ok: true, latencyMs: 1, probe: "memory" };
  }

  async put(key: string, stream: Readable, sizeHint?: number, _opts?: PutOptions): Promise<PutResult> {
    this.putCount.set(key, (this.putCount.get(key) ?? 0) + 1);
    if (this.failures > 0) {
      this.failures--;
      throw new Error("simulated transient upload failure: ETIMEDOUT");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const body = Buffer.concat(chunks);
    this.puts.set(key, body);
    if (sizeHint !== undefined && body.length !== sizeHint) {
      throw new Error(`Content-Length mismatch: declared ${sizeHint}, streamed ${body.length}`);
    }
    return { key, size: body.length };
  }

  async get(key: string): Promise<Readable> {
    const body = this.puts.get(key);
    if (!body) throw new Error(`No such object: ${key}`);
    return Readable.from([body]);
  }

  async list(prefix: string): Promise<ObjectMeta[]> {
    return [...this.puts.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, body]) => ({ key, size: body.length, lastModified: null }));
  }
}
