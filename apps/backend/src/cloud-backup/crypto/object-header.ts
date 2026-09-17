import type { KdfParams } from "./kdf";

/**
 * The plaintext object header. It rides at the front of every stored object,
 * before any ciphertext, and carries everything a future version of the app
 * needs to read an old backup: format version, compression, KDF parameters,
 * the cipher nonce base and the sequence range. Nothing in it is secret —
 * the KDF salt and parameters are safe to store alongside the ciphertext by
 * design; the recovery phrase is what protects the data.
 *
 * Layout of a stored object:
 *
 *   [u32 header_length][header JSON (plaintext)][GCM frames (ciphertext)]
 *
 * The header is versioned from day one (format_version: 1). When the format
 * evolves, old objects stay restorable because their own header describes
 * how to read them.
 */

export const FORMAT_VERSION = 1;

export type ObjectKind = "snapshot" | "event_batch" | "check" | "manifest" | "data_export";

export interface ObjectHeader {
  format_version: number;
  kind: ObjectKind;
  school_id: string;
  object_key: string;
  compression: "zstd" | "gzip";
  kdf: KdfParams;
  cipher: {
    alg: "AES-256-GCM";
    nonce_base: string; // base64, 8 bytes
  };
  uncompressed_bytes: number;
  uncompressed_sha256: string; // hex of the plaintext
  stored_bytes: number; // total object length on the wire
  created_at: string; // ISO 8601
  /** Event batches only: the sequence range they cover. */
  seq_from?: number | null;
  seq_to?: number | null;
  app_version?: string;
}

const LEN_BYTES = 4;

export function encodeObjectHeader(header: ObjectHeader): Buffer {
  return Buffer.from(JSON.stringify(header), "utf8");
}

export function decodeObjectHeader(buffer: Buffer): ObjectHeader {
  const header = JSON.parse(buffer.toString("utf8")) as ObjectHeader;
  if (typeof header.format_version !== "number" || header.format_version < 1) {
    throw new Error(`Unsupported backup format version: ${String(header.format_version)}`);
  }
  if (!header.school_id || !header.object_key || !header.compression || !header.kdf || !header.cipher) {
    throw new Error("Backup object header is missing required fields");
  }
  if (header.kdf.alg !== "argon2id" && header.kdf.alg !== "scrypt") {
    throw new Error(`Unsupported KDF algorithm: ${header.kdf.alg}`);
  }
  if (header.compression !== "zstd" && header.compression !== "gzip") {
    throw new Error(`Unsupported compression algorithm: ${header.compression}`);
  }
  return header;
}

/** A fully assembled object: [u32 len][header JSON][ciphertext frames]. */
export function assembleObject(header: ObjectHeader, ciphertext: Buffer): Buffer {
  const headerBytes = encodeObjectHeader(header);
  const out = Buffer.alloc(LEN_BYTES + headerBytes.length + ciphertext.length);
  out.writeUInt32BE(headerBytes.length, 0);
  headerBytes.copy(out, LEN_BYTES);
  ciphertext.copy(out, LEN_BYTES + headerBytes.length);
  return out;
}

/** Splits an assembled object into its header and ciphertext payload. */
export function splitObject(bytes: Buffer): { header: ObjectHeader; ciphertext: Buffer } {
  if (bytes.length < LEN_BYTES) throw new Error("Object too short to carry a header");
  const headerLen = bytes.readUInt32BE(0);
  if (bytes.length < LEN_BYTES + headerLen) throw new Error("Object header length exceeds object size");
  const header = decodeObjectHeader(bytes.subarray(LEN_BYTES, LEN_BYTES + headerLen));
  return { header, ciphertext: bytes.subarray(LEN_BYTES + headerLen) };
}

/** Total wire size for a header whose ciphertext is `cipherLen` bytes. */
export function totalObjectSize(headerLen: number, cipherLen: number): number {
  return LEN_BYTES + headerLen + cipherLen;
}