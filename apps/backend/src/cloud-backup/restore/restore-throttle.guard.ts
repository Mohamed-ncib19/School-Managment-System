import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";

/**
 * Rate limit for the unauthenticated restore endpoints.
 *
 * `startRestore` runs a 64 MiB Argon2id derivation before it can reject a
 * wrong phrase, so an unthrottled caller can exhaust a school PC's memory
 * with a handful of concurrent requests. The window is deliberately small and
 * in-process: this protects one machine serving one school, and it must not
 * depend on Redis or anything else the install does not already have.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const MAX_TRACKED_CALLERS = 1_000;

@Injectable()
export class RestoreThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest();
    const caller = String(request.ip ?? request.socket?.remoteAddress ?? "unknown");
    const now = Date.now();

    const recent = (this.hits.get(caller) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      this.hits.set(caller, recent);
      throw new HttpException(
        "Trop de tentatives de restauration. Patientez une minute avant de réessayer.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(caller, recent);

    // Bound the map so a spray of forged source addresses cannot grow it.
    if (this.hits.size > MAX_TRACKED_CALLERS) {
      for (const [key, times] of this.hits) {
        if (times.every((at) => now - at >= WINDOW_MS)) this.hits.delete(key);
      }
    }
    return true;
  }
}
