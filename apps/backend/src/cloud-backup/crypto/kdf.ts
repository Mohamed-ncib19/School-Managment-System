import { hashRaw, Algorithm } from "@node-rs/argon2";
import { scrypt as scryptCb, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Key derivation for the recovery phrase.
 *
 * The 32-byte AES-256 master key is derived from the 12-word phrase via
 * Argon2id (memory-hard, side-channel resistant) with a per-school random
 * salt. Where the Argon2 native binding is unavailable (an unusual platform,
 * a blocked native install), scrypt with documented parameters is the
 * fallback — the same params the argon2id call would have used.
 *
 * The salt and the exact parameters travel in the plaintext object header
 * (they are not secret — the phrase is), which is what lets a future version
 * of the app derive the same key and restore old backups after a parameter
 * change. Never reuse a salt across schools.
 */

export type KdfAlgorithm = "argon2id" | "scrypt";

export interface KdfParams {
  alg: KdfAlgorithm;
  salt: string; // base64, 16 random bytes
  /** Argon2id: memory cost in KiB. */
  memoryCost?: number;
  /** Argon2id: iterations. */
  timeCost?: number;
  parallelism?: number;
  /** scrypt: CPU/memory cost parameter N (power of two). */
  scryptN?: number;
  scryptR?: number;
  scryptP?: number;
  keyLen: number; // bytes, always 32 for AES-256
}

/** Standard parameters — ~64 MiB and a couple of seconds on a modest PC. */
export const DEFAULT_KDF_PARAMS: Omit<KdfParams, "salt" | "alg"> = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  keyLen: 32,
};

export function newSalt(): Buffer {
  return randomBytes(16);
}

export function buildKdfParams(alg: KdfAlgorithm, salt: Buffer, extra?: Partial<KdfParams>): KdfParams {
  return {
    alg,
    salt: salt.toString("base64"),
    memoryCost: extra?.memoryCost ?? DEFAULT_KDF_PARAMS.memoryCost,
    timeCost: extra?.timeCost ?? DEFAULT_KDF_PARAMS.timeCost,
    parallelism: extra?.parallelism ?? DEFAULT_KDF_PARAMS.parallelism,
    scryptN: extra?.scryptN ?? 32768,
    scryptR: extra?.scryptR ?? 8,
    scryptP: extra?.scryptP ?? 1,
    keyLen: DEFAULT_KDF_PARAMS.keyLen,
  };
}

export async function deriveKey(phrase: string, params: KdfParams): Promise<Buffer> {
  const salt = Buffer.from(params.salt, "base64");
  if (params.alg === "argon2id") {
    return hashRaw(phrase, {
      algorithm: Algorithm.Argon2id,
      salt,
      memoryCost: params.memoryCost ?? DEFAULT_KDF_PARAMS.memoryCost,
      timeCost: params.timeCost ?? DEFAULT_KDF_PARAMS.timeCost,
      parallelism: params.parallelism ?? 1,
      outputLen: params.keyLen,
    });
  }
  if (params.alg === "scrypt") {
    return scrypt(phrase, salt, params.keyLen, {
      N: params.scryptN ?? 32768,
      r: params.scryptR ?? 8,
      p: params.scryptP ?? 1,
      maxmem: 256 * 1024 * 1024,
    });
  }
  throw new Error(`Unsupported KDF algorithm: ${params.alg}`);
}

/** Argon2id when the binding loads; scrypt otherwise. Decided once per process. */
let preferredKdf: KdfAlgorithm | null = null;

export function kdfAlgorithm(): KdfAlgorithm {
  if (preferredKdf) return preferredKdf;
  try {
    // Touch the binding so a missing native module surfaces here, not later.
    void Algorithm.Argon2id;
    preferredKdf = "argon2id";
  } catch {
    preferredKdf = "scrypt";
  }
  return preferredKdf;
}

/**
 * KDF params record for a fresh school. The salt is per-school and random;
 * the rest are the standard parameters. Stored as `meta/salt.json` in the
 * cloud AND in `cloud_state` locally so a restore can derive the key from
 * the phrase alone.
 */
export function makeSchoolSalt(): KdfParams {
  return buildKdfParams(kdfAlgorithm(), newSalt());
}