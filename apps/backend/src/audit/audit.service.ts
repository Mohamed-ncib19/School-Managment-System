import { Injectable, Logger } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, SQL } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { auditLogs, users } from "../db/schema";
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

/** How long the audit filter dropdowns may lag a brand-new action type. */
const FILTER_OPTIONS_TTL_MS = 60_000;

interface FilterOptions {
  actions: string[];
  entityTypes: string[];
  actors: { id: string; full_name: string; email: string }[];
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private filterOptionsCache: { value: FilterOptions; expiresAt: number } | null = null;

  constructor(private readonly db: DbService) {}

  /**
   * Strips secrets and makes the value safe for a JSONB column (Date and
   * Decimal do not survive JSON.stringify unaided).
   */
  private sanitize(value: unknown): Record<string, unknown> | null | undefined {
    if (value === null || value === undefined) return undefined;

    const walk = (input: unknown, depth: number): unknown => {
      if (input === null || input === undefined) return null;
      if (depth > 6) return "[truncated]";

      if (input instanceof Date) return input.toISOString();
      if (typeof input === "bigint") return input.toString();
      if (typeof input === "object" && input !== null && "toFixed" in (input as any) && "d" in (input as any)) {
        // decimal.js Money - keep full precision as a string.
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
      return walked as Record<string, unknown>;
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
      await this.db.client.insert(auditLogs).values({
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

    const conditions: SQL[] = [];

    // The UI groups payments under "payment" while rows are stored as
    // "student_payment", and importer rows use the plural "students".
    if (entityType) {
      const aliases: Record<string, string[]> = {
        payment: ["student_payment", "payment"],
        student: ["student", "students"],
      };
      const values = aliases[entityType] ?? [entityType];
      conditions.push(
        values.length > 1 ? inArray(auditLogs.entity_type, values) : eq(auditLogs.entity_type, values[0]),
      );
    }

    if (action) conditions.push(ilike(auditLogs.action, `%${action}%`));
    if (actorUserId) conditions.push(eq(auditLogs.actor_user_id, actorUserId));

    if (from) {
      const parsed = new Date(from);
      if (!isNaN(parsed.getTime())) conditions.push(gte(auditLogs.created_at, parsed));
    }
    if (to) {
      const parsed = new Date(to);
      // A bare date means "through the end of that day".
      if (!isNaN(parsed.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) parsed.setHours(23, 59, 59, 999);
        conditions.push(lte(auditLogs.created_at, parsed));
      }
    }

    if (search && search.trim()) {
      const term = search.trim();
      const searchGroups: SQL[] = [
        ilike(auditLogs.action, `%${term}%`),
        ilike(auditLogs.entity_type, `%${term}%`),
        ilike(auditLogs.entity_label, `%${term}%`),
        ilike(auditLogs.actor_label, `%${term}%`),
        ilike(auditLogs.ip_address, `%${term}%`),
      ];
      // Actor matches resolve through the joined users table. An empty match
      // list must render as a false branch, not an invalid `IN ()`.
      const actorMatches = (
        await this.db.client
          .select({ id: users.id })
          .from(users)
          .where(or(ilike(users.full_name, `%${term}%`), ilike(users.email, `%${term}%`)))
      ).map((u) => u.id);
      searchGroups.push((actorMatches.length > 0 ? inArray(auditLogs.actor_user_id, actorMatches) : sql`FALSE`) as SQL);
      conditions.push(or(...searchGroups) as SQL);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const sortable = SORTABLE.has(params.sortBy ?? "") ? params.sortBy! : "created_at";
    const sortDir = params.sortDir === "asc" ? asc : desc;
    const sortCol =
      sortable === "action"
        ? auditLogs.action
        : sortable === "entity_type"
          ? auditLogs.entity_type
          : auditLogs.created_at;

    const rows = await this.db.client
      .select({
        id: auditLogs.id,
        actorUserId: auditLogs.actor_user_id,
        action: auditLogs.action,
        entityType: auditLogs.entity_type,
        entityId: auditLogs.entity_id,
        meta: auditLogs.meta,
        createdAt: auditLogs.created_at,
        actorLabel: auditLogs.actor_label,
        actorRole: auditLogs.actor_role,
        entityLabel: auditLogs.entity_label,
        prevValues: auditLogs.prev_values,
        newValues: auditLogs.new_values,
        ipAddress: auditLogs.ip_address,
        userAgent: auditLogs.user_agent,
        actorId: users.id,
        actorFullName: users.full_name,
        actorEmail: users.email,
        actorRoleJoin: users.role,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actor_user_id))
      .where(where)
      .orderBy(sortDir(sortCol))
      .limit(limit)
      .offset((page - 1) * limit);

    const [countRow] = await this.db.client
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where ?? sql`true`);
    const total = countRow.count;

    const data = rows.map(({ actorId, actorFullName, actorEmail, actorRoleJoin, ...rest }) => ({
      ...rest,
      actor: !actorId
        ? null
        : { id: actorId, full_name: actorFullName, email: actorEmail, role: actorRoleJoin },
    }));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * Distinct actions and actors, so the UI can offer real filter options.
   *
   * Cached, because the question is expensive in a way its answer does not
   * justify: two `SELECT DISTINCT` passes over the whole audit trail plus every
   * user, to produce a few dozen strings that change only when a new kind of
   * action is performed for the first time. `audit_logs` also grows on every
   * mutating request, so this is the one read here whose cost climbs with use
   * rather than with the size of the school.
   *
   * A minute of staleness costs a brand-new action type a moment before it
   * appears in the dropdown; the rows themselves are never filtered by this.
   */
  async listFilterOptions() {
    const hit = this.filterOptionsCache;
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = await this.computeFilterOptions();
    this.filterOptionsCache = { value, expiresAt: Date.now() + FILTER_OPTIONS_TTL_MS };
    return value;
  }

  private async computeFilterOptions() {
    const [actions, entityTypes, actors] = await Promise.all([
      this.db.client.selectDistinct({ action: auditLogs.action }).from(auditLogs).orderBy(asc(auditLogs.action)),
      this.db.client
        .selectDistinct({ entity_type: auditLogs.entity_type })
        .from(auditLogs)
        .orderBy(asc(auditLogs.entity_type)),
      this.db.client
        .select({ id: users.id, full_name: users.full_name, email: users.email })
        .from(users)
        .orderBy(asc(users.full_name)),
    ]);

    return {
      actions: actions.map((a) => a.action),
      entityTypes: entityTypes.map((e) => e.entity_type),
      actors,
    };
  }
}