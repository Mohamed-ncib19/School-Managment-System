import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { cloudState, cloudTargets, backupManifest } from "../db/schema";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SyncWorkerService, ATTENTION_PENDING_ROWS, ATTENTION_OLDEST_MS } from "./worker/sync-worker.service";
import { SyncQueueService } from "./queue/sync-queue.service";
import { CredentialStoreService } from "./credential-store/credential-store.service";
import { CloudKeyService } from "./credential-store/cloud-key.service";
import { CloudSetupService } from "./setup/setup.service";
import { RestoreService, RestoreInput } from "./restore/restore.service";
import { RestoreThrottleGuard } from "./restore/restore-throttle.guard";
import { SnapshotService } from "./worker/snapshot.service";
import { DRIVER_DEFINITIONS, DriverConfigRecord, createDriver } from "./drivers/driver-registry";
import { redactLogError, RedactingLogger } from "./redaction/redaction";

interface TargetBody {
  driverId: string;
  name?: string;
  config?: Record<string, string>;
}

@Controller("cloud-backup")
export class CloudBackupController {
  private readonly logger = new RedactingLogger(CloudBackupController.name);

  constructor(
    private readonly db: DbService,
    private readonly worker: SyncWorkerService,
    private readonly queue: SyncQueueService,
    private readonly creds: CredentialStoreService,
    private readonly keys: CloudKeyService,
    private readonly setup: CloudSetupService,
    private readonly restore: RestoreService,
    private readonly snapshots: SnapshotService,
  ) {}

  // ---------------------------------------------------------------------------
  // Setup wizard (authenticated — Settings → Data safety)
  // ---------------------------------------------------------------------------

  @Get("drivers")
  listDrivers() {
    return DRIVER_DEFINITIONS.map((d) => ({
      id: d.id,
      displayName: d.displayName,
      description: d.description,
      requiresOAuth: d.requiresOAuth ?? false,
      fields: d.fields.map((f) => ({
        name: f.name,
        type: f.type,
        label: f.label,
        placeholder: f.placeholder,
        help: f.help,
        required: f.required ?? false,
        secret: f.secret ?? false,
        options: f.options,
      })),
    }));
  }

  @Get("status")
  @UseGuards(JwtAuthGuard)
  async status() {
    const state = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    const targets = await this.db.client.select().from(cloudTargets).orderBy(cloudTargets.created_at);
    const queueStats = await this.queue.stats();

    const enabled = targets.filter((t) => t.enabled);
    const anySuccessRecently = enabled.some(
      (t) => t.last_success_at && Date.now() - new Date(t.last_success_at).getTime() < 5 * 60_000,
    );
    const allFailed = enabled.length > 0 && enabled.every((t) => t.last_error !== null);
    const pendingOlder = await this.queue.pendingOlderThan(new Date(Date.now() - ATTENTION_OLDEST_MS));
    const conflict = await this.worker.currentConflict();

    let syncState: "synced" | "offline" | "syncing" | "attention" | "disabled" | "unconfigured" = "unconfigured";
    if (!state?.setup_complete) {
      syncState = "unconfigured";
    } else if (conflict) {
      syncState = "attention";
    } else if (this.worker.isSyncing()) {
      syncState = "syncing";
    } else if (enabled.length === 0) {
      syncState = "disabled";
    } else if (allFailed) {
      syncState = "offline";
    } else if (queueStats.failed > 0) {
      // A row past the retry ceiling needs a human, not another cycle.
      syncState = "attention";
    } else if (queueStats.pending > ATTENTION_PENDING_ROWS || pendingOlder > 0) {
      syncState = "attention";
    } else {
      syncState = anySuccessRecently ? "synced" : "syncing";
    }

    return {
      configured: !!state?.setup_complete,
      state: syncState,
      schoolId: state?.school_id ?? null,
      instanceUuid: state?.instance_uuid ?? null,
      hostname: state?.hostname ?? null,
      conflict: conflict
        ? { hostname: conflict.hostname, instanceUuid: conflict.instance_uuid, claimedAt: conflict.claimed_at }
        : null,
      queue: {
        pending: queueStats.pending,
        failed: queueStats.failed,
        total: queueStats.total,
        oldestPendingAt: queueStats.oldestPendingAt,
        pendingBytes: queueStats.pendingBytes,
      },
      targets: targets.map((t) => ({
        id: t.id,
        name: t.display_label,
        driverId: t.driver,
        enabled: t.enabled,
        hasSecret: this.creds.has(t.config_ref),
        lastSuccessAt: t.last_success_at,
        lastError: t.last_error,
        consecutiveFailures: t.consecutive_failures,
      })),
      lastSync: await this.lastSync(),
      lastSnapshot: state?.last_manifest_at ?? null,
    };
  }

