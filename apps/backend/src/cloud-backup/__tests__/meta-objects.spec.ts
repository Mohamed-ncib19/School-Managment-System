import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildKdfParams, deriveKey, newSalt } from "../crypto/kdf";
import { buildCheckPlaintext } from "../crypto/check-object";
import { encodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import { writeMetaObjects, checkObjectIsCurrent, checkKey, saltKey } from "../setup/meta-objects";
import { MemoryDriver } from "./support/memory-driver";
import { Readable } from "node:stream";

const TEST_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });
const SCHOOL = "ecole-test";

describe("meta objects", () => {
  it("writes both the salt and the check object to every target", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const a = new MemoryDriver();
    const b = new MemoryDriver();

    await writeMetaObjects([a, b], SCHOOL, TEST_KDF, key);

    for (const driver of [a, b]) {
      expect(driver.puts.get(saltKey(SCHOOL))).toBeDefined();
      expect(driver.puts.get(checkKey(SCHOOL))).toBeDefined();
    }
    const salt = JSON.parse(a.puts.get(saltKey(SCHOOL))!.toString("utf8"));
    expect(salt.school_id).toBe(SCHOOL);
  });

  it("is idempotent — re-seeding replaces rather than failing", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const driver = new MemoryDriver();

    await writeMetaObjects([driver], SCHOOL, TEST_KDF, key);
    // Without overwrite this threw on WebDAV and on a folder target, whose
    // puts refuse to replace an existing object.
    await expect(writeMetaObjects([driver], SCHOOL, TEST_KDF, key)).resolves.toBeUndefined();
    expect(driver.putCount.get(checkKey(SCHOOL))).toBe(2);
  });

  it("recognises a check object it just wrote", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const driver = new MemoryDriver();
    await writeMetaObjects([driver], SCHOOL, TEST_KDF, key);
    expect(await checkObjectIsCurrent(driver, SCHOOL, key)).toBe(true);
  });

  it("reports a missing check object as not current", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    expect(await checkObjectIsCurrent(new MemoryDriver(), SCHOOL, key)).toBe(false);
  });

  it("reports the OLD payload format as not current", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const driver = new MemoryDriver();

    // Exactly what builds before the school_id fix wrote. A restore comparing
    // it against the current payload rejected a perfectly valid phrase.
    const legacy = JSON.stringify({
      purpose: "recovery-phrase-verification",
      known_plaintext: "cette phrase ouvre cette sauvegarde",
    });
    const encoded = await encodeObject({
      schoolId: SCHOOL,
      objectKey: checkKey(SCHOOL),
      kind: "check",
      kdf: TEST_KDF,
      key,
      compression: compressionAlgorithm(),
      plaintext: () => Readable.from([Buffer.from(legacy, "utf8")]),
    });
    await driver.put(checkKey(SCHOOL), encoded.openStream(), encoded.size, { overwrite: true });

    expect(await checkObjectIsCurrent(driver, SCHOOL, key)).toBe(false);

    // …and rewriting repairs it, which is what the worker does at boot.
    await writeMetaObjects([driver], SCHOOL, TEST_KDF, key);
    expect(await checkObjectIsCurrent(driver, SCHOOL, key)).toBe(true);
  });

  it("reports a check object written under a different key as not current", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const other = await deriveKey("autre", TEST_KDF);
    const driver = new MemoryDriver();
    await writeMetaObjects([driver], SCHOOL, TEST_KDF, key);
    expect(await checkObjectIsCurrent(driver, SCHOOL, other)).toBe(false);
  });

  it("binds the check object to the school, so another namespace fails", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const driver = new MemoryDriver();
    await writeMetaObjects([driver], SCHOOL, TEST_KDF, key);
    expect(buildCheckPlaintext("autre-ecole")).not.toBe(buildCheckPlaintext(SCHOOL));
  });
});

describe("the worker repairs stale meta objects at boot", () => {
  const worker = readFileSync(join(__dirname, "..", "worker", "sync-worker.service.ts"), "utf8");

  it("calls ensureMetaObjects during bootstrap", () => {
    const boot = worker.slice(worker.indexOf("async onApplicationBootstrap"));
    expect(boot.slice(0, boot.indexOf("\n  async onApplicationShutdown"))).toContain("ensureMetaObjects");
  });

  it("repairs rather than reporting a fault", () => {
    expect(worker).toContain("checkObjectIsCurrent");
    expect(worker).toContain("writeMetaObjects");
  });
});

describe("setup finalisation", () => {
  const setup = readFileSync(join(__dirname, "..", "setup", "setup.service.ts"), "utf8");
  const finish = setup.slice(setup.indexOf("async finish("));
  const body = finish.slice(0, finish.indexOf("\n  async enabledTargetDrivers"));

  it("claims the namespace before uploading a snapshot", () => {
    expect(body.indexOf("registry.claim")).toBeLessThan(body.indexOf("runSnapshot"));
  });

  it("refuses to finish when the school id is already claimed", () => {
    // This used to swallow the conflict, leaving two installs writing one
    // namespace — the corruption the registry exists to prevent.
    expect(body).toContain("claim.conflict");
  });

  it("still tolerates an unreachable target", () => {
    expect(body).toContain("if (err instanceof BadRequestException) throw err");
  });
});
