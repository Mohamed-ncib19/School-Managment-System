import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = readFileSync(join(__dirname, "..", "data-transfer.service.ts"), "utf8");

/**
 * Source-level guards for the import preview and export coverage.
 *
 * The full service needs a live Postgres; what the admin depends on is
 * visible in the source: legacy "Unassigned" rows from old exports never
 * come back as school data, the sample carries the whole table, and the
 * audit trail ships with the export.
 */
describe("data-transfer preview", () => {
  it("skips legacy placeholder rows instead of importing them", () => {
    expect(SERVICE).toContain("isLegacyPlaceholderRow");
    expect(SERVICE).not.toContain("systemRowCount");
    expect(SERVICE).not.toContain("allSystem");
    // The samples themselves are built from the filtered rows.
    expect(SERVICE).toContain("const sampleRows = realRows.slice(0, SAMPLE_ROWS).map(");
  });

  it("samples the whole small table, not three token rows", () => {
    expect(SERVICE).toContain("const SAMPLE_ROWS = 50;");
    expect(SERVICE).not.toContain(".rows.slice(0, 3)");
  });

  it("exports the audit trail with the rest of the school's data", () => {
    expect(SERVICE).toContain('key: "audit_logs"');
    expect(SERVICE).toContain("table: auditLogs");
    // audit_logs sits in the ordered table list (i.e. it is planned like any
    // other table), and its only FK target — users — precedes it.
    const order = SERVICE.indexOf("const TABLE_ORDER");
    const audit = SERVICE.indexOf('key: "audit_logs"');
    const users = SERVICE.indexOf('key: "users"');
    expect(order).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(order);
    expect(users).toBeGreaterThan(order);
    expect(users).toBeLessThan(audit);
  });

  it("detects legacy placeholder rows by column name, never by assumed index", () => {
    expect(SERVICE).toContain('columns.indexOf("is_system_placeholder")');
  });

  it("requires the secret password for encrypted files, never auto-opens them", () => {
    // The Dropbox .enc copy must not silently open with this machine's own
    // sealed key: the importing admin must hold the secret. Plain JSON stays
    // password-free, and the sealed-key path is gone entirely.
    // Line-ending agnostic: Windows checkouts carry CRLF, so the two
    // statements are asserted separately instead of joined by "\n".
    expect(SERVICE).toContain("if (this.looksLikeJson(buffer)) return buffer;");
    expect(SERVICE).toContain("if (!phrase?.trim()) {");
    expect(SERVICE).toContain('header.kind !== "data_export"');
    expect(SERVICE).toContain("Mot de passe secret invalide");
    expect(SERVICE).not.toContain("sealedMasterKey");
    expect(SERVICE).not.toContain("CloudKeyService");
  });
});

describe("data-transfer coverage guard", () => {
  it("every pgTable in the schema is either exported or an explicitly excluded machine-local table", () => {
    // This is the "cover ALL the saved system data" guarantee: a table added
    // to the schema without being classified fails here instead of silently
    // dropping out of every backup.
    const schema = readFileSync(join(__dirname, "..", "..", "db", "schema.ts"), "utf8");
    const schemaTables = [...schema.matchAll(/export const \w+ = pgTable\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(schemaTables.length).toBeGreaterThan(0);

    const machineLocal = new Set([
      "cloud_state", // DPAPI-wrapped master key — must never leave the machine
      "cloud_targets", // storage credentials — same
      "backup_manifest", // per-machine upload bookkeeping
      "restore_progress", // live restore state — meaningless cross-machine
      "sync_queue", // per-machine capture queue
    ]);
    const exported = [...SERVICE.matchAll(/key: "([a-z_]+)"/g)].map((m) => m[1]);
    for (const table of schemaTables) {
      if (machineLocal.has(table)) {
        expect(exported).not.toContain(table);
      } else {
        expect(exported).toContain(table);
      }
    }
    // And the export list must not invent tables that do not exist.
    for (const key of exported) {
      expect(schemaTables).toContain(key);
    }
  });
});

describe("data-transfer import foreign-key safety", () => {
  it("clears tables that are present-but-empty instead of skipping them", () => {
    // Skipping them left stale rows behind whose FKs still pointed at the
    // parent rows being replaced — the delete phase then aborted with
    // 400 INVALID_REFERENCE ("still referenced from table fields").
    expect(SERVICE).not.toContain("if (realRows.length === 0) continue;");
    expect(SERVICE).toContain("clear-only");
    // ...while a file with no rows at all is refused, never a wipe-everything.
    expect(SERVICE).toContain("aucune ligne à importer");
  });

  it("validates foreign keys against plan membership, not file presence", () => {
    // A target table that is in the file but skipped in the preview keeps
    // its rows, so it cannot resolve references.
    expect(SERVICE).toContain("included.has(target)");
    expect(SERVICE).toContain("ni dans le fichier ni importée");
  });

  it("treats present-but-empty targets as supplying zero ids", () => {
    // A clear-only target (in the file, zero real rows) is deleted and
    // supplies no ids — a non-empty child referencing it must 400, and the
    // preview must warn the same way importAll refuses. File presence alone
    // must not count as resolving.
    expect(SERVICE).toContain("hasRealRows");
    expect(SERVICE).toContain("targetHasRows");
  });

  it("names the leftover child table that would block a delete", () => {
    // Tables outside the plans keep their rows; when those rows reference a
    // table being cleared, the import must say which table blocks — before
    // anything is deleted, not as a raw PG error mid-transaction.
    expect(SERVICE).toContain("leftover");
    expect(SERVICE).toContain("ni dans le fichier ni importée");
  });

  it("declares every schema foreign key in TABLE_ORDER refs", () => {
    // The planning validation and the ordering only know the FKs listed in
    // refs. A schema FK missing there (e.g. fields.level_id, recorded_by,
    // created_by, generated_by) sails through validation and dies on a raw
    // database error instead of a named 400.
    const schema = readFileSync(join(__dirname, "..", "..", "db", "schema.ts"), "utf8");
    const constToTable = new Map<string, string>();
    for (const m of schema.matchAll(/export const (\w+) = pgTable\("([a-z_]+)"/g)) {
      constToTable.set(m[1], m[2]);
    }
    // Slice the schema per pgTable definition, then pair each foreignKey
    // block's local column with its target table.
    const sections = schema.split(/export const \w+ = pgTable\("/);
    const missing: string[] = [];
    for (const section of sections) {
      const tableMatch = section.match(/^([a-z_]+)"/);
      if (!tableMatch) continue;
      const table = tableMatch[1];
      for (const fk of section.matchAll(
        /foreignKey\(\{\s*columns:\s*\[table\.(\w+)\][\s\S]*?foreignColumns:\s*\[(\w+)\.id\]/g,
      )) {
        const [, column, targetConst] = fk;
        const target = constToTable.get(targetConst);
        if (!target) continue;
        const entry = SERVICE.match(
          new RegExp(`key: "${table}"[\\s\\S]*?refs: \\{([^}]*)\\}`),
        );
        const refs = entry?.[1] ?? "";
        const declared = new RegExp(`${column}: "${target}"`).test(refs);
        if (!declared) missing.push(`${table}.${column} -> ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
