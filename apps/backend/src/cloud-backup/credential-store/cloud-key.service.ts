import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { deriveKey, KdfParams, newSalt } from "../crypto/kdf";
import { machineKey, deriveStoreKey } from "./machine-key";
import { CredentialStoreService } from "./credential-store.service";
import { RedactingLogger } from "../redaction/redaction";

/**
 * Master-key lifecycle for the cloud backup.
 *
 * The recovery phrase yields a 32-byte AES-256 master key via Argon2id/scrypt.
 * That phrase is NEVER stored, logged or transmitted — the running worker
 * cannot ask the admin to type it every sixty seconds — so the master key is
 * derived once and wrapped with a machine-bound key (derived from the Windows
 * MachineGuid / /etc/machine-id) before being stored locally. On this machine
 * the worker unwraps it at boot; on any other machine the wrapped key is
 * useless, which is exactly what a zero-knowledge design requires.
 *
 * Restore on new hardware works differently: the admin types the phrase, the
 * key is re-derived from it and verified against the known-plaintext check
 * object before any large download.
 */
@Injectable()
export class CloudKeyService {
  private readonly logger = new RedactingLogger(CloudKeyService.name);
  private cached: Buffer | null = null;

  constructor(private readonly creds: CredentialStoreService) {}

  /** Derives the master key from the phrase and wraps it for this machine. */
  async wrapFromPhrase(phrase: string, params: KdfParams): Promise<{
    wrapped: string;
    wrapSalt: string;
  }> {
    const masterKey = await deriveKey(phrase, params);
    const key = machineKey(this.creds.directory);
    if (!key) {
      throw new Error("Impossible d'obtenir une clé liée à la machine — la phrase de récupération ne peut pas être protégée localement.");
    }
    const wrapSalt = newSalt();
    const kek = deriveStoreKey(key, wrapSalt);
    const nonce = newSalt().subarray(0, 12);
    const cipher = createCipheriv("aes-256-gcm", kek, nonce);
    const encrypted = Buffer.concat([cipher.update(masterKey), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([nonce, tag, encrypted]);
    return {
      wrapped: payload.toString("base64"),
      wrapSalt: wrapSalt.toString("base64"),
    };
  }

  /** Unwraps the stored master key using this machine's key. */
  async unwrap(wrappedB64: string, wrapSaltB64: string): Promise<Buffer> {
    const key = machineKey(this.creds.directory);
    if (!key) throw new Error("Clé machine indisponible — impossible de déchiffrer la clé maîtresse.");
    const payload = Buffer.from(wrappedB64, "base64");
    const nonce = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const kek = deriveStoreKey(key, Buffer.from(wrapSaltB64, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", kek, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  /** Derives the master key from the phrase directly (restore on new hardware). */
  deriveFromPhrase(phrase: string, params: KdfParams): Promise<Buffer> {
    return deriveKey(phrase, params);
  }

  /** Runtime key cache for the worker — never written anywhere. */
  setRuntimeKey(key: Buffer): void {
    this.cached = key;
  }

  getRuntimeKey(): Buffer | null {
    return this.cached;
  }

  clearRuntimeKey(): void {
    this.cached = null;
  }
}