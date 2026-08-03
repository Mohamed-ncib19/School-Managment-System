import { Injectable, Logger } from "@nestjs/common";
import { system_settings } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UpdateSystemSettingsDto } from "./dto/system-settings.dto";

const SINGLETON = "global";

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
  private cached: system_settings | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<system_settings> {
    if (this.cached) return this.cached;

    // The migration seeds this row and a CHECK constraint keeps it unique, so
    // the upsert is belt-and-braces for a database restored from an older dump.
    const settings = await this.prisma.system_settings.upsert({
      where: { singleton: SINGLETON },
      update: {},
      create: { singleton: SINGLETON },
    });

    this.cached = settings;
    return settings;
  }

  async update(dto: UpdateSystemSettingsDto, userId: string): Promise<system_settings> {
    const existing = await this.get();

    const updated = await this.prisma.system_settings.update({
      where: { singleton: SINGLETON },
      data: {
        ...(dto.system_name !== undefined && { system_name: dto.system_name }),
        ...(dto.features !== undefined && { features: dto.features }),
      },
    });

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

  private auditable(settings: system_settings): Record<string, unknown> {
    return {
      system_name: settings.system_name,
      features: settings.features,
    };
  }
}