  private async lastSync(): Promise<string | null> {
    const rows = await this.db.client
      .select({ at: backupManifest.created_at })
      .from(backupManifest)
      // Ascending returned the FIRST backup ever taken and labelled it
      // "last sync" — a value that never changed again.
      .orderBy(desc(backupManifest.created_at))
      .limit(1);
    return rows[0]?.at?.toISOString() ?? null;
  }

  @Post("targets")
  @UseGuards(JwtAuthGuard)
  async createTarget(@Body() body: TargetBody) {
    if (!body.driverId || !body.config) throw new BadRequestException("Paramètres de destination incomplets.");
    const def = DRIVER_DEFINITIONS.find((d) => d.id === body.driverId);
    if (!def) throw new BadRequestException("Type de destination inconnu.");

    // Test the connection before persisting anything.
    const driver = createDriver({ driver: body.driverId, config: body.config } as DriverConfigRecord);
    try {
      await driver.testConnection();
    } catch (err) {
      throw new BadRequestException(`Connexion impossible : ${redactLogError(err)}`);
    }

    const configRef = randomUUID();
    await this.creds.save(configRef, JSON.stringify({ driver: body.driverId, config: body.config } as DriverConfigRecord));

    const [row] = await this.db.client
      .insert(cloudTargets)
      .values({
        id: randomUUID(),
        display_label: body.name?.trim() || def.displayName,
        driver: body.driverId,
        config_ref: configRef,
        enabled: true,
      })
      .returning();
    return { id: row.id, name: row.display_label, driverId: row.driver, enabled: row.enabled };
  }

  @Put("targets/:id")
  @UseGuards(JwtAuthGuard)
  async updateTarget(@Param("id") id: string, @Body() body: { name?: string; config?: Record<string, string>; enabled?: boolean }) {
    const row = await this.db.client.query.cloudTargets.findFirst({ where: eq(cloudTargets.id, id) });
    if (!row) throw new NotFoundException("Destination inconnue.");

    let configRef = row.config_ref;
    if (body.config) {
      const driver = createDriver({ driver: row.driver, config: body.config } as DriverConfigRecord);
      try {
        await driver.testConnection();
      } catch (err) {
        throw new BadRequestException(`Connexion impossible : ${redactLogError(err)}`);
      }
      configRef = randomUUID();
      await this.creds.save(configRef, JSON.stringify({ driver: row.driver, config: body.config } as DriverConfigRecord));
      await this.creds.delete(row.config_ref);
    }

    const [updated] = await this.db.client
      .update(cloudTargets)
      .set({
        display_label: body.name?.trim() ?? row.display_label,
        config_ref: configRef,
        enabled: body.enabled ?? row.enabled,
      })
      .where(eq(cloudTargets.id, id))
      .returning();
    return { id: updated.id, name: updated.display_label, enabled: updated.enabled };
  }

  @Delete("targets/:id")
  @UseGuards(JwtAuthGuard)
  async deleteTarget(@Param("id") id: string) {
    const row = await this.db.client.query.cloudTargets.findFirst({ where: eq(cloudTargets.id, id) });
    if (!row) throw new NotFoundException("Destination inconnue.");
    // Append-only: disabling, never deleting the cloud copy.
    await this.db.client.update(cloudTargets).set({ enabled: false }).where(eq(cloudTargets.id, id));
    await this.creds.delete(row.config_ref);
    return { ok: true };
  }

