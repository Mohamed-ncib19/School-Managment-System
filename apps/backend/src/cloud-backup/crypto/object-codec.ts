import { Readable, PassThrough, Transform } from "node:stream";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import type { KdfParams } from "./kdf";
import {
  FORMAT_VERSION,
  encodeObjectHeader,
  ObjectHeader,
  ObjectKind,
  splitObject,
  totalObjectSize,
} from "./object-header";
import {
  DecompressTransform,
  Sha256Accumulator,
  BLOCK_BYTES,
  compressBlock,
  CompressionAlgorithm,
} from "./compression";
import { GcmEncryptTransform, GcmDecryptTransform, newNonceBase } from "./cipher";

export interface EncodeOptions {
  schoolId: string;
  objectKey: string;
  kind: ObjectKind;
  kdf: KdfParams;
  key: Buffer;
  compression: CompressionAlgorithm;
  createdAt?: Date;
  seqFrom?: number | null;
  seqTo?: number | null;
  appVersion?: string;
  /** Factory returning a fresh plaintext Readable. Must be re-invocable: the
   * pipeline needs a prepass pass (hashing + size accounting) before the
   * upload pass. */
  plaintext: () => Readable;
}

export interface EncodedObject {
  header: ObjectHeader;
  /**
   * Opens a FRESH object stream: [u32 len][header JSON][GCM frames].
   *
   * Call it once per target and once per retry. It used to be a single
   * `stream` property, which meant target #2 and every retry received an
   * already-drained Readable and silently uploaded nothing.
   */
  openStream(): Readable;
  /** Exact wire size, identical for every stream this object opens. */
  size: number;
}

/**
 * Runs the compression→encryption pipeline in the required order
 * (compress, then encrypt — never the reverse) while keeping memory bounded:
 * the plaintext is hashed and size-accounted in a streaming prepass, so the
 * header (which must precede the ciphertext and carries the SHA-256 and byte
 * counts) is fully known before the single upload pass begins.
 */
export async function encodeObject(opts: EncodeOptions): Promise<EncodedObject> {
  const prepassResult = await prepass(opts.plaintext(), opts.compression);

  const nonceBase = newNonceBase();
  const createdAt = (opts.createdAt ?? new Date()).toISOString();
  const header: ObjectHeader = {
    format_version: FORMAT_VERSION,
    kind: opts.kind,
    school_id: opts.schoolId,
    object_key: opts.objectKey,
    compression: opts.compression,
    kdf: opts.kdf,
    cipher: { alg: "AES-256-GCM", nonce_base: nonceBase.toString("base64") },
    uncompressed_bytes: prepassResult.bytes,
    uncompressed_sha256: prepassResult.sha,
    stored_bytes: 0, // filled below
    created_at: createdAt,
    seq_from: opts.seqFrom ?? null,
    seq_to: opts.seqTo ?? null,
    app_version: opts.appVersion,
  };

  // `stored_bytes` is inside the header it measures, so setting it changes
  // the header's own length. Iterate to a fixed point — it converges in at
  // most two rounds, because only the digit count can change. The previous
  // code serialised with `stored_bytes: 0` and then mutated the object, so
  // every object on the wire claimed a size of zero.
  header.stored_bytes = 0;
  let headerBytes = encodeObjectHeader(header);
  let size = totalObjectSize(headerBytes.length, prepassResult.cipherBytes);
  for (let round = 0; round < 5 && header.stored_bytes !== size; round++) {
    header.stored_bytes = size;
    headerBytes = encodeObjectHeader(header);
    size = totalObjectSize(headerBytes.length, prepassResult.cipherBytes);
  }
  if (header.stored_bytes !== size) {
    throw new Error(`Object header size did not converge (${header.stored_bytes} vs ${size})`);
  }

  const openStream = (): Readable => {
    const out = new PassThrough();
    const lenPrefix = Buffer.alloc(4);
    lenPrefix.writeUInt32BE(headerBytes.length, 0);
    out.write(lenPrefix);
    out.write(headerBytes);

    // The prepass already produced these records; compressing again would
    // double the CPU cost of every backup on a low-spec school PC. Each
    // record is written as its own chunk so it becomes exactly one GCM frame,
    // which is what `cipherBytes` was computed against.
    const encrypt = new GcmEncryptTransform(opts.key, nonceBase);
    // `pipe()` already ends `out` on completion — calling out.end() here too
    // raised ERR_STREAM_ALREADY_FINISHED. Only forward errors.
    encrypt.on("error", (err) => out.destroy(err));
    encrypt.pipe(out);
    for (const record of prepassResult.records) encrypt.write(record);
    encrypt.end();
    return out;
  };

  return { header, openStream, size };
}

interface PrepassResult {
  sha: string;
  bytes: number;
  cipherBytes: number;
  /** The compressed block records, in order, reused by the upload pass. */
  records: Buffer[];
}

/** One streaming pass: hash the plaintext, compress it, and account for the
 * exact encrypted size so the upload pass can set a true Content-Length. The
 * records are kept — the upload pass used to compress everything a second
 * time, doubling the CPU cost of every backup. */
