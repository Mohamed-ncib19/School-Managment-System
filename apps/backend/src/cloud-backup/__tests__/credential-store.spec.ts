import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CredentialStoreService } from "../credential-store/credential-store.service";

/** Repo root = five levels up from src/cloud-backup/__tests__. */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

describe("credential directory hygiene", () => {
  it("git ignores .cloud-creds so target secrets can never be committed", () => {
    // git check-ignore exits 0 when the path IS ignored, 1 when it is not.
    let ignored = false;
    try {
      execFileSync("git", ["check-ignore", "-q", ".cloud-creds"], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      });
      ignored = true;
    } catch {
      ignored = false;
    }
    expect(ignored).toBe(true);
  });

  it("docker ignores .cloud-creds so secrets are not baked into an image", () => {
    const dockerignore = readFileSync(join(REPO_ROOT, ".dockerignore"), "utf8");
    expect(dockerignore).toMatch(/^\.cloud-creds\/?$/m);
  });
});

describe("credential store round trip", () => {
  const store = new CredentialStoreService();
  const written: string[] = [];

  afterAll(async () => {
    for (const id of written) await store.delete(id);
  });

  it("loads back exactly what it saved", async () => {
    const entryId = randomUUID();
    written.push(entryId);
    const secret = JSON.stringify({
      driver: "s3",
      config: {
        endpoint: "https://s3.example.com",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "s3cr3t/value+with=chars",
      },
    });

    await store.save(entryId, secret);
    expect(store.has(entryId)).toBe(true);

    const loaded = await store.load(entryId);
    expect(loaded).toBe(secret);
  }, 60_000);

  it("survives secrets containing quotes and newlines", async () => {
    const entryId = randomUUID();
    written.push(entryId);
    const secret = JSON.stringify({ driver: "webdav", config: { password: `a'b"c\nd` } });

    await store.save(entryId, secret);
    expect(await store.load(entryId)).toBe(secret);
  }, 60_000);

  it("returns null for an entry that was never saved", async () => {
    expect(await store.load(randomUUID())).toBeNull();
  });
});
