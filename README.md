# School Management System — Intern Management System

Admin portal for managing the academic hierarchy (Field → Professor → Level → Group → Student)
and monthly cash tuition payments.

## Download & install

**Windows (recommended):** download `SystemeGestionScolaire-Setup-1.0.2.exe` from
[Releases](https://github.com/Mohamed-ncib19/School-Managment-System/releases),
run it and answer the school-details wizard once. The installer provides Node.js
(if missing), creates the database and role, and puts a “Système de gestion
scolaire” shortcut on the desktop — from then on, double-click that shortcut to
start, stop and open the system (see Daily use below).

**macOS / Linux:** clone the repository, then run `./installer/macos/start.sh`.

You need Windows 10/11 (or macOS/Linux with Node.js 20.9+) and an internet
connection for the first install. **Updating:** a git checkout updates
itself — log in and apply the in-app update (Settings → Mises à jour du
système), which handles code, dependencies, schema and restart with a safety
database dump taken first, and no data is touched. An install made with
Setup.exe updates by running the newest Setup.exe over the existing folder
(Next/Next): configuration, database and backups are preserved; only the
program files refresh, and the installer links version control when it can so
later updates arrive in the app.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), TanStack Query, Tailwind, shadcn/ui, Recharts, React Hook Form + Zod |
| Backend | NestJS 10, Drizzle ORM, class-validator DTOs |
| Database | PostgreSQL 16 |
| Auth | JWT access + refresh |

There is no job runner, no message broker and nothing running on a timer:
every operation happens inside the request that asked for it. Payment status is
a stored column that the `POST /api/financial/payments/refresh-statuses`
endpoint rolls forward on demand — the app never advances it in the background.

## Repository layout

Single **pnpm monorepo**, chosen over two repos because the frontend and backend share
domain types (`packages/shared`) and are always released together — one `pnpm install`,
one lockfile, and type changes stay in sync by construction.

```
apps/backend      NestJS API — one module per entity
apps/frontend     Next.js App Router, nested routes mirroring the hierarchy
packages/shared   Enums shared by both sides (UserRole, PaymentStatus, …)
installer/        Windows installer (Inno Setup), the desktop control panel,
                  and the engine scripts it drives — see installer/BUILD.md
installer/macos/  start.sh entry point for macOS & Linux, helpers in scripts/
backups/          Timestamped database dumps (git-ignored)
docker-compose.yml  PostgreSQL 16 — alternative to a native install
```

## Daily use

**Windows — double-click the “Système de gestion scolaire” shortcut on the desktop.**
**macOS / Linux — run `./installer/macos/start.sh`.**

On Windows the shortcut opens a small control panel: it shows whether the web portal, the
API and the database are running, and offers **Démarrer**, **Arrêter**, **Redémarrer**,
**Ouvrir le portail** and **Aide et assistance**. Starting from there installs anything
missing (Node.js, pnpm, packages), starts PostgreSQL if it isn't running, creates the
database and role on first run, applies migrations, builds if needed and starts both
servers.

The control panel is the only thing a school ever double-clicks. There are no batch files
and no scripts to find: it is installed by `SystemeGestionScolaire-Setup.exe`, which also
runs the first-run wizard. Building that installer is documented in `installer/BUILD.md`.

### First run — the setup wizard

The first launch asks who the school is and does everything else automatically:

| Input | Meaning |
|---|---|
| **School name** | Becomes the banner, sidebar and settings name, the database name/user, and the default admin email (`admin@<school>.com`) |
| **Admin email** | Login for the `super_admin` account (Enter = generated default) |
| **Admin password** | Login password — at least 8 characters |

Everything generated from there — database name, database user, database password,
PostgreSQL superuser password, both JWT secrets — is random and stored in
`apps/backend/.env` (git-ignored). `apps/frontend/.env.local` is created the same way.

| Platform | How the wizard asks |
|---|---|
| Windows | Native dialog, written by `installer/engine/setup.ps1` (Node.js is auto-installed via winget when missing) |
| macOS / Linux | Terminal prompts in `installer/macos/start.sh` |

**Upgrading an existing installation** changes nothing: when `apps/backend/.env` already
contains a `DATABASE_URL`, the wizard is skipped and the previous database and credentials
keep working. No wizard, no restart, no data migration.