  @Post("targets/:id/test")
  @UseGuards(JwtAuthGuard)
  async testTarget(@Param("id") id: string) {
    const row = await this.db.client.query.cloudTargets.findFirst({ where: eq(cloudTargets.id, id) });
    if (!row) throw new NotFoundException("Destination inconnue.");
    const secret = await this.creds.load(row.config_ref);
    if (!secret) throw new BadRequestException("Identifiants de destination manquants.");
    const driver = createDriver(JSON.parse(secret) as DriverConfigRecord);
    try {
      const result = await driver.testConnection();
      return { ok: true, latencyMs: result.latencyMs };
    } catch (err) {
      throw new BadRequestException(`Connexion impossible : ${redactLogError(err)}`);
    }
  }

  @Post("setup/generate-phrase")
  @UseGuards(JwtAuthGuard)
  generatePhrase() {
    return this.setup.generatePhrase();
  }

  @Post("setup/step-1")
  @UseGuards(JwtAuthGuard)
  step1(@Body() body: { schoolId?: string; phrase?: string; confirmReplaceExisting?: boolean }) {
    if (!body.schoolId || !body.phrase) throw new BadRequestException("Identifiant d'école et phrase requis.");
    return this.setup.step1({
      schoolId: body.schoolId,
      phrase: body.phrase,
      confirmReplaceExisting: body.confirmReplaceExisting === true,
    });
  }

  @Post("setup/verify")
  @UseGuards(JwtAuthGuard)
  verifySetup() {
    return this.setup.verify();
  }

  @Post("setup/finish")
  @UseGuards(JwtAuthGuard)
  finishSetup(@Body() body: { schoolId?: string }) {
    if (!body.schoolId) throw new BadRequestException("Identifiant d'école requis.");
    return this.setup.finish(body.schoolId);
  }

  @Post("backup/now")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async backupNow() {
    const state = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    if (!state?.wrapped_key || !state.wrap_salt || !state.kdf_salt) throw new BadRequestException("Sauvegarde cloud non configurée.");
    const key = await this.keys.unwrap(state.wrapped_key, state.wrap_salt);
    const kdf = JSON.parse(state.kdf_salt) as Parameters<typeof import("./crypto/object-codec").encodeObject>[0]["kdf"];
    const targets = await this.setup.enabledTargetDrivers();

    // Fire and report progress through /status. A full dump plus upload is
    // minutes of work; awaiting it held the request open past any proxy
    // timeout and gave the user no way to see how it went.
    void this.snapshots
      .runSnapshot(targets, key, state.school_id, kdf, "manual")
      .catch((err) => this.logger.error(`Manual snapshot failed: ${redactLogError(err)}`));

    return { accepted: true };
  }

  // ---------------------------------------------------------------------------
  // GDrive OAuth (loopback) — the consent page redirects back to this server,
  // which hands the refresh token to the SPA popup via postMessage.
  // ---------------------------------------------------------------------------

  private readonly pendingOAuth = new Map<
    string,
    { clientId: string; clientSecret: string; redirectUri: string; createdAt: number }
  >();

