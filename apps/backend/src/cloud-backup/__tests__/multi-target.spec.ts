import { Readable } from "node:stream";
import { buildKdfParams, deriveKey, newSalt } from "../crypto/kdf";
import { encodeObject, decodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import { withRetry } from "../drivers/storage-driver";
import { MemoryDriver } from "./support/memory-driver";

const TEST_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });
const PAYLOAD = Buffer.from(
  JSON.stringify({ hello: "monde", rows: Array.from({ length: 500 }, (_, i) => i) }),
  "utf8",
);

async function encoded(key: Buffer) {
  return encodeObject({
    schoolId: "ecole-test",
    objectKey: "ecole-test/events/2026-08-23/1-1.jsonl.zst.enc",
    kind: "event_batch",
    kdf: TEST_KDF,
    key,
    compression: compressionAlgorithm(),
    seqFrom: 1,
    seqTo: 1,
    plaintext: () => Readable.from([PAYLOAD]),
  });
}

describe("one encoded object, many consumers", () => {
  it("uploads identical bytes to every target in a fan-out", async () => {
    const key = await deriveKey("phrase de test", TEST_KDF);
    const object = await encoded(key);
    const targets = [new MemoryDriver(), new MemoryDriver(), new MemoryDriver()];

    for (const target of targets) {
      await target.put(object.header.object_key, object.openStream(), object.size);
    }

    const bodies = targets.map((t) => t.puts.get(object.header.object_key)!);
    // Targets 2 and 3 used to receive an already-drained stream and store
    // nothing at all, while reporting success.
    expect(bodies.every((b) => b !== undefined && b.length === object.size)).toBe(true);
    expect(bodies[1].equals(bodies[0])).toBe(true);
    expect(bodies[2].equals(bodies[0])).toBe(true);

    // And every copy is genuinely decryptable — not just equal-length.
    const round = await decodeObject(bodies[2], key);
    expect(round.plaintext.equals(PAYLOAD)).toBe(true);
  });

  it("survives a retry after a failed upload attempt", async () => {
    const key = await deriveKey("phrase de test", TEST_KDF);
    const object = await encoded(key);
    const target = new MemoryDriver();
    target.failNextPuts(2);

    await withRetry(() => target.put(object.header.object_key, object.openStream(), object.size), {
      maxRetries: 4,
      backoffBaseMs: 1,
      backoffMaxMs: 2,
      timeoutMs: 5_000,
    });

    expect(target.putCount.get(object.header.object_key)).toBe(3);
    const body = target.puts.get(object.header.object_key)!;
    const round = await decodeObject(body, key);
    expect(round.plaintext.equals(PAYLOAD)).toBe(true);
  });
});
