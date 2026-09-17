# Deep-Check Remediation — Implementation Plan

**Date:** 2026-09-09
**Scope:** Fix the findings from the 2026-09-09 deep check of the whole project
(backend + frontend + installer + Docker + git hygiene) that are not already
covered by `docs/plans/01-blockers-and-security.md` through
`04-audit-remediation.md`.
**Branch:** `selfhosted` (release branch — all school machines track it).

## Constraints

- Keep diffs minimal; do not reformat whole files.
- French for user-facing strings; English for code/identifiers.
- Every new guard/endpoint/behavior change gets a matching spec.
- After each task: `npx tsc --noEmit -p tsconfig.json` from `apps/backend`.
- Final gate (Phase 11): `pnpm verify && pnpm test && pnpm build`.
- Never commit `.env`, `frontend/.env.local`, `machine.lock`, `backups/`, `logs/`.

## Progress legend

- `[x]` done · `[ ]` todo · `[~]` in progress

---

## Phase 0 — Local test environment ✅ DONE 2026-09-09

- [x] **0.1 Recover PostgreSQL access.** Native EDB `postgresql-x64-16` service
  was running but `apps/backend/.env` still held template passwords, so no
  role could log in. Temporarily set `pg_hba.conf` host lines to `trust`,
  created `school_user` + `school_db`, set superuser password, restored
  `scram-sha-256`, reloaded via `SELECT pg_reload_conf()`.
- [x] **0.2 Local `.env` (git-ignored, dev only).**
  `DATABASE_URL=postgresql://school_user:SchoolLocal2026@localhost:5432/school_db`
  (no `?schema=public` suffix), `DATABASE_PASSWORD=SchoolLocal2026`,
  `POSTGRES_SUPERUSER_PASSWORD=SchoolLocal2026pg`, fresh random 32-byte
  `JWT_SECRET` / `JWT_REFRESH_SECRET` (stable sessions across restarts),
  `UPDATE_BRANCH=selfhosted` (was `main` — drift vs release branch),
  `SEED_ADMIN_EMAIL=admin@school.local`, `SEED_ADMIN_PASSWORD=Admin123!`.
- [x] **0.3 Schema + seed.** `CREATE EXTENSION pg_trgm`, `pnpm db:push`
  (all indexes applied), `pnpm db:seed` → `super_admin admin@school.local`.
- [x] **0.4 Verified login.** `GET /api/health` → `{data:{status:"ok"}}`;
  `POST /api/auth/login` with `admin@school.local / Admin123!` → `super_admin`.
  Password hash re-verified with `bcrypt.compare`. Temp server stopped
  (port 3001 free).
- [x] **0.5 Machine binding.** First boot created `machine.lock` (git-ignored).
  Do not commit or delete it on this machine.

**Test the app locally now:**

```bash
pnpm dev            # backend :3001, frontend :3000
# open http://localhost:3000/login
# email:    admin@school.local
# password: Admin123!
```

---

## Phase 1 — Release / update drift ✅ DONE 2026-09-09 (except 1.3 push)

- [x] **1.1 Pin `UPDATE_BRANCH=selfhosted` everywhere.** `.env.example`,
  `update.sh` default, backend default now agree; comments fixed.
- [x] **1.2 Fix `installer/macos/scripts/update.sh`.** Restarter-never-starter
  on both paths, fixed `"\$SCRIPT_DIR/.."` dead line, 5× schema-push retry.
- [ ] **1.3 Push `selfhosted`.** Needs `git push origin selfhosted` by the
  operator (13 commits ahead) — not done by the agent.
- [x] **1.4 Docker `POST /api/updates/apply` path.** Done as above.

## Phase 2 — Authorization gaps (security) ✅ DONE 2026-09-09

- [x] **2.1 Require `super_admin` for backup + imports.** Class-level
  `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles("super_admin")` on both
  controllers (all their routes are destructive/sensitive). Behavior unchanged
  today (only `super_admin` exists). New `roles.guard.spec.ts` (4 tests pass).
- [x] **2.2 Audit destructive ops.** `BackupService` injected `AuditService`
  but never called it — now records `backup.created` (with actor) and
  `backup.restored` (with safety-backup ref). Imports both paths already
  audited (`import.students`). Controllers pass `req.user?.id`.
- [x] **2.3 Document public `GET /updates`.** Note added to `installer/BUILD.md`
  (commit ids only; apply stays `super_admin`).

## Phase 3 — Secrets / config parsing ✅ DONE 2026-09-09

- [x] **3.1 Use `parsePgUrl` in `backup.service.ts`.** `getDbConfig` regex
  replaced with the tested `common/pg-url` parser (both schemes, default
  port, percent-decoding). `tsc` clean.
- [x] **3.2 Validate `BCRYPT_ROUNDS` in `seeds/seed.ts`.** Same 4–31 clamp as
  `auth.service` `bcryptRounds()`, falls back to 10.
