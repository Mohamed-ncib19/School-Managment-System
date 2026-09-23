import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  InstanceRegistryService,
  latestPerInstance,
  ACTIVE_TTL_MS,
} from "../registry/instance-registry.service";
import { MemoryDriver } from "./support/memory-driver";

const SCHOOL = "ecole-test";

describe("instance registry", () => {
  it("lets a single instance claim cleanly", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    const result = await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    expect(result.ok).toBe(true);
    expect(result.conflict).toBeNull();
  });

  it("detects a second live instance", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    const second = await registry.claim(driver, SCHOOL, "uuid-b", "poste-b");
    expect(second.ok).toBe(false);
    expect(second.conflict?.instance_uuid).toBe("uuid-a");
  });

  it("rewrites the registry object on every claim (WebDAV overwrite path)", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    // Two writes to the same key must both succeed. write() used to omit the
    // overwrite flag, and WebDAV's put defaults to overwrite:false — so the
    // registry could never be updated after its first claim on that driver.
    expect(driver.putCount.get(registry.key(SCHOOL))).toBe(2);
  });

  it("heals a stale same-host identity instead of crying split-brain", async () => {
    // Re-key/reconnect mints a new UUID on the SAME machine: the previous
    // boot's claim is still live, same hostname. The host is checked first —
    // retire the stale self and proceed, no human resolve needed.
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-old", "DESKTOP-CC0IE27");
    const again = await registry.claim(driver, SCHOOL, "uuid-new", "desktop-cc0ie27");
    expect(again.ok).toBe(true);
    expect(again.conflict).toBeNull();
    const stored = await registry.read(driver, SCHOOL);
    expect(stored?.instances.filter((i) => i.instance_uuid === "uuid-old").pop()?.status).toBe("retired");
    // ...while a genuinely different host still raises the conflict screen.
    const rival = await registry.claim(driver, SCHOOL, "uuid-rival", "AUTRE-PC");
    expect(rival.ok).toBe(false);
    expect(rival.conflict?.instance_uuid).toBe("uuid-new");
  });

  it("a retired instance never conflicts", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    await registry.retire(driver, SCHOOL, "uuid-a");
    const second = await registry.claim(driver, SCHOOL, "uuid-b", "poste-b");
    expect(second.conflict).toBeNull();
  });

  it("ignores a claim whose heartbeat lapsed, so a dead machine unblocks", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    // Seed a registry whose only active record is far older than the TTL.
    const stale = new Date(Date.now() - ACTIVE_TTL_MS - 60_000).toISOString();
    await driver.put(
      registry.key(SCHOOL),
      require("node:stream").Readable.from([
        Buffer.from(
          JSON.stringify({
            school_id: SCHOOL,
            instances: [
              { instance_uuid: "dead", hostname: "vieux", claimed_at: stale, status: "active" },
            ],
          }),
          "utf8",
        ),
      ]),
      undefined,
      { overwrite: true },
    );

    const result = await registry.claim(driver, SCHOOL, "uuid-new", "poste-neuf");
    expect(result.conflict).toBeNull();
    expect(result.ok).toBe(true);
  });

  it("keeps the latest record per instance uuid", () => {
    const older = new Date(Date.now() - 10_000).toISOString();
    const newer = new Date().toISOString();
    const latest = latestPerInstance([
      { instance_uuid: "a", hostname: "h", claimed_at: older, status: "active" },
      { instance_uuid: "a", hostname: "h", claimed_at: newer, status: "retired" },
    ]);
    expect(latest).toHaveLength(1);
    expect(latest[0].status).toBe("retired");
  });
});

describe("restore honours the conflict it is handed", () => {
  it("finishRestore checks claim().conflict before adopting the state", () => {
    const source = readFileSync(join(__dirname, "..", "restore", "restore.service.ts"), "utf8");
    const finish = source.slice(source.indexOf("async finishRestore"));
    const body = finish.slice(0, finish.indexOf("\n  private"));
    // The old code called claim() and discarded the result entirely, so a
    // restore onto a second live machine created split-brain AND marked this
    // install complete. The check must run before the state is written.
    expect(body).toMatch(/claim\.conflict/);
    expect(body.indexOf("const claim = await this.registry.claim")).toBeLessThan(
      body.indexOf("update(cloudState)"),
    );
    expect(body.indexOf("claim.conflict")).toBeLessThan(body.indexOf("update(cloudState)"));
  });
});
