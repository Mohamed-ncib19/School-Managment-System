import { createHash } from "node:crypto";

/**
 * Fingerprint of the database schema, compared at boot to detect a migration.
 *
 * Both callers used to read `join(process.cwd(), "src", "db", "schema.ts")`,
 * which does not exist when the app runs from `dist/`. It returned "" there,
 * so migration detection never fired in production — and the first boot after
 * an upgrade took one spurious snapshot before settling.
 *
 * Hashing the shape of the compiled schema module works from `src` and `dist`
 * alike, and is a truer signal anyway: it changes when a table or column
 * changes, not when a comment does.
 */
export async function computeSchemaHash(): Promise<string> {
  try {
    const schema = (await import("../../db/schema")) as Record<string, unknown>;
    const shape: string[] = [];
    for (const [name, table] of Object.entries(schema)) {
      if (!table || typeof table !== "object") continue;
      const columns = Object.keys(table as Record<string, unknown>).filter((k) => !k.startsWith("_"));
      if (columns.length === 0) continue;
      shape.push(`${name}:${columns.sort().join(",")}`);
    }
    shape.sort();
    return createHash("sha256").update(shape.join("|")).digest("hex");
  } catch {
    return "";
  }
}
