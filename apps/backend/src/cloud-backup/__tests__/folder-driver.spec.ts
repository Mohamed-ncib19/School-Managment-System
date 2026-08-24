import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { FolderDriver } from "../drivers/folder.driver";
import { DRIVER_DEFINITIONS, createDriver } from "../drivers/driver-registry";
import { S3_PRESETS, s3Preset } from "../drivers/s3-presets";

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe("folder driver", () => {
  let dir: string;
  let driver: FolderDriver;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "iq-folder-"));
    driver = new FolderDriver({ basePath: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips an object", async () => {
    const body = Buffer.from("des donnees chiffrees", "utf8");
    await driver.put("ecole/events/2026-08-24/1-9.jsonl.zst.enc", Readable.from([body]), body.length);

    const read = await collect(await driver.get("ecole/events/2026-08-24/1-9.jsonl.zst.enc"));
    expect(read.equals(body)).toBe(true);
  });

  it("creates nested directories for a key", async () => {
    const body = Buffer.from("x");
    await driver.put("a/b/c/d.enc", Readable.from([body]), 1);
    expect((await readFile(join(dir, "a", "b", "c", "d.enc"))).equals(body)).toBe(true);
  });

  it("refuses to overwrite an immutable object", async () => {
    const body = Buffer.from("un");
    await driver.put("k.enc", Readable.from([body]), 2);
    await expect(driver.put("k.enc", Readable.from([body]), 2)).rejects.toThrow(/existe/i);
  });

  it("allows overwrite when asked (the instance registry)", async () => {
    await driver.put("meta/instances.json", Readable.from([Buffer.from("a")]), 1);
    await driver.put("meta/instances.json", Readable.from([Buffer.from("bb")]), 2, { overwrite: true });
    expect((await collect(await driver.get("meta/instances.json"))).toString()).toBe("bb");
  });

  it("rejects a declared size that does not match what was written", async () => {
    await expect(driver.put("bad.enc", Readable.from([Buffer.from("abc")]), 99)).rejects.toThrow(/Taille/i);
  });

  it("lists by prefix and ignores everything else", async () => {
    await driver.put("ecole/events/a.enc", Readable.from([Buffer.from("1")]), 1);
    await driver.put("ecole/snapshots/b.enc", Readable.from([Buffer.from("22")]), 2);

    const events = await driver.list("ecole/events/");
    expect(events.map((m) => m.key)).toEqual(["ecole/events/a.enc"]);
    expect(events[0].size).toBe(1);
    expect(await driver.list("ecole/")).toHaveLength(2);
  });

  it("returns an empty list rather than throwing for an unknown prefix", async () => {
    expect(await driver.list("jamais/")).toEqual([]);
  });

  it("round-trips a connection test and leaves no probe behind", async () => {
    const result = await driver.testConnection();
    expect(result.ok).toBe(true);
    expect(await driver.list("__iq_probe__")).toEqual([]);
  });

  it("refuses a key that climbs out of the base path", async () => {
    await expect(
      driver.put("../escaped.enc", Readable.from([Buffer.from("x")]), 1),
    ).rejects.toThrow(/invalide/i);
    await expect(driver.get("../../etc/passwd")).rejects.toThrow(/invalide/i);
  });

  it("reports a missing object rather than hanging", async () => {
    await expect(driver.get("absent.enc")).rejects.toThrow();
  });
});

describe("S3 provider presets", () => {
  it("builds a Backblaze endpoint from the region", () => {
    const cfg = s3Preset("backblaze")!.toConfig({
      region: "eu-central-003",
      accessKeyId: "k",
      secretAccessKey: "s",
      bucket: "b",
    });
    expect(cfg.endpoint).toBe("https://s3.eu-central-003.backblazeb2.com");
    expect(cfg.addressing).toBe("path");
  });

  it("builds a Cloudflare R2 endpoint from the account id", () => {
    const cfg = s3Preset("r2")!.toConfig({
      accountId: "abc123",
      accessKeyId: "k",
      secretAccessKey: "s",
      bucket: "b",
    });
    expect(cfg.endpoint).toBe("https://abc123.r2.cloudflarestorage.com");
    expect(cfg.region).toBe("auto");
  });


  it("never asks the administrator for an endpoint or an addressing style", () => {
    for (const preset of S3_PRESETS) {
      const def = DRIVER_DEFINITIONS.find((d) => d.id === `s3:${preset.id}`)!;
      const names = def.fields.map((f) => f.name);
      expect(names).not.toContain("endpoint");
      expect(names).not.toContain("addressing");
    }
  });

  it("explains where to get the values", () => {
    for (const preset of S3_PRESETS) {
      const def = DRIVER_DEFINITIONS.find((d) => d.id === `s3:${preset.id}`)!;
      expect(def.setupHelp ?? "").not.toHaveLength(0);
      expect((def.setupHelp ?? "").length).toBeGreaterThan(40);
    }
  });
});

describe("driver registry", () => {
  it("offers the no-account folder option first", () => {
    expect(DRIVER_DEFINITIONS[0].id).toBe("folder");
  });

  it("builds every registered driver from its stored record", () => {
    const sample: Record<string, Record<string, string>> = {
      folder: { basePath: tmpdir() },
      "s3:backblaze": { region: "eu-central-003", accessKeyId: "k", secretAccessKey: "s", bucket: "b" },
      "s3:r2": { accountId: "a", accessKeyId: "k", secretAccessKey: "s", bucket: "b" },
      s3: { endpoint: "https://s3.example.com", region: "us-east-1", accessKeyId: "k", secretAccessKey: "s", bucket: "b", addressing: "path" },
      webdav: { baseUrl: "https://cloud.example.com", username: "u", password: "p", folder: "/b" },
      gdrive: { clientId: "c", clientSecret: "s", refreshToken: "r" },
    };
    for (const def of DRIVER_DEFINITIONS) {
      const driver = createDriver({ driver: def.id, config: sample[def.id] });
      expect(typeof driver.put).toBe("function");
      expect(typeof driver.testConnection).toBe("function");
    }
  });
});