async function prepass(source: Readable, algorithm: CompressionAlgorithm): Promise<PrepassResult> {
  const hasher = new Sha256Accumulator();
  let pending = Buffer.alloc(0);
  let cipherBytes = 0;
  const records: Buffer[] = [];

  const take = async (block: Buffer): Promise<void> => {
    const record = await compressBlock(block, algorithm);
    records.push(record);
    // frame = [u32 len][record][GCM tag]
    cipherBytes += 4 + record.length + 16;
  };

  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    hasher.update(buf);
    pending = Buffer.concat([pending, buf]);
    while (pending.length >= BLOCK_BYTES) {
      await take(pending.subarray(0, BLOCK_BYTES));
      pending = pending.subarray(BLOCK_BYTES);
    }
  }
  if (pending.length > 0) await take(pending);

  const { hex, bytes } = hasher.digest();
  return { sha: hex, bytes, cipherBytes, records };
}

export interface DecodedObject {
  header: ObjectHeader;
  plaintext: Buffer;
}

/**
 * Decrypts + decompresses an in-memory object (probe objects, check objects,
 * small event batches). Verifies the GCM tag and the header's SHA-256; any
 * mismatch is a hard error — never a silent partial result.
 */
export async function decodeObject(bytes: Buffer, key: Buffer): Promise<DecodedObject> {
  const { header, ciphertext } = splitObject(bytes);
  const nonceBase = Buffer.from(header.cipher.nonce_base, "base64");
  const decrypted = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = Readable.from([ciphertext]);
    stream
      .pipe(new GcmDecryptTransform(key, nonceBase))
      .on("data", (c: Buffer) => chunks.push(c))
      .on("error", reject)
      .on("end", () => resolve(Buffer.concat(chunks)));
  });

  const plaintext = await decompressAll(decrypted, header.compression);

  const hasher = new Sha256Accumulator();
  hasher.update(plaintext);
  const { hex } = hasher.digest();
  if (hex !== header.uncompressed_sha256) {
    throw new Error(
      `Checksum mismatch: object claims SHA-256 ${header.uncompressed_sha256}, computed ${hex}. ` +
        "The stored object is corrupted or was tampered with; restore aborted.",
    );
  }
  if (plaintext.length !== header.uncompressed_bytes) {
    throw new Error(
      `Size mismatch: object claims ${header.uncompressed_bytes} bytes, got ${plaintext.length}`,
    );
  }
  return { header, plaintext };
}

/** Decompresses the concatenated block records inside one buffer. */
export async function decompressAll(records: Buffer, algorithm: CompressionAlgorithm): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    Readable.from([records])
      .pipe(new DecompressTransform(algorithm))
      .on("data", (c: Buffer) => chunks.push(c))
      .on("error", reject)
      .on("end", () => resolve());
  });
  return Buffer.concat(chunks);
}

/**
 * Yields the ciphertext region of a stored object, consuming and discarding
 * the [u32 header_length][header JSON] prefix. Sanity-checks the declared
 * header length so a corrupt length cannot swallow the whole object silently.
 */
async function* bodyAfterHeader(source: Readable): AsyncGenerator<Buffer> {
  let head = Buffer.alloc(0);
  let skipTo = -1;
  for await (const chunk of source) {
    const c = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    if (skipTo >= 0) {
      yield c;
      continue;
    }
    head = Buffer.concat([head, c]);
    if (head.length < 4) continue;
    const headerLen = head.readUInt32BE(0);
    if (headerLen > 1_000_000) {
      throw new Error(`Object header length is implausible (${headerLen} bytes); object is corrupt.`);
    }
    skipTo = 4 + headerLen;
    if (head.length > skipTo) yield head.subarray(skipTo);
  }
  if (skipTo < 0) throw new Error("Object too short to carry a header");
}

/**
 * Streaming decrypt + decompress to a file. Used for snapshots, which are too
 * large to hold in memory. Accepts the full stored object (prefix + header +
 * frames), verifies SHA-256 and byte count on completion; a mismatch deletes
 * the file and throws.
 */
export async function decodeObjectToFile(
  objectStream: Readable,
  key: Buffer,
  header: ObjectHeader,
  targetPath: string,
): Promise<{ bytes: number }> {
  const { pipeline } = await import("node:stream/promises");
  const nonceBase = Buffer.from(header.cipher.nonce_base, "base64");
  const hasher = new Sha256Accumulator();

  const tee = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hasher.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    // `pipeline` forwards an error from ANY stage and destroys the rest. The
    // previous hand-wired version listened for errors on the write stream
    // only, so a bad GCM tag — the expected outcome for a corrupt backup —
    // was an unhandled error event that took the process down.
    await pipeline(
      Readable.from(bodyAfterHeader(objectStream)),
      new GcmDecryptTransform(key, nonceBase),
      new DecompressTransform(header.compression),
      tee,
      createWriteStream(targetPath, { flags: "w" }),
    );
  } catch (err) {
    await rm(targetPath, { force: true });
    throw err;
  }

  const { hex, bytes } = hasher.digest();
  if (hex !== header.uncompressed_sha256) {
    await rm(targetPath, { force: true });
    throw new Error(
      `Checksum mismatch: snapshot claims SHA-256 ${header.uncompressed_sha256}, computed ${hex}. ` +
        "The stored object is corrupted or was tampered with; restore aborted.",
    );
  }
  if (bytes !== header.uncompressed_bytes) {
    await rm(targetPath, { force: true });
    throw new Error(
      `Size mismatch: snapshot claims ${header.uncompressed_bytes} bytes, got ${bytes}`,
    );
  }
  return { bytes };
}