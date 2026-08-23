import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DRIZZLE_DIR = join(__dirname, "..", "..", "..", "drizzle");

function allMigrationSql(): string {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(DRIZZLE_DIR, f), "utf8"))
    .join("\n");
}

/**
 * The launchers run `drizzle-kit push`, which papers over migration drift on
 * a developer machine. Docker runs `drizzle-kit migrate` first. Any column the
 * code SELECTs must therefore exist in the migration files, not just in
 * schema.ts — 0007 shipped without five of them, and loadState() reads one of
 * those at boot.
 */
describe("migration parity with schema.ts", () => {
  const sql = allMigrationSql();

  it.each([
    ["cloud_state", "wrapped_key"],
    ["cloud_state", "wrap_salt"],
    ["cloud_state", "schema_hash"],
    ["sync_queue", "last_error"],
    ["sync_queue", "processed_at"],
  ])("migrations create %s.%s", (_table, column) => {
    expect(sql).toMatch(new RegExp(`"${column}"`));
  });

  it("every cloud_state column in schema.ts appears in some migration", () => {
    const schema = readFileSync(join(__dirname, "..", "..", "db", "schema.ts"), "utf8");
    const start = schema.indexOf("export const cloudState");
    const block = schema.slice(start, schema.indexOf("});", start));
    const declared = [...block.matchAll(/^\t(\w+):/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(10);
    for (const column of declared) {
      expect(sql).toMatch(new RegExp(`"${column}"`));
    }
  });

  it("every migration file is registered in the journal", () => {
    const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const tags = new Set(journal.entries.map((e) => e.tag));
    for (const file of readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql"))) {
      expect(tags.has(file.replace(/\.sql$/, ""))).toBe(true);
    }
  });
});
