import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap, catchError } from "rxjs/operators";
import { throwError } from "rxjs";
import { AuditService } from "./audit.service";
import { AuditContext, runWithAuditContext } from "./audit-context";

/** Methods that change state and therefore must appear in the audit trail. */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Routes whose own service writes a richer entry, or which carry no
 * administrative meaning. Login is excluded because AuthService records both
 * the success and the failure with the reason.
 */
const SKIP_PATHS = [/^\/api\/auth\/login$/, /^\/api\/audit-logs/];

/** Turns /api/students/<uuid>/move into a stable "student.move" style action. */
function deriveAction(method: string, path: string): { action: string; entityType: string } {
  const parts = path.replace(/^\/api\//, "").split("/").filter(Boolean);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const entityType = (parts[0] ?? "unknown").replace(/s$/, "");
  const tail = parts.slice(1).filter((p) => !uuidRe.test(p));

  const verb =
    tail.length > 0
      ? tail.join(".")
      : { POST: "created", PUT: "updated", PATCH: "updated", DELETE: "deleted" }[method] ?? method.toLowerCase();

  return { action: `${entityType}.${verb}`, entityType };
}

/**
 * Establishes the per-request audit context and acts as a safety net.
 *
 * Explicit `auditService.record()` calls inside a handler produce the detailed
 * entry. If a state-changing request finishes without any such call, this
 * writes a generic entry from the HTTP envelope, so "every administrator action
 * is logged" holds even for endpoints nobody remembered to instrument.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== "http") return next.handle();

    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    const path: string = req.originalUrl?.split("?")[0] ?? req.url ?? "";

    const forwarded = req.headers?.["x-forwarded-for"];
    const ipAddress =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;

    const ctx: AuditContext = {
      actorId: req.user?.id ?? null,
      actorLabel: req.user?.full_name ?? req.user?.email ?? null,
      actorRole: req.user?.role ?? null,
      ipAddress,
      userAgent: req.headers?.["user-agent"] ?? null,
      method,
      path,
      logged: false,
    };

    return runWithAuditContext(ctx, () => {
      const shouldFallback =
        MUTATING.has(method) && !SKIP_PATHS.some((re) => re.test(path));

      return next.handle().pipe(
        tap(() => {
          // The guard populates req.user after this interceptor is constructed,
          // so re-read it before writing anything.
          ctx.actorId = ctx.actorId ?? req.user?.id ?? null;
          ctx.actorLabel = ctx.actorLabel ?? req.user?.full_name ?? req.user?.email ?? null;
          ctx.actorRole = ctx.actorRole ?? req.user?.role ?? null;

          if (shouldFallback && !ctx.logged) {
            const { action, entityType } = deriveAction(method, path);
            void this.audit.record({
              action,
              entityType,
              meta: { method, path, source: "auto" },
            });
          }
        }),
        catchError((err) => {
          // A rejected administrative action is itself worth recording.
          if (shouldFallback) {
            const { action, entityType } = deriveAction(method, path);
            const status = err?.status ?? err?.getStatus?.() ?? 500;
            if (status >= 400 && status !== 401) {
              void this.audit.record({
                action: `${action}_failed`,
                entityType,
                meta: { method, path, status, reason: err?.message ?? "unknown", source: "auto" },
              });
            }
          }
          return throwError(() => err);
        }),
      );
    });
  }
}
