import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";

/**
 * Gateway for the whole API: every request carries the install's `x-api-key`
 * unless its route is key-free below.
 *
 * Why a static key on top of the JWT session: the session cookie proves *who*
 * is calling, the key proves the call comes from *this school's own portal*.
 * Direct browsing, curl and cross-site requests (a custom header forces a
 * CORS preflight the API never passes) are refused before any handler runs.
 * The key is a build-time constant shipped to the browser, so it is a gate,
 * not a secret — session cookies remain the real authentication.
 *
 * Key-free routes are exactly the ones a browser can hit without our JS:
 * health, the login/refresh/logout trio, the public update check, the login
 * screen's branding reads, and the OAuth callbacks (external providers
 * redirect there; their one-time `state` is the auth).
 *
 * Setup gate: with no `SCHOOL_NAME` the install has not been through the
 * first-run wizard yet, so there is nothing to serve — everything but health
 * answers 503 until the wizard writes `.env`.
 */
const FREE_EXACT = new Set([
  "GET /api/health",
  "POST /api/auth/login",
  "POST /api/auth/refresh",
  "POST /api/auth/logout",
  "GET /api/updates",
  "GET /api/updates/progress",
  "GET /api/system-settings",
  "GET /api/financial/settings/logo",
]);

const FREE_PREFIX = ["GET /api/cloud-backup/oauth/", "GET /api/cloud-backup/restore/oauth/"];

export const API_KEY_HEADER = "x-api-key";

let warnedMissingKey = false;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest();
    const route = `${request.method} ${request.path}`;

    if (FREE_EXACT.has(route) || FREE_PREFIX.some((prefix) => route.startsWith(prefix))) return true;

    if (!process.env.SCHOOL_NAME?.trim()) {
      throw new HttpException(
        { message: "Installation incomplète — lancez l'assistant de configuration.", code: "SETUP_REQUIRED" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const expected = process.env.API_KEY?.trim();
    if (!expected) {
      if (!warnedMissingKey) {
        warnedMissingKey = true;
        this.logger.error(
          "API_KEY is missing from apps/backend/.env — refusing all keyed routes until it is set. " +
            "Fresh installs get one from the setup wizard; older ones from the launcher backfill.",
        );
      }
      throw new HttpException(
        { message: "API non configurée — clé API manquante côté serveur.", code: "API_KEY_NOT_CONFIGURED" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const header = request.headers?.[API_KEY_HEADER];
    const presented = Array.isArray(header) ? header[0] : header;
    if (typeof presented !== "string" || presented !== expected) {
      throw new HttpException(
        { message: "Clé API manquante ou invalide.", code: "INVALID_API_KEY" },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }
}
