import { Readable } from "node:stream";
import { buildKdfParams, deriveKey, newSalt } from "../crypto/kdf";
import { encodeObject, decodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import { buildCheckPlaintext } from "../crypto/check-object";

const TEST_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });

async function encodeCheck(schoolId: string, key: Buffer): Promise<Buffer> {
  const encoded = await encodeObject({
    schoolId,
    objectKey: `${schoolId}/meta/check.json.enc`,
    kind: "check",
    kdf: TEST_KDF,
    key,
    compression: compressionAlgorithm(),
    plaintext: () => Readable.from([Buffer.from(buildCheckPlaintext(schoolId), "utf8")]),
  });
  const chunks: Buffer[] = [];
  for await (const chunk of encoded.openStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe("recovery-phrase check object", () => {
  it("round-trips between what setup writes and what restore expects", async () => {
    const key = await deriveKey("phrase de test", TEST_KDF);
    const stored = await encodeCheck("ecole-test", key);

    const decoded = await decodeObject(stored, key);

    // This is the exact comparison restore.service.ts performs. Setup used to
    // omit school_id while restore required it, so this never matched and
    // every restore rejected a valid phrase.
    expect(decoded.plaintext.toString("utf8")).toBe(buildCheckPlaintext("ecole-test"));
  });

  it("binds the school id, so one school's phrase does not validate another", () => {
    expect(buildCheckPlaintext("ecole-a")).not.toBe(buildCheckPlaintext("ecole-b"));
  });

  it("is byte-stable, so objects written by older installs still verify", () => {
    expect(buildCheckPlaintext("ecole-test")).toBe(
      '{"school_id":"ecole-test","purpose":"recovery-phrase-verification","known_plaintext":"cette phrase ouvre cette sauvegarde"}',
    );
  });

  it("is not rebuilt inline by setup or restore", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const setup = readFileSync(join(__dirname, "..", "setup", "setup.service.ts"), "utf8");
    const restore = readFileSync(join(__dirname, "..", "restore", "restore.service.ts"), "utf8");
    // Both must call the shared builder; an inline literal is how they drifted.
    expect(setup).not.toContain("recovery-phrase-verification");
    expect(restore).not.toContain("recovery-phrase-verification");
    expect(setup).toContain("buildCheckPlaintext");
    expect(restore).toContain("buildCheckPlaintext");
  });
});