| Entry point | What it does |
|---|---|
| Desktop shortcut (Windows) | Opens the control panel — status, start, stop, restart, help |
| `installer/macos/start.sh` | Start everything on macOS and Linux |

**Updating** and **backing up** happen inside the logged-in web app: the "new
update" dialog finds and applies newer versions, and the Database Backup page
manages `pg_dump` backups. **Stopping** can be done either from the navbar's
power button or from the control panel — the control panel matters because it
still works when the portal itself will not load, which is exactly when
somebody needs it.

**In-app update notifications** — while logged in, the app quietly compares the
installed git commit against the release repository (every 30 minutes). When a new
version exists, a dialog offers **Update now** or **Update later**; Update now launches
the platform update engine on the school's own computer, which stops the servers, pulls,
installs, migrates and restarts. The comparison is a
single commit-id API call; `GITHUB_TOKEN` in `apps/backend/.env` lifts the anonymous rate
limit when many installations share one repo.

- **Tracked branch** — `UPDATE_BRANCH` in `apps/backend/.env` pins every
  school machine to the same release branch (self-hosted installs: `selfhosted`);
  without it the install compares against its own checked-out branch. The update
  engine (`do-update.ps1` / `update.sh`) reads the same variable.
- **Private repository** — `GITHUB_TOKEN` must be a classic PAT or fine-grained
  token with `Contents: Read` on the repo; without it GitHub answers `404` and the
  check reports "unreachable".
- The **navbar icon** (every page) shows a gold dot when a new version exists and
  re-checks on click; **Settings → System updates** shows the full status
  (branch, installed vs. latest commit, last check) with *Check now* / *Update now*.

The control panel runs watch-mode dev servers by default. `installer/engine/launcher.ps1 -Prod` builds and runs the
production servers instead. Backups are managed from the logged-in app:
Settings → **Database Backup** (create versioned backups, restore, safety dump included).

API docs (Swagger): <http://localhost:3001/api/docs>. All routes sit under `/api`;
`NEXT_PUBLIC_API_URL` must include it.

### Requirements

**Windows 10/11 and an internet connection. Nothing else.** Clone the repository,
run the installer, and it provides whatever is missing:

| Component | How it's obtained |
|---|---|
| Node.js LTS | winget, if `node` isn't on PATH |
| pnpm | corepack, falling back to npm |
| Packages | `pnpm install`, re-run only when the lockfile changes |
| **PostgreSQL 16** | An existing server or Windows service is used if present. Otherwise a private one is downloaded into `.postgres\` (~44 MB), checksum-verified, initialised and started — **no administrator rights needed** |
| Database + role | Created on first run (values generated by the wizard) |
| Schema | `drizzle-kit push` (idempotent, additive) |
| Admin account | Seeded, idempotently (email/password chosen in the wizard) |

The portable PostgreSQL comes from the `theseus-rs/postgresql-binaries` GitHub release
(a complete distribution including `psql`, `pg_dump` and `pg_restore`) rather than
EnterpriseDB, whose downloads are blocked by many corporate networks and proxies —
including this one, which 403s winget, Chocolatey and Scoop alike. The download is
verified against its published SHA256 before being extracted.

The portable server listens on `127.0.0.1` only and never registers a Windows service,
so it cannot be reached from the network and leaves nothing behind outside the project
folder.

## Manual setup (for development)

Requires Node.js 20.9 or newer (see `engines` in the root `package.json`) and a
reachable PostgreSQL 16. The Docker image pins `node:22-alpine` and the Windows
installer ships Node 20 LTS — anything in the `>=20.9` range runs the code.
On Windows, the control panel's **Démarrer** button does all of this
for you — including installing Node and creating the database — so this section
is for non-Windows machines and for working on the project itself.

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env      # then fill in DATABASE_URL and the secrets
cp apps/frontend/.env.example apps/frontend/.env.local
pnpm db:push        # apply the schema to the database
pnpm db:seed        # create the super_admin user and the settings rows
pnpm dev            # backend :3001, frontend :3000
```

`pg_trgm` backs every "contains" search in the app and creating an extension
needs superuser, which the application role deliberately is not. Once, as the
superuser:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

`pnpm db:seed` is the only seed. It creates the single `super_admin` operator
and the settings rows, and is idempotent — the launcher runs it on every start.
The sample-data seeds that used to sit beside it (a demo school, a generated
hierarchy, a year of invoices, a weekly timetable) were removed: they existed to
exercise the screens during development, and a school's real data comes from the
Excel import.

