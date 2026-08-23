/**
 * Which browser origins may call this API with credentials.
 *
 * The previous policy was an unanchored regex, so any origin merely
 * CONTAINING `http://localhost:<port>` satisfied it. Anchoring is the fix;
 * `CORS_ALLOWED_ORIGINS` (comma-separated) is how a school that reaches the
 * portal over its LAN adds its own address without loosening the default.
 */
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

export function isAllowedOrigin(origin: string, configured = process.env.CORS_ALLOWED_ORIGINS ?? ""): boolean {
  if (!origin) return false;
  if (LOOPBACK.test(origin)) return true;
  return configured
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(origin);
}
