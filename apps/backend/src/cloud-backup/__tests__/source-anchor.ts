/**
 * Helpers for the guards that assert on source text.
 *
 * Not a spec file, so jest's `.spec.ts` testRegex leaves it alone.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Reads a file from the cloud-backup module, by path segments. */
export function moduleSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

/**
 * The text of one member, from its declaration to the next thing.
 *
 * These guards used to slice with a bare `indexOf`, and that fails in the
 * worst possible way: a renamed member -- or one that merely lost its
 * `async` -- returns -1, the slice collapses to an empty string, and the
 * assertions then run against nothing. A `toContain` fails with a diff that
 * points at the wrong thing, and a `not.toContain` passes while checking
 * nothing at all. Both happened in this suite.
 *
 * An anchor that no longer matches means the guard is broken, not the code,
 * so it throws and says which anchor to fix.
 */
export function sliceMember(source: string, start: RegExp, end: RegExp): string {
  const from = source.search(start);
  if (from < 0) {
    throw new Error(
      `guard anchor ${start} no longer matches this file — ` +
        `the member was renamed or its signature changed, so fix the anchor`,
    );
  }
  const rest = source.slice(from);
  const to = rest.search(end);
  return to > 0 ? rest.slice(0, to) : rest;
}

/**
 * Every .ts file in the cloud-backup module, tests excluded.
 *
 * For guards whose subject is "nowhere in this module does X happen" — the
 * only form that keeps holding after a refactor moves the code.
 */
export function moduleFiles(): string[] {
  const root = join(__dirname, "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walk(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  return walk(root);
}
