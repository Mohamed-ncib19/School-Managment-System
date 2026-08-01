import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { getAuditContext, asUuidOrNull } from "./audit-context";

/** A single administrative action worth recording. */
export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  /** State before the change - omit for creates. */
  prevValues?: Record<string, unknown> | null;
  /** State after the change - omit for deletes. */
  newValues?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  /** Overrides the acting user from the request context (e.g. failed logins). */
  actorId?: string | null;
  actorLabel?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ListLogsParams {
  page: number;
  limit: number;
  entityType?: string;
  action?: string;
  actorUserId?: string;
  /** Free-text across action, entity, actor name/email and the target label. */
  search?: string;
  from?: string;
  to?: string;
  sortBy?: "created_at" | "action" | "entity_type";
  sortDir?: "asc" | "desc";
}

/** Columns a client is allowed to sort by - never interpolate user input. */
const SORTABLE = new Set(["created_at", "action", "entity_type"]);

/**
 * Sensitive keys are never written to the audit trail. The log records that a
 * password changed, not what it changed to.
 */
const REDACTED_KEYS = new Set([
  "password",
  "password_hash",
  "current_password",
  "new_password",
  "confirm_password",
  "token",
  "access_token",
  "refresh_token",
  "reset_token",
  "authorization",
  "secret",
]);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Strips secrets and makes the value safe for a JSONB column (Decimal, Date
   * and BigInt do not survive JSON.stringify unaided).
   */
  private sanitize(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === null || value === undefined) return undefined;

    const walk = (input: unknown, depth: number): unknown => {
      if (input === null || input === undefined) return null;
      if (depth > 6) return "[truncated]";

      if (input instanceof Date) return input.toISOString();
      if (typeof input === "bigint") return input.toString();
      if (typeof input === "object" && input !== null && "toFixed" in (input as any) && "d" in (input as any)) {
        // Prisma.Decimal - keep full precision as a string.
        return String(input);
      }
      if (Array.isArray(input)) return input.slice(0, 200).map((item) => walk(item, depth + 1));

      if (typeof input === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
          out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : walk(val, depth + 1);
        }
        return out;
      }
      return input;
    };

    try {
      const walked = walk(value, 0);
      if (walked === null || walked === undefined) return undefined;
      return walked as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }

  /**
   * Writes one audit entry.
   *
   * Auditing must never break the operation it is describing: a failure here is
   * logged loudly and swallowed, so a full audit table or a bad payload cannot
   * turn a successful save into a 500 for the administrator.
   */
  async record(entry: AuditEntry): Promise<void> {
    const ctx = getAuditContext();

    try {
      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: asUuidOrNull(entry.actorId ?? ctx?.actorId ?? null),
          actor_label: entry.actorLabel ?? ctx?.actorLabel ?? null,
          actor_role: entry.actorRole ?? ctx?.actorRole ?? null,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: asUuidOrNull(entry.entityId),
          entity_label: entry.entityLabel ?? null,
          prev_values: this.sanitize(entry.prevValues),
          new_values: this.sanitize(entry.newValues),
          ip_address: entry.ipAddress ?? ctx?.ipAddress ?? null,
          user_agent: entry.userAgent ?? ctx?.userAgent ?? null,
          meta: this.sanitize(entry.meta),
        },
      });
      if (ctx) ctx.logged = true;
    } catch (err) {
      this.logger.error(
        `Failed to write audit entry "${entry.action}" for ${entry.entityType}/${entry.entityId ?? "-"}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Positional form kept for the existing call sites across the services.
   * Prefer `record()` for new code - it carries prev/new values.
   */
  async createLog(
    actorUserId: string | null | undefined,
    action: string,
    entityType: string,
    entityId: string | null | undefined,
    meta?: any,
  ): Promise<void> {
    await this.record({
      action,
      entityType,
      entityId,
      actorId: actorUserId ?? null,
      actorLabel: asUuidOrNull(actorUserId) ? null : (actorUserId ?? null),
      meta,
    });
  }

  async listLogs(params: ListLogsParams) {
    const { page, limit, entityType, action, actorUserId, search, from, to } = params;

    const where: Prisma.audit_logsWhereInput = {};

    // The UI groups payments under "payment" while rows are stored as
    // "student_payment", and importer rows use the plural "students".
    if (entityType) {
      const aliases: Record<string, string[]> = {
        payment: ["student_payment", "payment"],
        student: ["student", "students"],
      };
      const values = aliases[entityType] ?? [entityType];
      where.entity_type = values.length > 1 ? { in: values } : values[0];
    }

    if (action) where.action = { contains: action, mode: "insensitive" };
    if (actorUserId) where.actor_user_id = actorUserId;

    if (from || to) {
      where.created_at = {};
      if (from) {
        const parsed = new Date(from);
        if (!isNaN(parsed.getTime())) where.created_at.gte = parsed;
      }
      if (to) {
        const parsed = new Date(to);
        // A bare date means "through the end of that day".
        if (!isNaN(parsed.getTime())) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(to)) parsed.setHours(23, 59, 59, 999);
          where.created_at.lte = parsed;
        }
      }
    }

    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { action: { contains: term, mode: "insensitive" } },
        { entity_type: { contains: term, mode: "insensitive" } },
        { entity_label: { contains: term, mode: "insensitive" } },
        { actor_label: { contains: term, mode: "insensitive" } },
        { ip_address: { contains: term, mode: "insensitive" } },
        { actor: { is: { full_name: { contains: term, mode: "insensitive" } } } },
        { actor: { is: { email: { contains: term, mode: "insensitive" } } } },
      ];
    }

    const sortBy = SORTABLE.has(params.sortBy ?? "") ? params.sortBy! : "created_at";
    const sortDir = params.sortDir === "asc" ? "asc" : "desc";

    const [data, total] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where,
        include: { actor: { select: { id: true, full_name: true, email: true, role: true } } },
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.audit_logs.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Distinct actions and actors, so the UI can offer real filter options. */
  async listFilterOptions() {
    const [actions, entityTypes, actors] = await Promise.all([
      this.prisma.audit_logs.findMany({
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
      }),
      this.prisma.audit_logs.findMany({
        distinct: ["entity_type"],
        select: { entity_type: true },
        orderBy: { entity_type: "asc" },
      }),
      this.prisma.users.findMany({
        select: { id: true, full_name: true, email: true },
        orderBy: { full_name: "asc" },
      }),
    ]);

    return {
      actions: actions.map((a) => a.action),
      entityTypes: entityTypes.map((e) => e.entity_type),
      actors,
    };
  }
}
