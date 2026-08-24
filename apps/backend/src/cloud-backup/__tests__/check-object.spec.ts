import { Readable } from "node:stream";
import { buildKdfParams, deriveKey, newSalt } from "../crypto/kdf";
import { encodeObject, decodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCheckPlaintext } from "../crypto/check-object";
import { moduleFiles, moduleSource } from "./source-anchor";

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

  it("is not rebuilt inline anywhere but the shared builder", () => {
    // Walking the module beats naming two files. The inline copies drifted
    // apart once already, and a guard pinned to file names stops guarding the
    // moment the code moves — which is exactly what happened when the
    // meta-object writer left setup.service.ts for setup/meta-objects.ts.
    const builder = join("crypto", "check-object.ts");
    const offenders = moduleFiles()
      .filter((f) => !f.endsWith(builder))
      .filter((f) => readFileSync(f, "utf8").includes("recovery-phrase-verification"))
      .map((f) => f.slice(f.indexOf("cloud-backup")));
    expect(offenders).toEqual([]);

    // And both sides still go through it.
    expect(moduleSource("setup", "meta-objects.ts")).toContain("buildCheckPlaintext");
    expect(moduleSource("restore", "restore.service.ts")).toContain("buildCheckPlaintext");
  });});
