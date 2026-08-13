/**
 * Measures the cost of a query *shape*, independent of the HTTP layer.
 *
 * Several of the audit's findings are about payload rather than latency: the
 * query itself is indexed and fast, but it returns the whole table with four
 * levels of parent chain attached. Comparing shapes here — same database, same
 * moment, no server restart in between — is what makes the before/after
 * numbers in the report comparable rather than merely sequential.
 *
 *   npx ts-node -r tsconfig-paths/register -r dotenv/config src/seeds/bench-projection.ts
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { seedClient } from "../db/seed-util";
import { groups, studentAssignments, students } from "../db/schema";

const { db, close } = seedClient();

/** The old list projection: every relation expanded in full. */
const HEAVY = {
  group: { with: { professor: { with: { field: { with: { level: true } } } } } },
  assignments: {
    with: {
      group: {
        columns: { id: true, name: true },
        with: {
          professor: {
            columns: { id: true, full_name: true },
            with: {
              field: {
                columns: { id: true, name: true },
                with: { level: { columns: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: [asc(studentAssignments.created_at)] as any,
  },
} as const;

/** The new list projection: ids, names and the colours the cards use. */
const CHAIN = {
  columns: { id: true, name: true, color: true },
  with: {
    professor: {
      columns: { id: true, full_name: true, color: true },
      with: {
        field: {
          columns: { id: true, name: true, color: true },
          with: { level: { columns: { id: true, name: true, color: true } } },
        },
      },
    },
  },
} as const;

const LIGHT = {
  group: CHAIN,
  assignments: { with: { group: CHAIN }, orderBy: [asc(studentAssignments.created_at)] as any },
} as const;

const kb = (bytes: number) => (bytes / 1024).toFixed(1);
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
const size = (rows: unknown) => Buffer.byteLength(JSON.stringify(rows), "utf8");

async function measure(label: string, run: () => Promise<unknown>) {
  const started = performance.now();
  const rows = await run();
  const elapsed = performance.now() - started;
  const bytes = size(rows);
  const count = Array.isArray(rows) ? rows.length : 1;
  const rendered = bytes > 1024 * 1024 ? `${mb(bytes)} MB` : `${kb(bytes)} KB`;
  console.log(
    `  ${label.padEnd(46)} ${String(count).padStart(6)} rows  ${`${Math.round(elapsed)}ms`.padStart(8)}  ${rendered.padStart(10)}`,
  );
  return { label, count, ms: Math.round(elapsed), bytes };
}

async function main() {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(students);
  console.log(`\n  students in database: ${total}\n`);
  console.log(`  ${"shape".padEnd(46)} ${"rows".padStart(6)}       ${"time".padStart(8)}  ${"payload".padStart(10)}`);
  console.log(`  ${"-".repeat(84)}`);

  // Before: every student, every relation expanded.
  await measure("BEFORE  unpaginated + full chain", () =>
    db.query.students.findMany({ with: HEAVY, orderBy: [desc(students.created_at)] }),
  );

  // After: one page, trimmed projection.
  await measure("AFTER   page of 50 + list chain", () =>
    db.query.students.findMany({ with: LIGHT, orderBy: [desc(students.created_at)], limit: 50 }),
  );

  // The group-list payload (P1-4): the roster is fetched only to be counted.
  await measure("BEFORE  groups + full roster", () =>
    db.query.groups.findMany({
      where: eq(groups.is_active, true),
      with: {
        professor: { with: { field: { with: { level: true } } } },
        assignments: {
          with: { student: { columns: { id: true, first_name: true, last_name: true, status: true } } },
        },
      },
      orderBy: [desc(groups.created_at)],
    }),
  );

  await measure("AFTER   groups, counts only", () =>
    db.query.groups.findMany({
      where: eq(groups.is_active, true),
      with: { professor: { with: { field: { with: { level: true } } } } },
      orderBy: [desc(groups.created_at)],
    }),
  );

  console.log("");
  await close();
}

main().catch(async (err) => {
  console.error(err);
  await close();
  process.exit(1);
});
