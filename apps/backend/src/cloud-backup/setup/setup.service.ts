import { Injectable, BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { cloudState, cloudTargets, systemSettings } from "../../db/schema";
import { generateRecoveryPhrase, RecoveryPhrase } from "../crypto/bip39";
import { makeSchoolSalt, KdfParams } from "../crypto/kdf";
import { writeMetaObjects } from "./meta-objects";
import { slugifySchoolId, isValidSchoolId } from "./school-id";
import { CloudKeyService } from "../credential-store/cloud-key.service";
import { CredentialStoreService } from "../credential-store/credential-store.service";
import { SyncWorkerService } from "../worker/sync-worker.service";
import { SnapshotService } from "../worker/snapshot.service";
import { InstanceRegistryService } from "../registry/instance-registry.service";
import { SyncQueueService } from "../queue/sync-queue.service";
import { RedactingLogger } from "../redaction/redaction";

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

  /**
   * What to prefill the school id with, so the wizard stops asking.
   *
   * Derived from the name the install already carries. An administrator can
   * still change it; most never should.
   */
  async suggestedSchoolId(): Promise<{ schoolId: string; source: "existing" | "name" | "fallback" }> {
    const existing = await this.db.client.query.cloudState.findFirst({
      where: eq(cloudState.singleton, "global"),
    });
    if (existing?.school_id) return { schoolId: existing.school_id, source: "existing" };

    const settings = await this.db.client.query.systemSettings.findFirst({
      where: eq(systemSettings.singleton, "global"),
    });
    const fromName = slugifySchoolId(settings?.system_name ?? "");
    if (fromName && isValidSchoolId(fromName)) return { schoolId: fromName, source: "name" };

    return { schoolId: "mon-ecole", source: "fallback" };
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
    const targets = await this.enabledTargetDrivers();
    if (targets.length === 0) {
      throw new BadRequestException("Configurez au moins une destination de sauvegarde avant de continuer.");
    }
    await writeMetaObjects(
      targets.map((t) => t.driver),
      schoolId,
      kdf,
      key,
    );
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

    // Claim BEFORE the snapshot, and do not swallow a collision.
    //
    // This used to claim afterwards and discard the result, so setting up a
    // second machine against a school id already in use completed happily and
    // left two installs writing one namespace — the exact corruption the
    // registry exists to prevent. An unreachable target is still tolerated;
    // a live rival is not.
    for (const t of targets) {
      try {
        const claim = await this.registry.claim(t.driver, schoolId, state.instance_uuid, state.hostname);
        if (claim.conflict) {
          throw new BadRequestException(
            `L'identifiant d'école « ${schoolId} » est déjà utilisé par une autre installation ` +
              `(${claim.conflict.hostname}). Choisissez un autre identifiant, ou retirez d'abord cette installation.`,
          );
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        /* unreachable target — the heartbeat re-checks every drain cycle */
      }
    }

    const results = await this.snapshots.runSnapshot(targets, key, schoolId, kdf, "initial");

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

  /**
   * Delegates to the worker's driver cache rather than building a second set.
   *
   * Constructing a driver decrypts its credentials, which on Windows spawns a
   * PowerShell process — doing that twice for the same target is pure waste,
   * and two live S3 clients per target leak two socket pools.
   */
  enabledTargetDrivers(): Promise<Array<{ id: string; driver: import("../drivers/storage-driver").StorageDriver }>> {
    return this.worker.enabledTargets();
  }
}