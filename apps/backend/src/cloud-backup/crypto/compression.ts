import { deflateSync, inflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { Transform, TransformCallback } from "node:stream";
import { createHash } from "node:crypto";

/**
 * Compression before encryption — never the reverse (ciphertext is
 * incompressible by design, so compressing after encryption is a no-op that
 * wastes CPU).
 *
 * Zstandard (via the native @mongodb-js/zstd binding) at level 10–15, with a
 * gzip fallback when the binding cannot load on the target platform. The
 * algorithm actually used is recorded in the plaintext object header, so a
 * backup written with one is always readable with the other.
 *
 * Streaming is achieved by splitting the plaintext into fixed-size blocks
 * (1 MiB) and compressing each block independently. A compressed block record
 * carries both lengths so the reader can verify sizes without parsing zstd
 * frame headers:
 *
 *   [u32 uncompressed_len][u32 compressed_len][compressed bytes]
 *
 * Records are emitted whole — the GCM layer above relies on that.
 */

export type CompressionAlgorithm = "zstd" | "gzip";

export const ZSTD_LEVEL = 15;
export const GZIP_LEVEL = 6;
export const BLOCK_BYTES = 1024 * 1024;

interface ZstdBinding {
  compress(data: Buffer, level: number): Promise<Buffer>;
  decompress(data: Buffer): Promise<Buffer>;
}

const req = createRequire(__filename);

/**
 * Lazy zstd loader. The native binding is an optional runtime dependency: a
 * platform without a matching prebuilt binary must degrade to gzip, so the
 * module is only touched when a caller actually needs it. Never import it
 * statically — that would crash the whole process at module load.
 */
function tryLoadZstd(): ZstdBinding | null {
  try {
    return req("@mongodb-js/zstd") as ZstdBinding;
  } catch {
    return null;
  }
}

let preferredCompression: CompressionAlgorithm | null = null;

/** zstd when the native binding loads, gzip otherwise. Decided once. */
export function compressionAlgorithm(): CompressionAlgorithm {
  if (preferredCompression) return preferredCompression;
  preferredCompression = tryLoadZstd() ? "zstd" : "gzip";
  return preferredCompression;
}

export async function compressBlock(data: Buffer, algorithm: CompressionAlgorithm): Promise<Buffer> {
  const compressed =
    algorithm === "zstd"
      ? await tryLoadZstd()!.compress(data, ZSTD_LEVEL)
      : deflateSync(data, { level: GZIP_LEVEL });
  const record = Buffer.alloc(8 + compressed.length);
  record.writeUInt32BE(data.length, 0);
  record.writeUInt32BE(compressed.length, 4);
  compressed.copy(record, 8);
  return record;
}

export async function decompressBlock(record: Buffer, algorithm: CompressionAlgorithm): Promise<Buffer> {
  const uncompressedLen = record.readUInt32BE(0);
  const compressedLen = record.readUInt32BE(4);
  if (record.length !== 8 + compressedLen) {
    throw new Error(
      `Compressed record length mismatch: header says ${compressedLen} bytes, record has ${record.length - 8}`,
    );
  }
  const body = record.subarray(8);
  const data =
    algorithm === "zstd" ? await tryLoadZstd()!.decompress(body) : inflateSync(body);
  if (data.length !== uncompressedLen) {
    throw new Error(
      `Decompressed size mismatch: header says ${uncompressedLen} bytes, got ${data.length}`,
    );
  }
  return data;
}

/**
 * Splits a plaintext stream into BLOCK_BYTES blocks, compresses each and
 * emits the length-prefixed records described above.
 */
export class CompressTransform extends Transform {
  private readonly algorithm: CompressionAlgorithm;
  private pending = Buffer.alloc(0);
  private totalBytes = 0;

  constructor(algorithm: CompressionAlgorithm) {
    super();
    this.algorithm = algorithm;
  }

  override async _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): Promise<void> {
    try {
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.pending.length >= BLOCK_BYTES) {
        const block = this.pending.subarray(0, BLOCK_BYTES);
        this.pending = this.pending.subarray(BLOCK_BYTES);
        this.totalBytes += block.length;
        this.push(await compressBlock(block, this.algorithm));
      }
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }

  override async _flush(callback: TransformCallback): Promise<void> {
    try {
      if (this.pending.length > 0) {
        this.totalBytes += this.pending.length;
        this.push(await compressBlock(this.pending, this.algorithm));
        this.pending = Buffer.alloc(0);
      }
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }

  uncompressedBytes(): number {
    return this.totalBytes;
  }
}

/**
 * Reverses CompressTransform: reads length-prefixed records and emits the
 * decompressed blocks, verifying each record's declared sizes.
 */
export class DecompressTransform extends Transform {
  private readonly algorithm: CompressionAlgorithm;
  private buf = Buffer.alloc(0);

  constructor(algorithm: CompressionAlgorithm) {
    super();
    this.algorithm = algorithm;
  }

  override async _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): Promise<void> {
    try {
      this.buf = Buffer.concat([this.buf, chunk]);
      while (this.buf.length >= 8) {
        const recordLen = 8 + this.buf.readUInt32BE(4);
        if (this.buf.length < recordLen) break;
        const record = this.buf.subarray(0, recordLen);
        this.buf = this.buf.subarray(recordLen);
        this.push(await decompressBlock(record, this.algorithm));
      }
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }
}

/** Incremental SHA-256 accumulator for the streaming pipeline. */
export class Sha256Accumulator {
  private readonly hash = createHash("sha256");
  private bytes = 0;

  update(chunk: Buffer): void {
    this.hash.update(chunk);
    this.bytes += chunk.length;
  }

  digest(): { hex: string; bytes: number } {
    return { hex: this.hash.digest("hex"), bytes: this.bytes };
  }
}