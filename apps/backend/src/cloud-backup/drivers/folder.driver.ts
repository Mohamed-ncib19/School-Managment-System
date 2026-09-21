import { Readable } from "node:stream";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { ObjectMeta, PutOptions, PutResult, StorageDriver } from "./storage-driver";

/**
 * A plain folder: an external drive, a NAS share, a mapped network drive.
 *
 * This is the zero-friction target, and for many schools it is the only one
 * they will ever configure. It asks for one thing — a path — and needs no
 * account, no provider, no credentials and no internet connection. A USB disk
 * left in a drawer covers the failure that actually happens most often (the
 * PC's disk dies, or ransomware encrypts it), which is the majority of the
 * value of this whole subsystem.
 *
 * It is not off-site on its own: a fire or a theft takes the building's
 * computer and its USB drive together. That is what the cloud targets are
 * for, and why the worker fans every object out to ALL enabled targets —
 * "NAS plus Backblaze" is the configuration to aim a school at.
 *
 * The objects written here are byte-identical to the ones sent to S3 or
 * Drive: same envelope, same AES-256-GCM, same recovery phrase. A stolen USB
 * drive is ciphertext.
 */

export interface FolderConfig {
  /** Absolute path to the backup folder. Created if it does not exist. */
  basePath: string;
}

export class FolderDriver implements StorageDriver {
  readonly id = "folder" as const;
  readonly displayName = "Dossier / disque externe";

  private readonly config: FolderConfig;

  constructor(config: FolderConfig) {
    this.config = config;
  }

  /**
   * Resolves an object key under the base path, refusing anything that climbs
   * out of it. Keys are app-generated today, but a path join is exactly the
   * place where that assumption stops being true quietly.
   */
  private pathFor(key: string): string {
    const base = resolve(this.config.basePath);
    const target = resolve(base, key);
    if (target !== base && !target.startsWith(base + sep)) {
      throw new Error(`Clé d'objet invalide : ${key}`);
    }
    return target;
  }

  private classify(err: unknown): Error {
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === "ENOENT") {
      return new Error(
        "Dossier introuvable — vérifiez que le disque est branché ou que le lecteur réseau est connecté.",
      );
    }
    if (code === "EACCES" || code === "EPERM") {
      return new Error("Accès refusé — ce compte Windows n'a pas le droit d'écrire dans ce dossier.");
    }
    if (code === "ENOSPC") {
      return new Error("Disque plein — libérez de l'espace ou choisissez un autre emplacement.");
    }
    if (code === "EROFS") {
      return new Error("Le support est en lecture seule — retirez la protection en écriture.");
    }
    if (code === "EBUSY" || code === "ENETUNREACH" || code === "EHOSTUNREACH") {
      return new Error("Emplacement injoignable — le lecteur réseau semble déconnecté.");
    }
    return new Error(message);
  }

  async testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }> {
    const started = Date.now();
    const probe = Buffer.from(`iq-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const key = `__iq_probe__/${probe.toString("base64url").slice(0, 40)}.bin`;
    const file = this.pathFor(key);
    try {
      await mkdir(dirname(file), { recursive: true });
      await pipeline(Readable.from([probe]), createWriteStream(file));

      const chunks: Buffer[] = [];
      for await (const chunk of createReadStream(file)) chunks.push(chunk as Buffer);
      if (Buffer.compare(Buffer.concat(chunks), probe) !== 0) {
        throw new Error("Le contenu lu ne correspond pas au contenu écrit (round-trip mismatch).");
      }

      // Unlike the remote drivers, cleaning up here is free and leaves no
      // litter in the user's own folder.
      await unlink(file).catch(() => undefined);
      return { ok: true, latencyMs: Date.now() - started, probe: key };
    } catch (err) {
      throw this.classify(err);
    }
  }

  async put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult> {
    const file = this.pathFor(key);
    try {
      await mkdir(dirname(file), { recursive: true });
      if (!opts?.overwrite) {
        // Backup objects are immutable; a collision means a reused key.
        const exists = await access(file, constants.F_OK).then(
          () => true,
          () => false,
        );
        if (exists) throw new Error(`L'objet existe déjà : ${key}`);
      }
      await pipeline(stream, createWriteStream(file, { flags: "w" }));
      const written = await stat(file);
      if (sizeHint !== undefined && written.size !== sizeHint) {
        throw new Error(`Taille écrite inattendue : ${written.size} au lieu de ${sizeHint}`);
      }
      return { key, size: written.size };
    } catch (err) {
      throw this.classify(err);
    }
  }

  async get(key: string): Promise<Readable> {
    const file = this.pathFor(key);
    try {
      await access(file, constants.R_OK);
      return createReadStream(file);
    } catch (err) {
      throw this.classify(err);
    }
  }

  async list(prefix: string): Promise<ObjectMeta[]> {
    const base = resolve(this.config.basePath);
    const items: ObjectMeta[] = [];
    // Start at the deepest directory the prefix names, rather than walking
    // the whole base path and filtering afterwards. Restore discovery lists
    // per prefix, and a school may well point this at a NAS share that holds
    // far more than these backups.
    const prefixDir = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
    const start = prefixDir ? this.pathFor(prefixDir) : base;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // absent or unreadable subtree — nothing to list
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        const key = full.slice(base.length + 1).split(sep).join("/");
        if (!key.startsWith(prefix)) continue;
        const info = await stat(full).catch(() => null);
        if (!info) continue;
        items.push({ key, size: info.size, lastModified: info.mtime.toISOString() });
      }
    };
    try {
      await walk(start);
      return items;
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
      await unlink(this.pathFor(key));
    } catch (err) {
      throw this.classify(err);
    }
  }
}
