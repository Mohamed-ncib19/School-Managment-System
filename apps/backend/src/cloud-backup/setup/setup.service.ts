import { Injectable, BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { cloudState, cloudTargets } from "../../db/schema";
import { generateRecoveryPhrase, RecoveryPhrase } from "../crypto/bip39";
import { buildCheckPlaintext } from "../crypto/check-object";
import { makeSchoolSalt, KdfParams } from "../crypto/kdf";
import { encodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import { CloudKeyService } from "../credential-store/cloud-key.service";
import { CredentialStoreService } from "../credential-store/credential-store.service";
import { SyncWorkerService } from "../worker/sync-worker.service";
import { SnapshotService } from "../worker/snapshot.service";
import { InstanceRegistryService } from "../registry/instance-registry.service";
import { SyncQueueService } from "../queue/sync-queue.service";
import { createDriver, DriverConfigRecord } from "../drivers/driver-registry";
import { RedactingLogger } from "../redaction/redaction";
import { Readable } from "node:stream";

/**
 * One-time setup orchestration (Settings → Data safety → Cloud safe save).
 *
 * Step 1: the app generates a 12-word recovery phrase, derives the master key,
 * wraps it with the machine key, stores the wrapped key + KDF salt locally,
 * and seeds the cloud with the salt + a known-plaintext check object.
 *
 * Step 2 (verify): a live drain run uploads the seeded event and confirms
 * round-trip coverage against every enabled target.
 *
 * Step 3 (finish): the first full snapshot is taken and the instance is
 * claimed in the registry.
 */

@Injectable()
export class CloudSetupService {
  private readonly logger = new RedactingLogger(CloudSetupService.name);

  constructor(
    private readonly db: DbService,
    private readonly keys: CloudKeyService,
    private readonly creds: CredentialStoreService,
    private readonly worker: SyncWorkerService,
    private readonly snapshots: SnapshotService,
    private readonly registry: InstanceRegistryService,
    private readonly queue: SyncQueueService,
  ) {}

  /** Generates a fresh 12-word phrase. Never stored server-side. */
  generatePhrase(): RecoveryPhrase {
    return generateRecoveryPhrase();
  }

  /** Step 1 — establish school identity, wrap the key, seed the cloud. */
  async step1(input: {
    schoolId: string;
    phrase: string;
    /**
     * Required to overwrite a configured install's KDF salt. Doing so
     * re-keys the namespace: every object already in the cloud was encrypted
     * under the old key and becomes permanently unreadable.
     */
    confirmReplaceExisting?: boolean;
  }): Promise<{
    schoolId: string;
    instanceUuid: string;
    kdf: KdfParams;
  }> {
    const schoolId = input.schoolId.trim().toLowerCase().replace(/\s+/g, "-");
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(schoolId)) {
      throw new BadRequestException(
        "Identifiant d'école invalide : 3 à 64 caractères, lettres minuscules, chiffres et tirets.",
      );
    }

    const configured = await this.db.client.query.cloudState.findFirst({
      where: eq(cloudState.singleton, "global"),
    });
    if (configured?.setup_complete && configured.kdf_salt && !input.confirmReplaceExisting) {
      throw new BadRequestException(
        "Cette installation a déjà une sauvegarde cloud configurée. Reconfigurer génère une nouvelle clé : " +
          "toutes les sauvegardes déjà envoyées deviendraient définitivement illisibles, y compris tout l'historique. " +
          "Cette action est irréversible — confirmez explicitement pour continuer.",
      );
    }

    const kdf = makeSchoolSalt();
    const wrapped = await this.keys.wrapFromPhrase(input.phrase, kdf);
    const instanceUuid = randomUUID();
    const hostname = osHostname() || "unknown-host";

    if (configured) {
      await this.db.client
        .update(cloudState)
        .set({
          school_id: schoolId,
          instance_uuid: instanceUuid,
          hostname,
          kdf_salt: JSON.stringify(kdf),
          wrapped_key: wrapped.wrapped,
          wrap_salt: wrapped.wrapSalt,
          setup_complete: true,
          verify_complete: false,
        })
        .where(eq(cloudState.singleton, "global"));
    } else {
      await this.db.client.insert(cloudState).values({
        singleton: "global",
        school_id: schoolId,
        instance_uuid: instanceUuid,
        hostname,
        kdf_salt: JSON.stringify(kdf),
        wrapped_key: wrapped.wrapped,
        wrap_salt: wrapped.wrapSalt,
        setup_complete: true,
        verify_complete: false,
      });
    }

    const key = await this.keys.unwrap(wrapped.wrapped, wrapped.wrapSalt);
    await this.seedCloud(schoolId, kdf, key);
    this.logger.log(`Cloud backup seeded for school ${schoolId} (instance ${instanceUuid}).`);
    return { schoolId, instanceUuid, kdf };
  }

  /** Writes the salt and check objects to every enabled target. */
  private async seedCloud(schoolId: string, kdf: KdfParams, key: Buffer): Promise<void> {
    const targets = await this.db.client
      .select()
      .from(cloudTargets)
      .where(eq(cloudTargets.enabled, true));
    if (targets.length === 0) {
      throw new BadRequestException("Configurez au moins une destination de sauvegarde avant de continuer.");
    }

    const saltBytes = Buffer.from(
      JSON.stringify({ school_id: schoolId, kdf }, null, 2),
      "utf8",
    );
    const checkEncoded = await encodeObject({
      schoolId,
      objectKey: `${schoolId}/meta/check.json.enc`,
      kind: "check",
      kdf,
      key,
      compression: compressionAlgorithm(),
      plaintext: () => Readable.from([Buffer.from(buildCheckPlaintext(schoolId), "utf8")]),
    });

    for (const target of targets) {
      const secret = await this.creds.load(target.config_ref);
      if (!secret) continue;
      const driver = createDriver(JSON.parse(secret) as DriverConfigRecord);
      await driver.put(`${schoolId}/meta/salt.json`, Readable.from([saltBytes]), saltBytes.length);
      await driver.put(`${schoolId}/meta/check.json.enc`, checkEncoded.openStream(), checkEncoded.size);
    }
  }

  /** Step 2 — live drain run + coverage check against every target. */
  async verify(): Promise<{
    ok: boolean;
    drained: boolean;
    pending: number;
    targets: Array<{ id: string; ok: boolean; lastError: string | null }>;
  }> {
    const drained = await this.worker.runDrainNow();
    const targets = await this.db.client.select().from(cloudTargets).where(eq(cloudTargets.enabled, true));
    const targetStatus = targets.map((t) => ({
      id: t.id,
      ok: !t.last_error && t.last_success_at !== null,
      lastError: t.last_error,
    }));
    const pending = await this.pendingCount();
    return {
      ok: targetStatus.length > 0 && targetStatus.every((t) => t.ok) && pending === 0,
      drained,
      pending,
      targets: targetStatus,
    };
  }

  /**
   * Rows still waiting in the sync queue.
   *
   * This counted `cloud_targets` — so `pending` was the number of configured
   * destinations, and `ok: pending === 0` could never be true on an install
   * that had any. Setup step 2 always reported failure.
   */
  private async pendingCount(): Promise<number> {
    return (await this.queue.stats()).pending;
  }

  /** Step 3 — first full snapshot + claim the instance. */
  async finish(schoolId: string): Promise<{ snapshotKey: string | null }> {
    const state = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    if (!state?.wrapped_key || !state.wrap_salt || !state.kdf_salt) {
      throw new BadRequestException("Étape 1 non effectuée.");
    }
    const key = await this.keys.unwrap(state.wrapped_key, state.wrap_salt);
    const kdf = JSON.parse(state.kdf_salt) as KdfParams;
    const targets = await this.enabledTargetDrivers();
    const results = await this.snapshots.runSnapshot(targets, key, schoolId, kdf, "initial");

    for (const t of targets) {
      try {
        await this.registry.claim(t.driver, schoolId, state.instance_uuid, state.hostname);
      } catch {
        /* one unreachable target must not fail finalization */
      }
    }

    await this.db.client
      .update(cloudState)
      .set({
        verify_complete: true,
        schema_hash: await this.snapshots.schemaHash(),
        last_manifest_at: new Date(),
      })
      .where(eq(cloudState.singleton, "global"));

    const ok = results.filter((r) => r.ok);
    this.logger.log(`Setup finished: initial snapshot uploaded to ${ok.length}/${results.length} targets.`);
    return { snapshotKey: ok[0]?.key ?? null };
  }

  async enabledTargetDrivers(): Promise<Array<{ id: string; driver: import("../drivers/storage-driver").StorageDriver }>> {
    const rows = await this.db.client
      .select()
      .from(cloudTargets)
      .where(eq(cloudTargets.enabled, true));
    const out: Array<{ id: string; driver: import("../drivers/storage-driver").StorageDriver }> = [];
    for (const row of rows) {
      const secret = await this.creds.load(row.config_ref);
      if (!secret) continue;
      out.push({ id: row.id, driver: createDriver(JSON.parse(secret) as DriverConfigRecord) });
    }
    return out;
  }
}