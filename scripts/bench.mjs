/**
 * Endpoint benchmark harness.
 *
 * Measures wall time and response size for the endpoints the performance audit
 * identified, against whatever data the database currently holds. Response size
 * is reported alongside latency because on several of these screens the payload
 * — not the query — was the bottleneck, and a fast query that ships three
 * megabytes still produces a slow page.
 *
 *   node scripts/bench.mjs                 # run every case
 *   node scripts/bench.mjs students        # only cases matching a substring
 *   node scripts/bench.mjs --json out.json # also write raw results
 *
 * Credentials come from apps/backend/.env, so it authenticates the same way the
 * browser does (httpOnly session cookie).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.BENCH_API ?? "http://localhost:3001/api";

/** Rounds to one decimal so the numbers stay readable. */
const ms = (n) => Math.round(n * 10) / 10;

function env(key, fallback) {
  try {
    const text = readFileSync(join(ROOT, "apps/backend/.env"), "utf8");
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The cases, in the order the audit ranks them.
 *
 * `note` records what the case is meant to expose, so a number that moves can
 * be read without going back to the report.
 */
const CASES = [
  { name: "students:list-page1", path: "/students?page=1&limit=50", note: "P0-1 paged student list" },
  { name: "students:list-search", path: "/students?page=1&limit=50&search=ben", note: "P0-1 server-side search" },
  { name: "students:list-unpaged", path: "/students", note: "P0-1 legacy capped branch" },
  { name: "payments:students-view", path: "/financial/payments?view=students&page=1&limit=50", note: "P0-2 cash-desk ledger" },
  { name: "payments:list-view", path: "/financial/payments?page=1&limit=50", note: "P0-2 invoice list (already paged)" },
  { name: "payments:search", path: "/financial/payments?view=students&page=1&limit=50&search=ben", note: "P1-5 accent-folded search" },
  { name: "groups:list", path: "/groups", note: "P1-4 group list payload" },
  { name: "professors:list", path: "/professors", note: "list payload" },
  { name: "hierarchy:summary", path: "/hierarchy/summary", note: "SQL roll-ups (already good)" },
  { name: "financial:dashboard", path: "/financial/dashboard", note: "P1-5 8 aggregates + lifetime SUM" },
  { name: "analytics:revenue", path: "/financial/analytics/revenue?granularity=monthly", note: "P1-3 series bucketing" },
  { name: "analytics:breakdown-level", path: "/financial/analytics/breakdown/level", note: "P1-3 nested breakdown" },
  { name: "analytics:status-dist", path: "/financial/analytics/status-distribution", note: "grouped aggregate" },
  { name: "audit:list", path: "/audit-logs?page=1&limit=50", note: "audit page" },
  { name: "audit:search", path: "/audit-logs?page=1&limit=50&search=paiement", note: "P1-5 audit text search" },
  { name: "audit:filter-options", path: "/audit-logs/options", note: "P1-6 SELECT DISTINCT scans" },
  { name: "payroll:list", path: "/financial/payroll", note: "batched entitlements" },
  // Scheduling. `MONTH` is rewritten to the current calendar month below, so
  // the calendar cases always land on a range that actually holds sessions.
  { name: "schedule:occurrences-month", path: "/scheduling/occurrences?from=MONTH_FROM&to=MONTH_TO", note: "calendar month expansion" },
  { name: "schedule:occurrences-year", path: "/scheduling/occurrences?from=YEAR_FROM&to=YEAR_TO", note: "worst-case expansion range" },
  { name: "schedule:occurrences-count", path: "/scheduling/occurrences/count?from=MONTH_FROM&to=MONTH_TO", note: "dashboard session count" },
  { name: "schedule:entries-list", path: "/scheduling/entries?active=true", note: "entries page, unbounded list" },
  { name: "schedule:conflicts", path: "/scheduling/conflicts", note: "full timetable clash scan" },
  { name: "schedule:classrooms", path: "/scheduling/classrooms", note: "reference list" },
  { name: "schedule:time-slots", path: "/scheduling/time-slots", note: "reference list" },
  { name: "schedule:working-hours", path: "/scheduling/working-hours", note: "settings list" },
];

/** Substitutes the date placeholders in CASES against today's calendar. */
function resolveDates(path) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  return path
    .replace("MONTH_FROM", iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))))
    .replace("MONTH_TO", iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))))
    .replace("YEAR_FROM", iso(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))))
    .replace("YEAR_TO", iso(new Date(Date.UTC(now.getUTCFullYear(), 11, 31))));
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: env("SEED_ADMIN_EMAIL", "admin@school.local"),
      password: env("SEED_ADMIN_PASSWORD", "change_me_password"),
    }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie?.() ?? [];
  const jar = cookie.map((c) => c.split(";")[0]).join("; ");
  if (!jar) throw new Error("login succeeded but set no session cookie");
  return jar;
}

async function timeIt(cookie, path) {
  const started = performance.now();
  const res = await fetch(`${API}${path}`, { headers: { cookie } });
  const body = await res.arrayBuffer();
  return { ms: performance.now() - started, bytes: body.byteLength, status: res.status };
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonAt = process.argv.indexOf("--json");
  // The value following --json is its argument, not a case filter.
  const jsonValue = jsonAt === -1 ? null : process.argv[jsonAt + 1];
  const filter = argv.find((a) => !a.startsWith("--") && a !== jsonValue);
  const cookie = await login();

  const cases = filter ? CASES.filter((c) => c.name.includes(filter)) : CASES;
  const results = [];

  console.log(`\n  ${cases.length} case(s) against ${API}\n`);
  console.log("  " + "case".padEnd(30) + "status".padEnd(8) + "median".padStart(9) + "  " + "size".padStart(10) + "   note");
  console.log("  " + "-".repeat(100));

  for (const c of cases) {
    const path = resolveDates(c.path);
    // One warm-up so the first case does not absorb connection setup, then
    // three timed runs reported by median — these endpoints have in-process
    // caches, and a mean would blend the cold miss with the warm hits.
    await timeIt(cookie, path).catch(() => {});
    const runs = [];
    let last = null;
    for (let i = 0; i < 3; i++) {
      last = await timeIt(cookie, path);
      runs.push(last.ms);
    }
    runs.sort((a, b) => a - b);
    const median = runs[1];
    const kb = last.bytes / 1024;
    const size = kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(1)} KB`;

    results.push({ name: c.name, path, ms: ms(median), bytes: last.bytes, status: last.status });
    const flag = last.status >= 400 ? " <-- FAILED" : "";
    console.log(
      "  " + c.name.padEnd(30) + String(last.status).padEnd(8) +
      `${ms(median)}ms`.padStart(9) + "  " + size.padStart(10) + "   " + c.note + flag,
    );
  }

  if (jsonAt !== -1 && process.argv[jsonAt + 1]) {
    writeFileSync(process.argv[jsonAt + 1], JSON.stringify(results, null, 2));
    console.log(`\n  wrote ${process.argv[jsonAt + 1]}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(`\n  bench failed: ${err.message}\n`);
  process.exit(1);
});