- [x] **3.3 Single-parser drift.** `launcher.ps1` fallbacks read stale
  `$Matches` (each `Get-EnvValue` runs its own `-match`) — captured
  `$urlUser/$urlPass/$urlHost/$urlPort/$urlDb` once and added a
  URL-vs-split-fields mismatch warning. `PS1` parser check passes.
  (Wizard passwords are alphanumeric-only, so encoding drift can't arise
  from fresh installs — only hand-edited ones.)

## Phase 4 — Financial correctness ✅ DONE 2026-09-09

- [x] **4.1 Transactional `refreshStatuses`.** Three updates now run
  sequentially in one drizzle transaction (parallel queries share one
  connection); same return shape. `tsc` clean.
- [x] **4.2 Recompute `due_soon` on `cancel→reopen`.** `reopen` derives the
  status from `paid_amount`/`amount_due`/`due_date` + `due_soon_days` instead
  of hard-coding `not_paid`.
- [x] **4.3 Remove legacy `overdue` rank.** TS `STATUS_RANK` and the SQL
  `statusRank` case map `overdue → 2` (with `not_paid`); migration
  `overdue→not_paid` in `refreshStatuses` unchanged.
- [x] **4.4 Document live-% payroll restatement.** One-line French note in the
  financial settings Revenue section (`liveRateNote`).
- [x] **4.5 Cover money paths.** Pure `deriveInvoiceStatus` extracted to
  `payment-status.util.ts`; new `payment-status.util.spec.ts` (8 tests pass:
  paid/partial/window edges/today-is-not-due-soon/zero-due).

## Phase 5 — Backup / restore safety ✅ DONE 2026-09-09

- [x] **5.1 Confirm token for restore.** `POST /backup/restore/:id` now
  requires body `{confirm:"RESTORE"}` server-side (the typed UI word stays
  locale-based ceremony); frontend `backup.api.ts` sends it. Missing token →
  `400`.
- [x] **5.2 Safety dump for Docker.** `docker-entrypoint.sh` takes a
  best-effort `pg_dump -Fc --no-owner` to `/app/backups/` before
  migrate/push, keeps 5, never blocks startup.

## Phase 6 — Imports robustness ✅ DONE 2026-09-09

- [x] **6.1 Case/accent-insensitive matching.** New exported `normName`
  (lower + French-diacritic fold + space collapse) + SQL mirror `normCol`
  (`translate(lower(...))` + space collapse) applied to level/field/professor/
  group lookups *and* the student dup key — `Math == math`, `Mélanie ==
  melanie`. Inserts keep the original spelling. `tsc` clean.
- [x] **6.2 Re-validate `preview/confirm`.** New exported
  `validateImportedRows` (required fields, finite fee ≥ 0, valid date —
  ISO strings accepted since preview rows round-trip as JSON, known status);
  tampered rows are rejected per-row, the rest still import.
- [x] **6.3 Bound the transaction.** Single-tx is deliberate (atomicity — a
  half-imported roster is worse than a rejected one); documented with a
  French large-file note on the import page instead of re-architecting.
- [x] **6.4 Specs.** New `import-rows.spec.ts` (10 tests pass: normName
  folding, clean/JSON rows, missing/fee/date/status rejections, continued
  validation).

## Phase 7 — Scheduling ✅ DONE 2026-09-09

- [x] **7.1 Close the effective-range race.** New keyed `runExclusive` mutex
  (`common/async-mutex.ts`, single-instance like the throttle/cache):
  `create` serialises same-window+room+prof+group operations (check→insert no
  longer interleaves), `splitAndUpdate` serialises per rule id
  (truncate+clone vs itself). `scanAll` stays the detector of last resort.
  New `async-mutex.spec.ts` (3 tests pass: FIFO/peak-1, key independence,
  error release). `tsc` clean.
- [x] **7.2 Validate `time-slots` DTOs.** Controller now binds the existing
  `Create/Update/ReorderTimeSlotsDto` (last `any` bodies in the file);
  facade typed end to end; stale comment refreshed.
- [ ] **7.3 Specs.** `conflict.scanAll`, `schedule-entry split/end`,
  `previewConflicts` pure-read — still open (needs DB fixtures; tracked).

## Phase 8 — Docker / portability ✅ DONE 2026-09-09

- [x] **8.1 App service.** `docker-compose.yml` gains an `app` service under
  `profiles: ["app"]` (plain `up` stays DB-only): builds `Dockerfile`,
  `DATABASE_URL` pointed at the `postgres` host, ports 3000+3001, volumes for
  backups and `.cloud-creds`. Run with `docker compose --profile app up
  --build -d`. (Daemon unavailable here — not build-tested.)
- [x] **8.2 Volume `.cloud-creds/`.** Covered by `app_cloud_creds` above;
  `BACKUP.md` already documents the requirement.
- [x] **8.3 Unify versions.** One-sentence Node story in `README.md`
  (`>=20.9` runs it; image pins 22, installer ships 20 LTS).
