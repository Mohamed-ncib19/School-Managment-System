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
import {
  DRIVER_DEFINITIONS,
  DriverConfigRecord,
  createDriver,
  driverFields,
  isRecommended,
  driverSetupHelp,
} from "./drivers/driver-registry";
import { appGoogleOAuth, hasAppGoogleOAuth, withAppGoogleOAuth } from "./drivers/google-oauth-app";
import { appDropbox, hasAppDropbox, withAppDropbox } from "./drivers/dropbox-app";
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
      // Free, no card, under a minute — shown on the first screen. Google
      // Drive qualifies only when this server actually has an OAuth client.
      recommended: isRecommended(d),
      freeTier: d.freeTier ?? null,
      // Where to click in the provider's own site to get these values.
      setupHelp: driverSetupHelp(d),
      // True when the admin can connect in one click and type nothing at all.
      oauthReady:
        d.id === "gdrive" ? hasAppGoogleOAuth() : d.id === "dropbox" ? hasAppDropbox() : false,
      fields: driverFields(d).map((f) => ({
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

  /**
   * Completes a driver config with what the customer should not have to type.
   *
   * For Google Drive that is the app's own OAuth client credentials — the
   * administrator only ever supplies a refresh token, by clicking "Se
   * connecter avec Google". The school namespace is NOT stamped here: the
   * wizard configures a destination before the school id exists, so the
   * driver derives it from the object key instead.
   */
  private prepareConfig(driverId: string, config: Record<string, string>): Record<string, string> {
    if (driverId === "gdrive") return withAppGoogleOAuth(config);
    if (driverId === "dropbox") return withAppDropbox(config);
    return config;
  }

  @Post("targets")
  @UseGuards(JwtAuthGuard)
  async createTarget(@Body() body: TargetBody) {
    if (!body.driverId || !body.config) throw new BadRequestException("Paramètres de destination incomplets.");
    const def = DRIVER_DEFINITIONS.find((d) => d.id === body.driverId);
    if (!def) throw new BadRequestException("Type de destination inconnu.");

    // Fills in the app's Google OAuth client, so the browser never sent one.
    const config = this.prepareConfig(body.driverId, body.config);

    // Test the connection before persisting anything.
    const driver = createDriver({ driver: body.driverId, config } as DriverConfigRecord);
    try {
      await driver.testConnection();
    } catch (err) {
      throw new BadRequestException(`Connexion impossible : ${redactLogError(err)}`);
    }

    const configRef = randomUUID();
    await this.creds.save(configRef, JSON.stringify({ driver: body.driverId, config } as DriverConfigRecord));

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
      const config = this.prepareConfig(row.driver, body.config);
      const driver = createDriver({ driver: row.driver, config } as DriverConfigRecord);
      try {
        await driver.testConnection();
      } catch (err) {
        throw new BadRequestException(`Connexion impossible : ${redactLogError(err)}`);
      }
      configRef = randomUUID();
      await this.creds.save(configRef, JSON.stringify({ driver: row.driver, config } as DriverConfigRecord));
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

  /**
   * What to prefill the wizard with. Saves asking the administrator to invent
   * a namespace id when the install already knows the school's name.
   */
  @Get("setup/suggestion")
  @UseGuards(JwtAuthGuard)
  setupSuggestion() {
    return this.setup.suggestedSchoolId();
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
    { clientId: string; clientSecret: string; redirectUri: string; provider: "gdrive" | "dropbox"; createdAt: number }
  >();

  // --- Dropbox -------------------------------------------------------------

  @Post("oauth/dropbox/url")
  @UseGuards(JwtAuthGuard)
  dropboxUrl(@Body() body: { appKey?: string; appSecret?: string; redirectUri?: string }) {
    return this.buildDropboxConsentUrl(body);
  }

  /** The same URL from the login screen, for a restore on new hardware. */
  @Post("restore/oauth/dropbox/url")
  @UseGuards(RestoreThrottleGuard)
  async restoreDropboxUrl(@Body() body: { appKey?: string; appSecret?: string; redirectUri?: string }) {
    const state = await this.db.client.query.cloudState.findFirst({
      where: eq(cloudState.singleton, "global"),
    });
    if (state?.setup_complete) {
      throw new BadRequestException(
        "Cette installation a déjà une sauvegarde active — la connexion Dropbox de restauration est réservée à un poste neuf.",
      );
    }
    return this.buildDropboxConsentUrl(body);
  }

  private buildDropboxConsentUrl(body: { appKey?: string; appSecret?: string; redirectUri?: string }) {
    if (!body.redirectUri) throw new BadRequestException("URI de redirection requise.");

    const app = appDropbox();
    const appKey = body.appKey?.trim() || app?.appKey;
    const appSecret = body.appSecret?.trim() || app?.appSecret;
    if (!appKey || !appSecret) {
      throw new BadRequestException(
        "Aucune application Dropbox n'est configurée sur ce serveur. " +
          "Renseignez DROPBOX_APP_KEY et DROPBOX_APP_SECRET, ou saisissez vos propres identifiants.",
      );
    }

    const state = randomUUID();
    const now = Date.now();
    for (const [key, entry] of this.pendingOAuth) {
      if (now - entry.createdAt > 10 * 60_000) this.pendingOAuth.delete(key);
    }
    this.pendingOAuth.set(state, {
      clientId: appKey,
      clientSecret: appSecret,
      redirectUri: body.redirectUri,
      provider: "dropbox",
      createdAt: now,
    });

    // `token_access_type=offline` is what makes Dropbox return a refresh
    // token; without it the grant expires in four hours and the backup stops
    // silently a day later.
    const url =
      "https://www.dropbox.com/oauth2/authorize?" +
      new URLSearchParams({
        client_id: appKey,
        response_type: "code",
        token_access_type: "offline",
        redirect_uri: body.redirectUri,
        state,
      }).toString();
    return { url, state };
  }

  @Get("oauth/dropbox/callback")
  async dropboxCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const pending = state ? this.pendingOAuth.get(state) : undefined;
    this.pendingOAuth.delete(state ?? "");
    const appOrigin = pending ? new URL(pending.redirectUri).origin : "null";
    const reply = (payload: Record<string, unknown>) =>
      res
        .set("Content-Type", "text/html; charset=utf-8")
        .send(
          `<script>if(window.opener){window.opener.postMessage(${JSON.stringify(payload)},${JSON.stringify(
            appOrigin,
          )});}setTimeout(()=>window.close(),500);</script>`,
        );

    if (error || !pending || !code || pending.provider !== "dropbox") {
      reply({ type: "iq-dropbox-oauth", ok: false, error: "denied" });
      return;
    }
    try {
      const auth = Buffer.from(`${pending.clientId}:${pending.clientSecret}`).toString("base64");
      const tokenRes = await fetch("https://api.dropbox.com/oauth2/token", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: pending.redirectUri,
        }),
      });
      const text = await tokenRes.text();
      if (!tokenRes.ok) throw new Error(`Dropbox a refusé l'autorisation (${tokenRes.status}) : ${text}`);
      const tokens = JSON.parse(text) as { refresh_token?: string };
      if (!tokens.refresh_token) {
        throw new Error("Dropbox n'a pas renvoyé de jeton d'actualisation — réessayez l'autorisation.");
      }
      reply({ type: "iq-dropbox-oauth", ok: true, refreshToken: tokens.refresh_token });
    } catch (err) {
      reply({ type: "iq-dropbox-oauth", ok: false, error: redactLogError(err) });
    }
  }

  // --- Google Drive --------------------------------------------------------

  @Post("oauth/gdrive/url")
  @UseGuards(JwtAuthGuard)
  gdriveUrl(@Body() body: { clientId?: string; clientSecret?: string; redirectUri?: string }) {
    return this.buildGdriveConsentUrl(body);
  }

  /**
   * The same consent URL, reachable from the login screen during a restore.
   *
   * On new hardware there is no session, so the authenticated route above is
   * unusable — and without this the administrator would be asked to paste a
   * refresh token they have never seen, since the whole point of the app-level
   * OAuth client is that they never handle one. Safe to expose: it is allowed
   * only while this install has no backup configured (the same condition the
   * restore endpoints enforce), it is throttled like them, and the client
   * secret never leaves the server.
   */
  @Post("restore/oauth/gdrive/url")
  @UseGuards(RestoreThrottleGuard)
  async restoreGdriveUrl(@Body() body: { clientId?: string; clientSecret?: string; redirectUri?: string }) {
    const state = await this.db.client.query.cloudState.findFirst({
      where: eq(cloudState.singleton, "global"),
    });
    if (state?.setup_complete) {
      throw new BadRequestException(
        "Cette installation a déjà une sauvegarde active — la connexion Google de restauration est réservée à un poste neuf.",
      );
    }
    return this.buildGdriveConsentUrl(body);
  }

  private async buildGdriveConsentUrl(body: { clientId?: string; clientSecret?: string; redirectUri?: string }) {
    if (!body.redirectUri) {
      throw new BadRequestException("URI de redirection requise.");
    }
    // The app's own client is the normal path — the administrator types
    // nothing. Per-install credentials remain accepted for a self-hoster who
    // registered their own OAuth client.
    const app = appGoogleOAuth();
    const clientId = body.clientId?.trim() || app?.clientId;
    const clientSecret = body.clientSecret?.trim() || app?.clientSecret;
    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        "Aucun client OAuth Google n'est configuré sur ce serveur. " +
          "Renseignez GOOGLE_OAUTH_CLIENT_ID et GOOGLE_OAUTH_CLIENT_SECRET, ou saisissez vos propres identifiants.",
      );
    }
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, body.redirectUri);
    const state = randomUUID();
    // Abandoned handshakes hold a client secret in memory; sweep them.
    const now = Date.now();
    for (const [key, entry] of this.pendingOAuth) {
      if (now - entry.createdAt > 10 * 60_000) this.pendingOAuth.delete(key);
    }
    this.pendingOAuth.set(state, {
      clientId,
      clientSecret,
      redirectUri: body.redirectUri,
      provider: "gdrive",
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

    if (error || !pending || !code || pending.provider !== "gdrive") {
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