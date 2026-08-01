import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request audit context.
 *
 * Services deep in the call stack need the acting administrator, their IP and
 * their user agent, but threading those through every service signature means
 * every new method is one forgotten parameter away from an unattributed log
 * entry. AsyncLocalStorage carries them implicitly for the life of the request.
 *
 * `logged` is how the safety-net interceptor knows whether a handler already
 * wrote a meaningful entry, so automatic coverage never duplicates an explicit,
 * richer log.
 */
export interface AuditContext {
  actorId: string | null;
  actorLabel: string | null;
  actorRole: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  method: string;
  path: string;
  logged: boolean;
}

export const auditStorage = new AsyncLocalStorage<AuditContext>();

export const getAuditContext = (): AuditContext | undefined => auditStorage.getStore();

export function runWithAuditContext<T>(context: AuditContext, fn: () => T): T {
  return auditStorage.run(context, fn);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The audit columns are `uuid`, so anything that is not one has to become NULL
 * rather than reach Postgres. Passing the literal strings 'system' and
 * 'unknown' is what previously made the insert throw and turned every failed
 * login into an HTTP 500.
 */
export const asUuidOrNull = (value: unknown): string | null =>
  typeof value === "string" && UUID_RE.test(value) ? value : null;
