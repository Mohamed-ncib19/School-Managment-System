import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const RESTORE = readFileSync(join(__dirname, "..", "restore", "restore.service.ts"), "utf8");
const SNAPSHOT = readFileSync(join(__dirname, "..", "worker", "snapshot.service.ts"), "utf8");

describe("psql child process", () => {
  it("never leaves stdout piped and unread", () => {
    const load = RESTORE.slice(RESTORE.indexOf("private async loadSqlFile"));
    const body = load.slice(0, load.indexOf("\n  /**"));
    const drains = /child\.stdout(\?\.)?\.(resume|on)\(/.test(body);
    const notPiped = /stdio:\s*\["ignore",\s*"ignore",/.test(body);
    expect(drains || notPiped).toBe(true);
  });

  it("reports why psql stopped instead of swallowing stderr", () => {
    const load = RESTORE.slice(RESTORE.indexOf("private async loadSqlFile"));
    const body = load.slice(0, load.indexOf("\n  /**"));
    expect(body).toMatch(/child\.stderr/);
  });
});

describe("pg_dump child process", () => {
  it("waits for the write stream to finish, not just the child to close", () => {
    const dump = SNAPSHOT.slice(SNAPSHOT.indexOf("private async dumpToFile"));
    const body = dump.slice(0, dump.indexOf("\n  /**"));
    // Resolving on close alone let statSync measure a still-flushing file.
    expect(body).toMatch(/on\(["']finish["']/);
  });
});

describe("a child whose stdout is piped and unread deadlocks", () => {
  it("demonstrates the failure mode these fixes avoid", async () => {
    // node prints ~1 MB to stdout; with a piped, unread stdout it cannot exit
    // once the 64 KB pipe buffer fills. This is what psql -f did on any real
    // dump: the restore hung forever with no error.
    const child = spawn(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024*1024))"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 1_500);
      child.on("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    child.kill();
    expect(exited).toBe(false);
  }, 10_000);
});
