import { Readable } from "node:stream";
import { buildKdfParams, deriveKey, newSalt } from "../crypto/kdf";
import { encodeObject, decodeObject } from "../crypto/object-codec";
import { splitObject } from "../crypto/object-header";
import { compressionAlgorithm } from "../crypto/compression";
import { GcmDecryptTransform, MAX_FRAME_BYTES, newNonceBase } from "../crypto/cipher";

const TEST_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });
const PAYLOAD = Buffer.from("x".repeat(300_000), "utf8");

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function build(key: Buffer) {
  return encodeObject({
    schoolId: "ecole-test",
    objectKey: "ecole-test/snapshots/2026-08-23_0000000001.sql.zst.enc",
    kind: "snapshot",
    kdf: TEST_KDF,
    key,
    compression: compressionAlgorithm(),
    plaintext: () => Readable.from([PAYLOAD]),
  });
}

describe("stored object header", () => {
  it("records the real wire size, not zero", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const object = await build(key);
    const bytes = await collect(object.openStream());

    // The header that actually shipped — not the in-memory copy. The encoder
    // used to serialise with stored_bytes: 0 and mutate the object after.
    const { header } = splitObject(bytes);
    expect(header.stored_bytes).toBe(bytes.length);
    expect(header.stored_bytes).toBe(object.size);
    expect(header.stored_bytes).toBeGreaterThan(0);
  });

  it("declares a size that matches every stream it opens", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const object = await build(key);
    const a = await collect(object.openStream());
    const b = await collect(object.openStream());
    expect(a.length).toBe(object.size);
    expect(b.length).toBe(object.size);
    expect(a.equals(b)).toBe(true);
  });
});

describe("corrupt objects reject, never crash", () => {
  it("rejects a flipped ciphertext byte with an error, not an uncaught throw", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const object = await build(key);
    const bytes = await collect(object.openStream());

    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 20] ^= 0xff;

    await expect(decodeObject(tampered, key)).rejects.toThrow();
  });

  it("rejects the wrong key with an error", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const wrong = await deriveKey("autre phrase", TEST_KDF);
    const object = await build(key);
    const bytes = await collect(object.openStream());
    await expect(decodeObject(bytes, wrong)).rejects.toThrow();
  });
});

describe("decrypt transform is bounded", () => {
  it("refuses an implausible frame length instead of buffering forever", async () => {
    const nonceBase = newNonceBase();
    const key = Buffer.alloc(32, 7);
    const evil = Buffer.alloc(4);
    evil.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);

    await expect(
      collect(Readable.from([evil]).pipe(new GcmDecryptTransform(key, nonceBase))),
    ).rejects.toThrow(/frame/i);
  });

  it("exposes a sane ceiling", () => {
    expect(MAX_FRAME_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_FRAME_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});
