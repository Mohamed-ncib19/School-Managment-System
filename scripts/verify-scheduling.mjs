/**
 * Contract check for the scheduling API.
 *
 * Asserts that every field the frontend actually reads is present and
 * populated. The payloads on these routes were trimmed hard — the calendar was
 * shipping whole professor rows on every occurrence — and the risk of trimming
 * is silent: a dropped column does not fail a build or a type check, it renders
 * as a blank cell on one screen nobody opened that week. This walks the same
 * fields the components read.
 *
 * It also pins two behaviours that are easy to regress: the session count must
 * equal a full expansion (they are computed by different code paths), and the
 * conflict preview must not write to the database.
 *
 *   pnpm verify:scheduling        # backend must be running
 *
 * Credentials come from apps/backend/.env, as with scripts/bench.mjs.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.BENCH_API ?? "http://localhost:3001/api";
const require = createRequire(join(ROOT, "apps/backend/package.json"));
const { Client } = require("pg");

function env(key, fallback) {
  const text = readFileSync(join(ROOT, "apps/backend/.env"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : fallback;
}

let pass = 0;
let fail = 0;
function check(label, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: env("SEED_ADMIN_EMAIL", "admin@school.local"),
    password: env("SEED_ADMIN_PASSWORD", "change_me_password"),
  }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

async function get(path) {
  const r = await fetch(`${API}${path}`, { headers: { cookie } });
  const body = await r.json();
  return { status: r.status, data: body.data ?? body, raw: body };
}
async function post(path, payload) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, data: body.data ?? body, raw: body };
}

const month = (() => {
  const n = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    from: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))),
    to: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0))),
  };
})();

console.log("\n--- occurrences (calendar) ---");
const occ = await get(`/scheduling/occurrences?from=${month.from}&to=${month.to}`);
check("200", occ.status === 200);
check("non-empty", occ.data.length > 0, `got ${occ.data.length}`);
const o = occ.data[0];
// Exactly what calendar/page.tsx reads off an occurrence.
for (const key of ["occurrenceId", "scheduleEntryId", "date", "start_time", "end_time", "status"]) {
  check(`occurrence.${key}`, o?.[key] !== undefined);
}
check("occurrence.group.name", typeof o?.group?.name === "string", JSON.stringify(o?.group));
check("occurrence.group.color present (may be null)", o?.group && "color" in o.group);
check("occurrence.group.field readable", o?.group && "field" in o.group);
check("occurrence.professor.full_name", typeof o?.professor?.full_name === "string");
const withRoom = occ.data.find((x) => x.classroom);
check("occurrence.classroom.name", typeof withRoom?.classroom?.name === "string");
check("occurrence.classroom.room_number key", withRoom?.classroom && "room_number" in withRoom.classroom);
// The waypoint must be gone — that was the 45% of the payload.
check("occurrence.group.professor dropped", o?.group?.professor === undefined);
const fieldNamed = occ.data.find((x) => x.group?.field);
check("group.field.name still resolved", typeof fieldNamed?.group?.field?.name === "string");
const cancelled = occ.data.find((x) => x.status === "cancelled");
check("exceptions still applied", !!cancelled, "no cancelled occurrence found");

console.log("\n--- occurrences/count (dashboard) ---");
const cnt = await get(`/scheduling/occurrences/count?from=${month.from}&to=${month.to}`);
check("200", cnt.status === 200);
check("count matches full expansion", cnt.data === occ.data.length, `count=${cnt.data} expansion=${occ.data.length}`);

console.log("\n--- entries list ---");
const entries = await get("/scheduling/entries?active=true");
check("200", entries.status === 200);
const e = entries.data[0];
for (const key of ["id", "group_id", "time_slot_id", "prof_id", "effective_from", "is_active"]) {
  check(`entry.${key}`, e?.[key] !== undefined);
}
check("entry.time_slot.day_of_week", typeof e?.time_slot?.day_of_week === "number");
check("entry.time_slot.start_time", typeof e?.time_slot?.start_time === "string");
check("entry.time_slot.label", typeof e?.time_slot?.label === "string");
check("entry.group.name", typeof e?.group?.name === "string");
check("entry.professor.full_name", typeof e?.professor?.full_name === "string");
check("entry.group.professor dropped", e?.group?.professor === undefined);
check("duplicate camelCase timeSlot dropped", e?.timeSlot === undefined);
const entryRoom = entries.data.find((x) => x.classroom);
check("entry.classroom.name", typeof entryRoom?.classroom?.name === "string");

console.log("\n--- derived schedules ---");
const groupId = e.group_id;
const gs = await get(`/scheduling/groups/${groupId}/schedule`);
check("group schedule 200", gs.status === 200);
check("group schedule has time_slot", gs.data.length === 0 || !!gs.data[0].time_slot);
const ps = await get(`/scheduling/professors/${e.prof_id}/schedule`);
check("professor schedule 200", ps.status === 200);
check("professor schedule has time_slot", ps.data.length === 0 || !!ps.data[0].time_slot);
if (entryRoom) {
  const cs = await get(`/scheduling/classrooms/${entryRoom.classroom_id}/schedule`);
  check("classroom schedule 200", cs.status === 200);
  check("classroom schedule has time_slot", cs.data.length === 0 || !!cs.data[0].time_slot);
}

console.log("\n--- groups list (trimmed hierarchy chain) ---");
const groups = await get("/groups?x=1");
check("200", groups.status === 200);
const g = groups.data[0];
check("group.professor.full_name", typeof g?.professor?.full_name === "string");
check("group.professor.field_id", typeof g?.professor?.field_id === "string");
check("group.professor.field.name", typeof g?.professor?.field?.name === "string");
check("group.professor.field.level_id", typeof g?.professor?.field?.level_id === "string");
check("group.professor.field.level.name", typeof g?.professor?.field?.level?.name === "string");
check("group.professor.field.level.id", typeof g?.professor?.field?.level?.id === "string");
check("group._count.students", typeof g?._count?.students === "number");
check("professor.phone no longer shipped", g?.professor?.phone === undefined);

console.log("\n--- conflict preview is a pure read ---");
const db = new Client({ connectionString: env("DATABASE_URL") });
await db.connect();
const before = (await db.query("select count(*)::int as n from time_slots")).rows[0].n;
// A window that certainly has no stored slot: an odd minute offset.
const preview = await post("/scheduling/conflicts/preview", {
  day_of_week: 3,
  start_time: "06:07:00",
  end_time: "06:53:00",
  prof_id: e.prof_id,
  exclude_group_id: groupId,
});
const after = (await db.query("select count(*)::int as n from time_slots")).rows[0].n;
check("preview 200/201", preview.status === 200 || preview.status === 201, `status ${preview.status}`);
check("preview returns an array", Array.isArray(preview.data), JSON.stringify(preview.raw).slice(0, 200));
check("preview created no time_slots row", before === after, `${before} -> ${after}`);

// And a window that overlaps a real session must still report the clash.
const slot = (await db.query(
  `select ts.day_of_week, ts.start_time, ts.end_time, se.prof_id, se.group_id
     from schedule_entries se join time_slots ts on ts.id = se.time_slot_id
    where se.is_active limit 1`,
)).rows[0];
const clashing = await post("/scheduling/conflicts/preview", {
  day_of_week: slot.day_of_week,
  start_time: slot.start_time,
  end_time: slot.end_time,
  prof_id: slot.prof_id,
});
check(
  "overlapping window still detected",
  Array.isArray(clashing.data) && clashing.data.length > 0,
  JSON.stringify(clashing.raw).slice(0, 200),
);
check("clash carries entityName", clashing.data?.[0]?.entityName?.length > 0);
await db.end();

console.log("\n--- conflicts scan ---");
const conflicts = await get("/scheduling/conflicts");
check("200", conflicts.status === 200);
check("conflicts shaped", conflicts.data.length === 0 || typeof conflicts.data[0].entityName === "string");

console.log("\n--- working hours ---");
const wh = await get("/scheduling/working-hours");
const bounds = await get("/scheduling/working-hours/bounds");
check("list 200", wh.status === 200);
check("bounds endpoint still served", bounds.status === 200);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
