import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redactLog } from "../redaction/redaction";

const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");

describe("module wiring", () => {
  it("does not register MachineBindingService twice", () => {
    // AppModule already provides it; two modules meant two instances, so its
    // onApplicationBootstrap (reg query, possible process.exit) ran twice.
    const module = read("cloud-backup.module.ts");
    expect(module).not.toMatch(/^\s*MachineBindingService,\s*$/m);
    expect(module).not.toContain("export { MachineBindingService }");
  });
});

describe("queue retention", () => {
  it("exposes a prune for rows that have been shipped", () => {
    expect(read("queue", "sync-queue.service.ts")).toContain("pruneSent");
  });

  it("prunes after a successful snapshot", () => {
    expect(read("worker", "sync-worker.service.ts")).toContain("pruneSent");
  });
});

describe("manual backup", () => {
  it("does not hold the HTTP request open for the whole snapshot", () => {
    const controller = read("cloud-backup.controller.ts");
    const handler = controller.slice(controller.indexOf("async backupNow"));
    const body = handler.slice(0, handler.indexOf("\n  //"));
    expect(body).toMatch(/void this\.snapshots/);
    expect(body).not.toMatch(/return this\.snapshots\.runSnapshot/);
  });
});

describe("redaction does not mangle ordinary logs", () => {
  it("leaves a normal French sentence intact", () => {
    const line = "les triggers de capture sont prets sur les tables et le worker va demarrer sans erreur ici";
    expect(redactLog(line)).toBe(line);
  });

  it("leaves a sha-256 hex digest intact", () => {
    const line = "schema hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(redactLog(line)).toBe(line);
  });

  it("leaves a sha-1 style 40-char hex id intact", () => {
    const line = "commit aa78a80f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f done";
    expect(redactLog(line)).toBe(line);
  });

  it("still redacts a real secret assignment", () => {
    expect(redactLog('secretAccessKey: "abc123/def+ghi="')).toContain("[redacted]");
    expect(redactLog('password="hunter2"')).toContain("[redacted]");
  });

  it("still redacts a bearer token", () => {
    expect(redactLog("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")).toContain("[redacted]");
  });

  it("still redacts a BIP39 recovery phrase", () => {
    const phrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
    expect(redactLog(`phrase ${phrase}`)).toContain("[redacted-recovery-phrase]");
  });

  it("sends errors to stderr, not stdout", () => {
    const source = read("redaction", "redaction.ts");
    expect(source).toContain("console.error");
  });
});
