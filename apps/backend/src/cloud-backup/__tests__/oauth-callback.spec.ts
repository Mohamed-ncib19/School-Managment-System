import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTROLLER = readFileSync(join(__dirname, "..", "cloud-backup.controller.ts"), "utf8");
const MAIN = readFileSync(join(__dirname, "..", "..", "main.ts"), "utf8");

/**
 * Source-level guards. Exercising the real callback needs a live Google token
 * exchange; what actually matters is that a long-lived credential is never
 * posted to a wildcard origin, and that is visible in the source.
 */
describe("gdrive OAuth callback", () => {
  it("never posts a message to the wildcard origin", () => {
    expect(CONTROLLER).not.toMatch(/postMessage\([^;]*,\s*["']\*["']\s*\)/);
  });

  it("targets an origin derived from the flow's own redirect URI", () => {
    expect(CONTROLLER).toContain("appOrigin");
    // safeOrigin() derives the postMessage target from the pending handshake's
    // own redirect URI and falls back to "null" (opaque origin) — never "*".
    expect(CONTROLLER).toContain("safeOrigin");
    expect(CONTROLLER).toContain('return redirectUri ? new URL(redirectUri).origin : "null";');
    expect(CONTROLLER).not.toContain('postMessage(' + "${JSON.stringify(payload)},\"*\")");
  });

  it("expires abandoned OAuth handshakes so client secrets do not linger", () => {
    expect(CONTROLLER).toContain("createdAt");
  });
});

describe("HTTP hardening", () => {
  it("uses the anchored origin policy rather than an inline regex", () => {
    expect(MAIN).toContain("isAllowedOrigin");
    expect(MAIN).not.toMatch(/origin:\s*\/http/);
  });

  it("installs helmet", () => {
    expect(MAIN).toContain("helmet(");
  });

  it("does not publish swagger unconditionally in production", () => {
    expect(MAIN).toMatch(/NODE_ENV !== "production"|ENABLE_API_DOCS/);
  });
});
