import { generateRecoveryPhrase, isValidRecoveryPhrase, normalizePhrase } from "../crypto/bip39";
import { buildKdfParams, deriveKey, newSalt, makeSchoolSalt } from "../crypto/kdf";
import { newNonceBase, nonceForFrame, encryptBuffer, decryptBuffer } from "../crypto/cipher";
import { encodeObjectHeader, decodeObjectHeader, FORMAT_VERSION, ObjectHeader } from "../crypto/object-header";
import { encodeObject, decodeObject, decodeObjectToFile } from "../crypto/object-codec";
import { compressionAlgorithm, compressBlock, decompressBlock, BLOCK_BYTES } from "../crypto/compression";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Fast KDF params for tests (scrypt, low cost) — never production values. */
const TEST_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024, scryptR: 8, scryptP: 1 });

async function testKey(): Promise<Buffer> {
  return deriveKey("test phrase for unit tests", TEST_KDF);
}

describe("BIP39 recovery phrase", () => {
  it("generates a valid 12-word phrase", () => {
    const p = generateRecoveryPhrase();
    expect(p.words).toHaveLength(12);
    expect(isValidRecoveryPhrase(p.phrase)).toBe(true);
    expect(normalizePhrase(p.phrase)).toBe(p.phrase);
  });

  it("is deterministic from the same input", () => {
    const a = generateRecoveryPhrase();
    const b = generateRecoveryPhrase();
    expect(a.phrase).not.toBe(b.phrase);
  });

  it("rejects malformed phrases", () => {
    expect(isValidRecoveryPhrase("un mot deux trois quatre cinq six sept huit neuf dix onze mal")).toBe(false);
    expect(isValidRecoveryPhrase("")).toBe(false);
    expect(isValidRecoveryPhrase("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon")).toBe(false); // 11 words
  });

  it("accepts extra whitespace and case differences after normalization", () => {
    const p = generateRecoveryPhrase();
    const messy = `  ${p.phrase.toUpperCase()}  `;
    expect(normalizePhrase(messy)).toBe(p.phrase);
  });
});

describe("KDF", () => {
  it("derives the same key from the same phrase and salt", async () => {
    const salt = newSalt();
    const params = buildKdfParams("scrypt", salt, { scryptN: 1024 });
    const k1 = await deriveKey("motdepasse", params);
    const k2 = await deriveKey("motdepasse", params);
    expect(k1.length).toBe(32);
    expect(k1.equals(k2)).toBe(true);
  });

  it("derives a different key for a different phrase", async () => {
    const params = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });
    const k1 = await deriveKey("phrase-a", params);
    const k2 = await deriveKey("phrase-b", params);
    expect(k1.equals(k2)).toBe(false);
  });

  it("makeSchoolSalt produces a versioned record", () => {
    const p = makeSchoolSalt();
    expect(p.salt).toBeTruthy();
    expect(p.keyLen).toBe(32);
    expect(["argon2id", "scrypt"]).toContain(p.alg);
  });
});

describe("cipher frames", () => {
  it("derives unique nonces per frame", () => {
    const base = newNonceBase();
    const a = nonceForFrame(base, 0);
    const b = nonceForFrame(base, 1);
    const c = nonceForFrame(base, 0);
    expect(a.equals(b)).toBe(false);
    expect(a.equals(c)).toBe(true); // same base + same counter = same nonce (deterministic)
    expect(a.length).toBe(12);
  });

  it("round-trips and detects tampering", async () => {
    const key = await testKey();
    const base = newNonceBase();
    const plaintext = Buffer.from("secret payload for the school");
    const ciphertext = encryptBuffer(key, plaintext, base);
    expect(ciphertext.length).toBe(plaintext.length + 16);
    expect(decryptBuffer(key, ciphertext, base).toString("utf8")).toBe(plaintext.toString("utf8"));

    const tampered = Buffer.from(ciphertext);
    tampered[4] ^= 0xff;
    expect(() => decryptBuffer(key, tampered, base)).toThrow();
  });
});

describe("object header", () => {
  const header: ObjectHeader = {
    format_version: FORMAT_VERSION,
    kind: "event_batch",
    school_id: "test-ecole",
    object_key: "test-ecole/events/2026-08-20/1-5.jsonl.zst.enc",
    compression: "zstd",
    kdf: TEST_KDF,
    cipher: { alg: "AES-256-GCM", nonce_base: "aGVsbG8=" },
    uncompressed_bytes: 1234,
    uncompressed_sha256: "abc123",
    stored_bytes: 5678,
    created_at: "2026-08-20T10:00:00.000Z",
    seq_from: 1,
    seq_to: 5,
    app_version: "test",
  };

  it("round-trips through encode/decode", () => {
    const encoded = encodeObjectHeader(header);
    const decoded = decodeObjectHeader(encoded);
    expect(decoded).toEqual(header);
  });
});

