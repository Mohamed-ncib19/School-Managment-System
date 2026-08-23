import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Transform, TransformCallback } from "node:stream";

/**
 * Streaming AES-256-GCM.
 *
 * The whole backup can be much larger than RAM on a low-spec school PC, so
 * the ciphertext is produced and consumed frame by frame. Each frame is one
 * GCM message with its own authentication tag, and every frame uses a
 * distinct nonce: a random 8-byte base per object with the frame counter in
 * the remaining 4 bytes (the standard GCM counter construction — safe for up
 * to 2^32 frames, far beyond any backup).
 *
 * Frame layout on the wire (all integers big-endian):
 *
 *   [u32 ciphertext_len] [ciphertext + 16-byte GCM tag]
 *
 * The reader recomputes each nonce from the base (in the plaintext header)
 * and the frame index, so there is no per-frame nonce overhead and no way to
 * reuse one by accident.
 */

export const GCM_TAG_LENGTH = 16;

/**
 * Largest frame the reader will accept.
 *
 * The length prefix comes from storage, i.e. from outside this process. A
 * corrupt or hostile u32 previously made the reader wait for up to 4 GiB that
 * would never arrive, growing its buffer without bound. Frames are one
 * compressed 1 MiB block plus overhead, so this is generous by an order of
 * magnitude.
 */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const GCM_NONCE_BASE_BYTES = 8;
export const GCM_COUNTER_BYTES = 4;

/** Random per-object nonce base. Fresh for every object — never reused. */
export function newNonceBase(): Buffer {
  return randomBytes(GCM_NONCE_BASE_BYTES);
}

export function nonceForFrame(base: Buffer, frameIndex: number): Buffer {
  const nonce = Buffer.alloc(GCM_NONCE_BASE_BYTES + GCM_COUNTER_BYTES);
  base.copy(nonce, 0, 0, GCM_NONCE_BASE_BYTES);
  nonce.writeUInt32BE(frameIndex >>> 0, GCM_NONCE_BASE_BYTES);
  return nonce;
}

const LEN_BYTES = 4;

/**
 * Encrypts the incoming stream (which must be a sequence of whole records —
 * the compression layer above guarantees this) into GCM frames.
 */
export class GcmEncryptTransform extends Transform {
  private readonly key: Buffer;
  private readonly nonceBase: Buffer;
  private frameIndex = 0;

  constructor(key: Buffer, nonceBase: Buffer) {
    super();
    this.key = key;
    this.nonceBase = nonceBase;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      if (chunk.length === 0) {
        callback();
        return;
      }
      const cipher = createCipheriv("aes-256-gcm", this.key, nonceForFrame(this.nonceBase, this.frameIndex));
      const encrypted = Buffer.concat([cipher.update(chunk), cipher.final()]);
      const tag = cipher.getAuthTag();
      const frame = Buffer.alloc(LEN_BYTES + encrypted.length + GCM_TAG_LENGTH);
      frame.writeUInt32BE(encrypted.length + GCM_TAG_LENGTH, 0);
      encrypted.copy(frame, LEN_BYTES);
      tag.copy(frame, LEN_BYTES + encrypted.length);
      this.frameIndex++;
      this.push(frame);
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }
}

/**
 * Reverses GcmEncryptTransform: reads length-prefixed frames, decrypts each
 * with its counter-derived nonce, verifies the GCM tag (a corrupted or
 * tampered object fails here, loudly) and emits the plaintext records.
 */
export class GcmDecryptTransform extends Transform {
  private readonly key: Buffer;
  private readonly nonceBase: Buffer;
  private frameIndex = 0;
  private buf = Buffer.alloc(0);

  constructor(key: Buffer, nonceBase: Buffer) {
    super();
    this.key = key;
    this.nonceBase = nonceBase;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.buf = Buffer.concat([this.buf, chunk]);
      while (this.buf.length >= LEN_BYTES) {
        const frameLen = this.buf.readUInt32BE(0);
        if (frameLen > MAX_FRAME_BYTES || frameLen < GCM_TAG_LENGTH) {
          throw new Error(`Implausible GCM frame length (${frameLen} bytes); the stored object is corrupt.`);
        }
        if (this.buf.length < LEN_BYTES + frameLen) break;
        const frame = this.buf.subarray(LEN_BYTES, LEN_BYTES + frameLen);
        const ciphertext = frame.subarray(0, frame.length - GCM_TAG_LENGTH);
        const tag = frame.subarray(frame.length - GCM_TAG_LENGTH);
        const decipher = createDecipheriv("aes-256-gcm", this.key, nonceForFrame(this.nonceBase, this.frameIndex));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        this.frameIndex++;
        this.push(plaintext);
        this.buf = this.buf.subarray(LEN_BYTES + frameLen);
      }
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }
}

/** Encrypts a single in-memory buffer (probe objects, check objects). */
export function encryptBuffer(key: Buffer, plaintext: Buffer, nonceBase: Buffer): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, nonceForFrame(nonceBase, 0));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]);
}

/** Decrypts a single in-memory buffer. Throws on a bad tag or wrong key. */
export function decryptBuffer(key: Buffer, ciphertext: Buffer, nonceBase: Buffer): Buffer {
  const tag = ciphertext.subarray(ciphertext.length - GCM_TAG_LENGTH);
  const body = ciphertext.subarray(0, ciphertext.length - GCM_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, nonceForFrame(nonceBase, 0));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}