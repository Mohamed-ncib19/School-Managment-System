import { redactLog, redactLogError } from "../redaction/redaction";

describe("redactLog", () => {
  it("redacts AWS access key ids", () => {
    const out = redactLog("connection failed with AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain("[redacted-akid]");
  });

  it("redacts JSON secret values", () => {
    const out = redactLog('{"secret_access_key":"superSecretValue123","endpoint":"https://x"}');
    expect(out).not.toContain("superSecretValue123");
    expect(out).toContain("[redacted]");
  });

  it("redacts the recovery phrase", () => {
    const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const out = redactLog(`phrase de récupération: ${phrase}`);
    expect(out).not.toContain(phrase);
    expect(out).toContain("[redacted-recovery-phrase]");
  });

  it("redacts Bearer tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = redactLog(`Authorization: Bearer ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("[redacted]");
  });

  it("leaves normal log text intact", () => {
    const out = redactLog("L'élève Amine a été enregistré avec succès.");
    expect(out).toContain("Amine");
  });

  it("redacts error objects through redactLogError", () => {
    const out = redactLogError(new Error("invalid password: TOKEN12345"));
    expect(out).toContain("[redacted]");
  });
});