describe("compression blocks", () => {
  it("round-trips a small buffer", async () => {
    const data = Buffer.from("z".repeat(5000));
    const record = await compressBlock(data, "gzip");
    const out = await decompressBlock(record, "gzip");
    expect(out.equals(data)).toBe(true);
  });

  it("round-trips a large buffer spanning multiple blocks via the object pipeline", async () => {
    const alg = compressionAlgorithm();
    const key = await testKey();
    const payload = Buffer.alloc(BLOCK_BYTES * 2 + 17, "x");
    const encoded = await encodeObject({
      schoolId: "test-ecole",
      objectKey: "test-ecole/events/2026-08-20/1-5.jsonl.zst.enc",
      kind: "event_batch",
      kdf: TEST_KDF,
      key,
      compression: alg,
      seqFrom: 1,
      seqTo: 5,
      plaintext: () => Readable.from([payload]),
    });

    const chunks: Buffer[] = [];
    for await (const chunk of encoded.openStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBe(encoded.size);

    const decoded = await decodeObject(bytes, key);
    expect(decoded.header.uncompressed_sha256).toBe(encoded.header.uncompressed_sha256);
    expect(decoded.plaintext.equals(payload)).toBe(true);
  });
});

describe("object codec round-trip", () => {
  it("verifies a full encode → decode cycle", async () => {
    const alg = compressionAlgorithm();
    const key = await testKey();
    const lines = [
      { seq: 1, entity_table: "students", entity_id: "1", operation: "insert", payload: { id: "1", first_name: "Amine" } },
      { seq: 2, entity_table: "students", entity_id: "1", operation: "update", payload: { id: "1", first_name: "Amine", phone: "0600000000" } },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n";

    const encoded = await encodeObject({
      schoolId: "test-ecole",
      objectKey: "test-ecole/events/2026-08-20/1-2.jsonl.zst.enc",
      kind: "event_batch",
      kdf: TEST_KDF,
      key,
      compression: alg,
      seqFrom: 1,
      seqTo: 2,
      plaintext: () => Readable.from([Buffer.from(lines, "utf8")]),
    });

    const chunks: Buffer[] = [];
    for await (const chunk of encoded.openStream()) chunks.push(chunk);
    const decoded = await decodeObject(Buffer.concat(chunks), key);
    expect(decoded.plaintext.toString("utf8")).toBe(lines);
    expect(decoded.header.seq_to).toBe(2);
  });

  it("fails loudly on checksum tampering", async () => {
    const alg = compressionAlgorithm();
    const key = await testKey();
    const encoded = await encodeObject({
      schoolId: "test-ecole",
      objectKey: "test-ecole/events/2026-08-20/9-9.jsonl.zst.enc",
      kind: "event_batch",
      kdf: TEST_KDF,
      key,
      compression: alg,
      seqFrom: 9,
      seqTo: 9,
      plaintext: () => Readable.from([Buffer.from("sauvegarde intègre", "utf8")]),
    });
    const chunks: Buffer[] = [];
    for await (const chunk of encoded.openStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);

    // Flip a bit in the payload region (after the header).
    const headerLen = bytes.readUInt32BE(0);
    bytes[4 + headerLen + 5] ^= 0x01;
    await expect(decodeObject(bytes, key)).rejects.toThrow(/Checksum mismatch|auth/i);
  });

  it("streams decode to a file and verifies", async () => {
    const alg = compressionAlgorithm();
    const key = await testKey();
    const payload = Buffer.alloc(700_000, "s");
    const encoded = await encodeObject({
      schoolId: "test-ecole",
      objectKey: "test-ecole/snapshots/2026-08-20_0000000001.sql.zst.enc",
      kind: "snapshot",
      kdf: TEST_KDF,
      key,
      compression: alg,
      seqFrom: 0,
      seqTo: 100,
      plaintext: () => Readable.from([payload]),
    });
    const chunks: Buffer[] = [];
    for await (const chunk of encoded.openStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);

    const dir = await mkdtemp(join(tmpdir(), "iq-test-"));
    const outPath = join(dir, "out.sql");
    try {
      await decodeObjectToFile(Readable.from([bytes]), key, encoded.header, outPath);
      const { readFile } = await import("node:fs/promises");
      const out = await readFile(outPath);
      expect(out.equals(payload)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});