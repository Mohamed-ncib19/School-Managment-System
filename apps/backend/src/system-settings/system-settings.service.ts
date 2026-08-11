import { Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { systemSettings } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { UpdateSystemSettingsDto } from "./dto/system-settings.dto";

const SINGLETON = "global";

type SystemSettingsRow = typeof systemSettings.$inferSelect;

/**
 * The school's system configuration: display name and per-module feature
 * toggles.
 *
 * Read on every navigation render (sidebar, login screen, browser title), so
 * the row is cached in memory and invalidated on write. It changes rarely.
 *
 * The GET route is public on purpose — the login screen and the browser tab
 * render before any token exists — and it holds nothing secret: a display
 * name and a few booleans.
 */
@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);
  private cached: SystemSettingsRow | null = null;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<SystemSettingsRow> {
    if (this.cached) return this.cached;

    let settings = await this.db.client.query.systemSettings.findFirst({
      where: eq(systemSettings.singleton, SINGLETON),
    });
    if (!settings) {
      // The migration seeds this row and a CHECK constraint keeps it unique, so
      // the fallback insert is belt-and-braces for a database restored from an
      // older dump. updated_at is passed explicitly: older databases have no
      // default on it.
      await this.db.client
        .insert(systemSettings)
        .values({ singleton: SINGLETON, updated_at: new Date() })
        .onConflictDoNothing();
      settings = await this.db.client.query.systemSettings.findFirst({
        where: eq(systemSettings.singleton, SINGLETON),
      });
    }

    this.cached = settings!;
    return settings!;
  }

  async update(dto: UpdateSystemSettingsDto, userId: string): Promise<SystemSettingsRow> {
    const existing = await this.get();

    const [updated] = await this.db.client
      .update(systemSettings)
      .set({
        ...(dto.system_name !== undefined && { systemName: dto.system_name }),
        ...(dto.features !== undefined && { features: dto.features }),
        // Empty input clears the field: the school falls back to the default channel.
        ...(dto.support_email !== undefined && {
          supportEmail: dto.support_email.trim() || null,
        }),
        ...(dto.support_phone !== undefined && {
          supportPhone: dto.support_phone.trim() || null,
        }),
        ...(dto.support_whatsapp !== undefined && {
          supportWhatsapp: dto.support_whatsapp.trim() || null,
        }),
      })
      .where(eq(systemSettings.singleton, SINGLETON))
      .returning();

    this.cached = updated;

    await this.audit.record({
      action: "system.settings_updated",
      entityType: "system_settings",
      entityId: null,
      entityLabel: "System settings",
      actorId: userId,
      prevValues: this.auditable(existing),
      newValues: this.auditable(updated),
    });

    return updated;
  }

  /** Drops the cache — for tests and for the seed script. */
  invalidate(): void {
    this.cached = null;
  }

  private auditable(settings: SystemSettingsRow): Record<string, unknown> {
    return {
      system_name: settings.system_name,
      features: settings.features,
      support_email: settings.support_email,
      support_phone: settings.support_phone,
      support_whatsapp: settings.support_whatsapp,
    };
  }
}