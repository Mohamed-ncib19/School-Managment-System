import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Locates the embedded PostgreSQL runtime binaries (pg_dump, psql, pg_restore)
 * shipped with the app, or falls back to whatever is on PATH. The binaries are
 * used only for snapshotting (pg_dump) and restore (psql) — never for serving
 * requests.
 */
export function findPgBin(name: string): string | null {
  const candidates = [join(process.cwd(), ".postgres", "runtime"), "C:\\Program Files\\PostgreSQL"];
  const exe = (dir: string): string => join(dir, `${name}.exe`);
  const walk = (dir: string): string | null => {
    if (existsSync(exe(dir))) return exe(dir);
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const found = walk(join(dir, entry.name));
          if (found) return found;
        }
      }
    } catch {
      /* unreadable directory — skip */
    }
    return null;
  };
  for (const c of candidates) {
    if (existsSync(c)) {
      const found = walk(c);
      if (found) return found;
    }
  }
  return null;
}