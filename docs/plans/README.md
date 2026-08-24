# Cloud Backup Remediation Plan

Fixes for the 40 defects found reviewing the uncommitted cloud-backup subsystem on `selfhosted` (2026-08-23). 22 tasks across three documents.

| Document | Tasks | Covers |
|---|---|---|
| [`01-blockers-and-security.md`](01-blockers-and-security.md) | 1–8 | Credential hygiene, the five blockers that make the subsystem non-functional, restore endpoint guards, HTTP hardening |
| [`02-sync-durability.md`](02-sync-durability.md) | 9–14 | Queue retry, split-brain heartbeat, the `pg_dump`/`psql` subprocess bugs, actor attribution, Docker machine identity, safe re-setup |
| [`03-codec-drivers-hygiene.md`](03-codec-drivers-hygiene.md) | 15–22 | The guard-suite runner, object codec integrity, the three storage drivers, environment assumptions, replay correctness, operability, and the final verification gate |

The coverage matrix at the end of document 3 maps all 40 findings to a task and a named regression test.

---

## Read this before starting

**Do not run the test suite between steps.**

Documents 1 and 2 print a "run the test to verify it fails / passes" step inside each task. Those steps are superseded by the **Deferred verification protocol** at the top of document 3. The short version:

- `npx jest` compiles all 179 backend files through `ts-jest`, type-checking each in a worker. That is minutes of CPU and gigabytes of RAM per invocation, roughly forty invocations across this plan, for guards that are pure functions over buffers and strings.
- So: **author the test, author the fix, then run `npx tsc --noEmit` only.** Seconds, one process, and it catches the signature drift between tasks that is the real cross-task risk.
- Task 15 builds `jest.guards.config.js` — a runner scoped to the guard directories with `isolatedModules: true`, so types come from the single `tsc` pass instead of N workers. `pnpm test:guards` then runs the whole guard suite in seconds.
- Task 22 is the one place the full suite runs, once, at the end.

Per-task loop:

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json    # the only check you need between tasks
```

Final gate (Task 22):

```bash
pnpm verify        # tsc + guard suite, seconds
pnpm test          # full suite, once
pnpm build         # both apps, catches the frontend edits
```

---

## If time is short

Tasks 1–6 plus 22 produce a cloud backup that works end to end. Everything after that is durability, hardening and cleanup for a second pass.

Tasks 1–3 are independent of each other; 4–6 touch separate files. Task 15 must land before Task 16. Everything from 16 on can be done in any order.
