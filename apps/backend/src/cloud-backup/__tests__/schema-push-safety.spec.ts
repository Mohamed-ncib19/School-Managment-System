import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "..", "..", "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(REPO, ...p), "utf8");

/**
 * `drizzle-kit push --force` runs on every school's start and update. It
 * applies whatever it decides is needed WITHOUT asking, including destructive
 * statements — a column rename in schema.ts is indistinguishable from "drop
 * the old column, create a new one", and there is no undo.
 *
 * Every push site must be preceded by a pg_dump, so the worst case is a
 * restore rather than a loss. These are the four sites.
 */
describe("no schema push without a safety backup", () => {
  it("ships the backup helper for both platforms", () => {
    expect(existsSync(join(REPO, "installer", "engine", "backup-before-schema.ps1"))).toBe(true);
    expect(existsSync(join(REPO, "installer", "macos", "scripts", "backup-before-schema.sh"))).toBe(true);
  });

  it.each([
    ["installer/engine/launcher.ps1", "backup-before-schema.ps1"],
    ["installer/engine/do-update.ps1", "backup-before-schema.ps1"],
    ["installer/macos/start.sh", "backup-before-schema.sh"],
    ["installer/macos/scripts/update.sh", "backup-before-schema.sh"],
  ])("%s backs up before pushing", (file, helper) => {
    const source = read(...file.split("/"));
    expect(source).toContain("drizzle-kit push --force");
    expect(source).toContain(helper);
    // The dump must come first, or it is documentation rather than a safeguard.
    expect(source.indexOf(helper)).toBeLessThan(source.indexOf("drizzle-kit push --force"));
  });

  it("keeps the safety dumps bounded so they cannot fill a school's disk", () => {
    expect(read("installer", "engine", "backup-before-schema.ps1")).toContain("Select-Object -Skip 5");
    expect(read("installer", "macos", "scripts", "backup-before-schema.sh")).toContain("tail -n +6");
  });

  it("never blocks startup when pg_dump is unavailable", () => {
    // A school must still be able to start the app. The dump is a safety net,
    // not a gate — but the failure has to be loud.
    const ps = read("installer", "engine", "backup-before-schema.ps1");
    const sh = read("installer", "macos", "scripts", "backup-before-schema.sh");
    expect(ps).toContain("WITHOUT a safety backup");
    expect(sh).toContain("WITHOUT a safety backup");
    expect(ps).toMatch(/exit 0/);
    expect(sh).toMatch(/exit 0/);
  });
});
