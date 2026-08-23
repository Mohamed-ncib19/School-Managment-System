import { readFileSync } from "node:fs";
import { join } from "node:path";

const RESTORE = readFileSync(join(__dirname, "..", "restore", "restore.service.ts"), "utf8");

const section = (from: string, to: string): string => {
  const start = RESTORE.indexOf(from);
  const rest = RESTORE.slice(start);
  const end = rest.indexOf(to);
  return end === -1 ? rest : rest.slice(0, end);
};

describe("event replay", () => {
  const body = section("async replayEvents", "/** Step 4");

  it("batches events into one transaction, not one per row", () => {
    // withSyncDisabled opens a transaction; calling it per event meant one
    // commit per row — a hundred thousand for a modest school's history.
    const perEvent = /for \(const line of lines\)[\s\S]{0,400}withSyncDisabled/.test(body);
    expect(perEvent).toBe(false);
    expect(body).toContain("withSyncDisabled");
  });

  it("opens the transaction before iterating the lines", () => {
    expect(body.indexOf("withSyncDisabled")).toBeLessThan(body.indexOf("for (const line of lines)"));
  });
});

describe("applyEvent", () => {
  const body = section("private async applyEvent", "private async pkColumns");

  it("deletes using every primary key column, not just the first", () => {
    expect(body).not.toMatch(/pks\[0\]/);
  });

  it("handles a payload whose columns are all primary keys", () => {
    // An empty SET list produced `DO UPDATE SET ` — a syntax error.
    expect(body).toMatch(/DO NOTHING/);
    expect(body).toMatch(/setColumns\.length === 0/);
  });
});

describe("pkColumns", () => {
  const body = section("private async pkColumns", "private async columnNames");

  it("returns the key columns in index order", () => {
    expect(body).toMatch(/ORDER BY k\.ord/);
  });
});

describe("readHeader", () => {
  const body = section("private async readHeader", "private async saltFromCloud");

  it("releases the stream after reading a header", () => {
    // One abandoned connection per batch, and discovery reads a header for
    // every batch in the namespace.
    expect(body).toMatch(/stream\.destroy\(\)/);
  });

  it("assembles the header length from all buffered bytes, not chunks[0]", () => {
    // chunks[0].readUInt32BE(0) threw RangeError on a short first chunk.
    expect(body).not.toMatch(/chunks\[0\]\.readUInt32BE/);
  });
});

describe("schema hash", () => {
  it("does not read a source path that is absent from a production build", () => {
    expect(RESTORE).not.toMatch(/"src",\s*"db",\s*"schema\.ts"/);
  });
});
