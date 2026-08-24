import { Readable } from "node:stream";
import type { StorageDriver } from "../drivers/storage-driver";
import type { KdfParams } from "../crypto/kdf";
import { encodeObject, decodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import { buildCheckPlaintext } from "../crypto/check-object";

/**
 * The two small objects that make a namespace restorable: the KDF salt (so a
 * new machine can derive the key from the phrase) and the known-plaintext
 * check object (so it can prove the phrase is right before downloading
 * gigabytes).
 *
 * They are the only mutable objects here besides the instance registry —
 * everything else is append-only — because they must be rewritable:
 *
 *  - re-running setup with the same phrase re-seeds them, and
 *  - an install created before the check payload gained its `school_id` field
 *    carries a stale object that would reject a perfectly valid phrase.
 *
 * Both are written with `overwrite: true` for that reason. Writing them
 * without it used to fail outright on WebDAV and on a folder target, whose
 * puts refuse to replace an existing object.
 */

export const saltKey = (schoolId: string): string => `${schoolId}/meta/salt.json`;
export const checkKey = (schoolId: string): string => `${schoolId}/meta/check.json.enc`;

/** Writes the salt and check objects to every target given. */
export async function writeMetaObjects(
  targets: StorageDriver[],
  schoolId: string,
  kdf: KdfParams,
  key: Buffer,
): Promise<void> {
  const saltBytes = Buffer.from(JSON.stringify({ school_id: schoolId, kdf }, null, 2), "utf8");
  const encoded = await encodeObject({
    schoolId,
    objectKey: checkKey(schoolId),
    kind: "check",
    kdf,
    key,
    compression: compressionAlgorithm(),
    plaintext: () => Readable.from([Buffer.from(buildCheckPlaintext(schoolId), "utf8")]),
  });

  for (const driver of targets) {
    await driver.put(saltKey(schoolId), Readable.from([saltBytes]), saltBytes.length, { overwrite: true });
    await driver.put(checkKey(schoolId), encoded.openStream(), encoded.size, { overwrite: true });
  }
}

/**
 * True when the stored check object decodes with `key` AND matches the
 * payload this version of the app expects.
 *
 * A `false` here is not necessarily corruption — far more often it is an
 * install seeded by an older build, whose check object omitted the school id.
 * Callers repair it rather than reporting a fault.
 */
export async function checkObjectIsCurrent(
  driver: StorageDriver,
  schoolId: string,
  key: Buffer,
): Promise<boolean> {
  try {
    const stream = await driver.get(checkKey(schoolId));
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const decoded = await decodeObject(Buffer.concat(chunks), key);
    return decoded.plaintext.toString("utf8") === buildCheckPlaintext(schoolId);
  } catch {
    // Missing, unreadable, or written under a different key — all repairable
    // by rewriting it, and all indistinguishable from here.
    return false;
  }
}