  @Post("oauth/gdrive/url")
  @UseGuards(JwtAuthGuard)
  async gdriveUrl(@Body() body: { clientId?: string; clientSecret?: string; redirectUri?: string }) {
    if (!body.clientId || !body.clientSecret || !body.redirectUri) {
      throw new BadRequestException("Client ID, client secret et URI de redirection requis.");
    }
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(body.clientId, body.clientSecret, body.redirectUri);
    const state = randomUUID();
    // Abandoned handshakes hold a client secret in memory; sweep them.
    const now = Date.now();
    for (const [key, entry] of this.pendingOAuth) {
      if (now - entry.createdAt > 10 * 60_000) this.pendingOAuth.delete(key);
    }
    this.pendingOAuth.set(state, {
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      redirectUri: body.redirectUri,
      createdAt: now,
    });
    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/drive.file"],
      state,
    });
    return { url, state };
  }

  @Get("oauth/gdrive/callback")
  async gdriveCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const pending = state ? this.pendingOAuth.get(state) : undefined;
    this.pendingOAuth.delete(state ?? "");
    // The popup was opened by the SPA at this origin; the refresh token goes
    // there and nowhere else. The wildcard `"*"` this used to pass handed a
    // long-lived Google credential to any window listening.
    const appOrigin = pending ? new URL(pending.redirectUri).origin : "null";
    const reply = (payload: Record<string, unknown>) =>
      res
        .set("Content-Type", "text/html; charset=utf-8")
        .send(
          `<script>if(window.opener){window.opener.postMessage(${JSON.stringify(payload)},${JSON.stringify(
            appOrigin,
          )});}setTimeout(()=>window.close(),500);</script>`,
        );

    if (error || !pending || !code) {
      reply({ type: "iq-gdrive-oauth", ok: false, error: "denied" });
      return;
    }
    try {
      const { google } = await import("googleapis");
      const oauth2 = new google.auth.OAuth2(pending.clientId, pending.clientSecret, pending.redirectUri);
      const { tokens } = await oauth2.getToken(code);
      if (!tokens.refresh_token) {
        throw new Error("Aucun refresh token renvoyé — autorisez le compte avec le mode hors ligne.");
      }
      reply({ type: "iq-gdrive-oauth", ok: true, refreshToken: tokens.refresh_token });
    } catch (err) {
      reply({ type: "iq-gdrive-oauth", ok: false, error: redactLogError(err) });
    }
  }

  // ---------------------------------------------------------------------------
  // Restore (public — reachable from the login screen on new hardware)
  // ---------------------------------------------------------------------------

  @Get("restore/check")
  async restoreCheck() {
    const state = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    return { allowed: !state?.setup_complete };
  }

  @Post("restore/start")
  @UseGuards(RestoreThrottleGuard)
  async restoreStart(@Body() body: RestoreInput) {
    return this.restore.startRestore(body);
  }

  @Get("restore/:jobId")
  async restoreStatus(@Param("jobId") jobId: string) {
    return this.restore.status(jobId);
  }

  @Post("restore/:jobId/snapshot")
  @UseGuards(RestoreThrottleGuard)
  async restoreSnapshot(@Param("jobId") jobId: string, @Body() body: { target: RestoreInput["target"]; schoolId: string; phrase: string }) {
    if (!body.target || !body.schoolId || !body.phrase) throw new BadRequestException("Paramètres de restauration incomplets.");
    await this.restore.applySnapshot(jobId, body.target, body.schoolId, body.phrase);
    return { ok: true };
  }

  @Post("restore/:jobId/replay")
  @UseGuards(RestoreThrottleGuard)
  async restoreReplay(@Param("jobId") jobId: string, @Body() body: { target: RestoreInput["target"]; schoolId: string; phrase: string }) {
    if (!body.target || !body.schoolId || !body.phrase) throw new BadRequestException("Paramètres de restauration incomplets.");
    return this.restore.replayEvents(jobId, body.target, body.schoolId, body.phrase);
  }

  @Post("restore/:jobId/finish")
  @UseGuards(RestoreThrottleGuard)
  async restoreFinish(@Param("jobId") jobId: string, @Body() body: { target: RestoreInput["target"]; schoolId: string; phrase: string }) {
    if (!body.target || !body.schoolId || !body.phrase) throw new BadRequestException("Paramètres de restauration incomplets.");
    return this.restore.finishRestore(jobId, body.target, body.schoolId, body.phrase);
  }

  @Post("restore/:jobId/cancel")
  @UseGuards(RestoreThrottleGuard)
  async restoreCancel(@Param("jobId") jobId: string) {
    await this.restore.cancel(jobId);
    return { ok: true };
  }
}