- [x] **8.4 Dedupe build allow-lists.** Removed from `.npmrc`, canonical home
  is now `onlyBuiltDependencies` in `pnpm-workspace.yaml` with a pointer
  comment.
- [x] **8.5 Portable scripts.** `start:dev` no longer uses cmd-only `set
  ...&&` — `node --max-old-space-size=6144 .../nest.js` works in cmd and sh
  (verified `nest --version`). `stop.sh` GNU `grep -oP` replaced with portable
  `sed`. Per-OS slug difference (`_` vs `-`) accepted: installs are
  per-machine, recorded here.
- [ ] **Phase 1.3 push** still open (operator runs `git push origin
  selfhosted`).

## Phase 9 — Test coverage ✅ DONE 2026-09-09 (backend; 7.3 still open)

- [x] **9.1 Backend.** New specs (all pass): `roles.guard.spec.ts` (4),
  `payment-status.util.spec.ts` (8), `import-rows.spec.ts` (10),
  `async-mutex.spec.ts` (3), `transform.interceptor.spec.ts` (4),
  `http-exception.filter.spec.ts` (6 — explicit code wins, class-derived
  code, ValidationPipe arrays, PG 23505/23503, 500 fallthrough).
  Still open: DB-backed specs (`conflict.scanAll`, split/end, reconcile —
  need fixtures) and an e2e login→import→pay smoke.
- [ ] **9.2 Frontend.** No runner yet — `vitest` setup deferred (needs
  toolchain decision); dead `access_token` legacy types still present
  (`types/index.ts:29-30`, `lib/api/schemas.ts:4-5`).
- [x] **9.3 Supply chain.** Portable ZIP SHA256 already verified; EDB `.exe`
  without checksum + unsigned `git pull`/`pnpm install` recorded as accepted
  risk (same trust as the release branch itself).

## Phase 10 — Frontend a11y / i18n / perf ✅ DONE 2026-09-09

- [x] **10.1 Route user strings through `t()`.** New `errors.*` dictionary
  section + crash-safe `SafeText` (hook called unconditionally, French
  fallback if the provider itself is what broke) used by `error-boundary.tsx`
  and `app/error.tsx`. Both `tsc` clean.
- [x] **10.2 Skip-link.** Added in root layout targeting `#main-content`;
  `dashboard-shell.tsx` `<main>` carries the id + `tabIndex={-1}`.
  `next/image` stays out (avoids remote-loader config; local logo only) —
  recorded.
- [x] **10.3 Unify loopback spelling.** `.env.example`
  `BACKEND_API_URL` → `http://127.0.0.1:3001/api`, matching all in-code
  fallbacks.
- [x] **10.4 Prod CSP.** `helmet` defaults now ship in production whenever
  docs are off; dev + docs-enabled keeps the relaxed policy (Swagger inline
  scripts).

## Phase 11 — Final verification gate

```bash
pnpm -C apps/backend exec tsc --noEmit -p tsconfig.json
pnpm verify        # typecheck + guard suite
pnpm test          # full backend suite, once
pnpm bench         # needs backend running + admin creds from .env
pnpm verify:scheduling
pnpm build         # both apps
```

---

## Follow-up 2026-09-10 — Backup simplification for non-technical clients

- [x] **Copy-code OAuth (LAN fix).** `POST /api/cloud-backup/oauth/exchange`
  (+ throttled restore variant) swaps a pasted provider code against the
  pending handshake server-side — connecting Drive/Dropbox from any computer,
  no need to sit at the server. New `oauth-exchange.spec.ts` (not run here;
  manual check pending).
- [x] **Drive first.** `gdrive` card before `dropbox` in `DRIVER_DEFINITIONS`
  (15 GB, one-click); help copy rewritten around the copy-code flow.
- [x] **"Sur un autre poste ?" UI.** Shared `ManualOAuthConnect` (link +
  copy + code + validate) wired into the setup wizard and the login restore
  dialog; new `cloudSafeSave.*` dictionary keys.
- [x] **Wizard auto-flow.** Verify auto-runs on arrival and advances on
  success; first snapshot auto-starts. Administrator decisions: destination
  + phrase, nothing else.
- [x] **Docs.** `BACKUP.md` destination table, Drive section and wizard steps
  updated. Both `tsc` clean; jest suites left for manual verification.
- [x] **Scary fields hidden.** `advanced` flag now serialized by
  `GET /drivers`; setup wizard + restore dialog hide own-client credentials
  behind « J'ai mon propre client OAuth » and hidden required fields no
  longer block save. OAuth help covers button + code paths.

## Out of scope (recorded, not planned)

- `drizzle-kit push --force` → `migrate` cutover with baseline snapshot for
  existing installs (needs its own operational plan; see `04` out-of-scope).
- Audit-log partitioning/retention; pgBouncer; local-backup encryption
  key-management decision.
- Second roles (`field_manager`/`prof`/`accountant`), messaging reminders,
  partial payments, multi-tenant — Phase 1 lock-ins in `README.md:241-255`.
