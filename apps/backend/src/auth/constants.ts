import { randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";

/**
 * Token signing configuration.
 *
 * `JWT_SECRET` and `JWT_REFRESH_SECRET` used to fall back to two string
 * literals committed to this repository. That is a fail-open: an install whose
 * `.env` did not load — a clobbered file, a hand-run `pnpm dev` that skipped
 * the "fill in the secrets" step — booted with no complaint and signed
 * `super_admin` sessions with a value anyone reading the source already knows,
 * so a token could simply be forged.
 *
 * The fallback is now a per-process random secret instead. The half-configured
 * install still boots, which is what the fallback was for, but the worst case
 * degrades from "anyone can mint an admin session" to "sessions do not survive
 * a restart" — a failure that announces itself to the operator instead of
 * hiding from them. The warning is emitted once, at first use, so it lands in
 * the same log the launcher already captures.
 */
const logger = new Logger("AuthConstants");

/** Cached so every call within a process signs and verifies with one value. */
const generated = new Map<string, string>();

function requiredSecret(name: string): string {
  const configured = process.env[name]?.trim();
  if (configured) return configured;

  let secret = generated.get(name);
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    generated.set(name, secret);
    logger.warn(
      `${name} is not set — falling back to a random secret generated for this process. ` +
        "Sessions will be invalidated on every restart. Set it in apps/backend/.env: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return secret;
}

export const JWT_SECRET = () => requiredSecret("JWT_SECRET");
export const JWT_EXPIRES_IN = () => process.env.JWT_EXPIRES_IN ?? "7d";
export const JWT_REFRESH_SECRET = () => requiredSecret("JWT_REFRESH_SECRET");
export const JWT_REFRESH_EXPIRES_IN = () => process.env.JWT_REFRESH_EXPIRES_IN ?? "30d";