### Checking a change

```bash
pnpm test                # unit tests (jest) — no database, no running server
pnpm bench               # endpoint latency and response size, against the current database
pnpm verify:scheduling   # asserts the scheduling API still returns every field the UI reads
```

`pnpm test` stands alone. `bench` and `verify:scheduling` need the backend
running (`pnpm dev`) and read the admin credentials from `apps/backend/.env`.

The unit tests cover the logic that is wrong silently rather than loudly — the
Saturday-based weekday rotations and the closed-form occurrence walk, where an
error produces plausible output on the wrong day rather than an exception. Jest
was configured in `apps/backend/package.json` long before there was a `test`
script to run it, so the one spec that existed could not be executed by any
documented command.

## Backups

Backups are created and restored from the **logged-in app**: Settings → Database Backup.
You can create a timestamped, versioned `pg_dump` of the database, list all backups, and
restore one. Restoring **replaces** the current contents — so a safety dump of the present
state is taken first, meaning even a mistaken restore is recoverable. Confirmation requires
typing `RESTORE`.

`backups/` and `logs/` are git-ignored: they hold real school data.

## Machine binding (anti-copy protection)

The project is bound to the computer it is first started on. On every launch,
The launcher – and the backend itself at boot – compare a SHA256 of
the Windows `MachineGuid` (`HKLM\SOFTWARE\Microsoft\Cryptography`) against
`machine.lock` in the project root. Copying the folder to another computer
(USB drive, hard disk) therefore **refuses to start** on the target machine,
since the identifier never travels with the files.

- First run on a computer creates `machine.lock` and binds automatically.
- `machine.lock` is machine-specific and git-ignored – never commit it.
- Legitimate moves (new computer, Windows reinstall): the manager deletes
  `machine.lock`; the next start binds the project to that machine.
- Script: `installer/engine/machine-id.ps1` (`check` / `bind` / `info`).
  macOS/Linux dev hosts skip the check (no MachineGuid).

## Importing students from Excel

**Import Data** in the sidebar. Download the template, fill it in, upload it.

One row per student, with the hierarchy given by name:

| Field | Professor | Professor Phone | Level | Group | First Name | Last Name | Phone | Parent Phone | Email | Enrollment Date | Monthly Fee | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

- Columns match **by name**, so order doesn't matter and extra columns are ignored.
- Any Field / Professor / Level / Group named in the file that doesn't exist yet is
  **created**; existing ones are matched by name and reused. Nothing is overwritten.
- A student already in the same group with the same first and last name is **skipped**,
  so re-uploading the same file is safe.
- Rejected rows are reported individually with the reason; the rest still import.
- The whole import runs in one transaction — a failure can't leave a half-built hierarchy.
- Dates accept Excel date cells, `DD/MM/YYYY`, and ISO formats. `Status` defaults to `active`.

## Conventions

- **Response envelope** — every endpoint returns `{ data, meta, error }`, applied globally by
  `TransformInterceptor`; errors are normalised by `AllExceptionsFilter`.
- **Design tokens** — colours, spacing, radii, shadows and type scale are defined once in
  `apps/frontend/tailwind.config.ts`. Components must not hard-code hex values or
  arbitrary pixel spacing.
- **Naming** — kebab-case files, `PascalCase` components, `camelCase` values, plural table names.

## Locked product decisions

Confirmed with the client; recorded here so they don't get silently re-litigated.

| Question | Decision |
|---|---|
| Billing day | **Enrollment anniversary.** `due_date` derives from `students.enrollment_date`; short months clamp to the last valid day (a 31st enrollment bills the 30th/28th). |
| Partial payments | **Not supported in Phase 1.** Strictly paid / not-paid; `paid_amount` always equals `amount_due`. The column exists so a `partially_paid` state is a later migration, not a rewrite. |
| Reminders | **Dashboard only.** No SMS/email/WhatsApp integration in Phase 1. |
| Roles | **`super_admin` only.** The `users.role` column and `RolesGuard` exist so `field_manager` / `prof` / `accountant` can be added without redesign — but no UI or permission logic for them yet. |

## Explicitly out of scope for Phase 1

Second user roles, messaging notifications, partial payment tracking, and
multi-tenant / multi-school support.
