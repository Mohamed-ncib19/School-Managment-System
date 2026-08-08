# School Management System — Intern Management System

Admin portal for managing the academic hierarchy (Field → Professor → Level → Group → Student)
and monthly cash tuition payments. Built to the spec in
[`school-management-architecture.md`](./school-management-architecture.md), which is the source of truth.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), TanStack Query, Tailwind, shadcn/ui, Recharts, React Hook Form + Zod |
| Backend | NestJS 10, Prisma 5, class-validator DTOs |
| Database | PostgreSQL 16 |
| Jobs | Redis 7 (BullMQ) / `@nestjs/schedule` |
| Auth | JWT access + refresh |

## Repository layout

Single **pnpm monorepo**, chosen over two repos because the frontend and backend share
domain types (`packages/shared`) and are always released together — one `pnpm install`,
one lockfile, and type changes stay in sync by construction.

```
apps/backend      NestJS API — one module per entity (§6)
apps/frontend     Next.js App Router, nested routes mirroring the hierarchy (§10)
packages/shared   Enums shared by both sides (UserRole, PaymentStatus, …)
tools/windows/    .bat entry points (start / stop / update) + PowerShell helpers
tools/macos/      .sh entry points (start / stop / update) for macOS & Linux
backups/          Timestamped database dumps (git-ignored)
docker-compose.yml  Postgres 16 + Redis 7 — alternative to a native install
```

## Daily use

**Windows — double-click `tools\windows\start.bat`.**
**macOS / Linux — run `./tools/macos/start.sh`.**

That's the whole workflow. It installs anything missing (Node.js, pnpm, packages), starts
PostgreSQL if it isn't running, creates the database and role on first run, applies
migrations, builds if needed, starts both servers and opens the portal.

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
| Windows | Native dialog, written by `tools/windows/scripts/setup.ps1` (Node.js is auto-installed via winget when missing) |
| macOS / Linux | Terminal prompts in `tools/macos/start.sh` |

**Upgrading an existing installation** changes nothing: when `apps/backend/.env` already
contains a `DATABASE_URL`, the wizard is skipped and the previous database and credentials
keep working. No wizard, no restart, no data migration.

| File | What it does |
|---|---|
| `tools/windows/start.bat`  /  `tools/macos/start.sh` | Start everything (also the installer on first run) |

That single file is the only one you ever click: **stopping**, **updating** and
**backing up** all happen inside the logged-in web app. The navbar's power
button shuts the system down (API + web portal, and on Windows the local
database too); the "new update" dialog finds and applies newer versions; and
the Database Backup page manages `pg_dump` backups. The `stop` and `update`
entry points were removed — every school gets one file to run, and the rest
lives in the app where settings and data belong.

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

`start.bat` runs watch-mode dev servers by default. `start.bat -Prod` builds and runs the
production servers instead. Backups are managed from the logged-in app:
Settings → **Database Backup** (create versioned backups, restore, safety dump included).

API docs (Swagger): <http://localhost:3001/api/docs>. All routes sit under `/api`;
`NEXT_PUBLIC_API_URL` must include it.

### Requirements

**Windows 10/11 and an internet connection. Nothing else.** Clone the repository,
double-click `tools\windows\start.bat`, and it installs whatever is missing:

| Component | How it's obtained |
|---|---|
| Node.js LTS | winget, if `node` isn't on PATH |
| pnpm | corepack, falling back to npm |
| Packages | `pnpm install`, re-run only when the lockfile changes |
| **PostgreSQL 16** | An existing server or Windows service is used if present. Otherwise a private one is downloaded into `.postgres\` (~44 MB), checksum-verified, initialised and started — **no administrator rights needed** |
| Database + role | Created on first run (values generated by the wizard) |
| Schema | `prisma migrate deploy` |
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

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local
pnpm db:migrate     # apply migrations to a fresh database
pnpm db:seed        # create the super_admin user
pnpm dev            # backend :3001, frontend :3000
```

## Backups

Backups are created and restored from the **logged-in app**: Settings → Database Backup.
You can create a timestamped, versioned `pg_dump` of the database, list all backups, and
restore one. Restoring **replaces** the current contents — so a safety dump of the present
state is taken first, meaning even a mistaken restore is recoverable. Confirmation requires
typing `RESTORE`.

`backups/` and `logs/` are git-ignored: they hold real school data.

## Machine binding (anti-copy protection)

The project is bound to the computer it is first started on. On every launch,
`start.bat` – and the backend itself at boot – compare a SHA256 of
the Windows `MachineGuid` (`HKLM\SOFTWARE\Microsoft\Cryptography`) against
`machine.lock` in the project root. Copying the folder to another computer
(USB drive, hard disk) therefore **refuses to start** on the target machine,
since the identifier never travels with the files.

- First run on a computer creates `machine.lock` and binds automatically.
- `machine.lock` is machine-specific and git-ignored – never commit it.
- Legitimate moves (new computer, Windows reinstall): the manager deletes
  `machine.lock`; the next start binds the project to that machine.
- Script: `tools/windows/scripts/machine-id.ps1` (`check` / `bind` / `info`).
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
  `TransformInterceptor`; errors are normalised by `AllExceptionsFilter` (§12).
- **Design tokens** — colours, spacing, radii, shadows and type scale are defined once in
  `apps/frontend/tailwind.config.ts` (§9). Components must not hard-code hex values or
  arbitrary pixel spacing.
- **Naming** — kebab-case files, `PascalCase` components, `camelCase` values, plural table names.

## Locked product decisions

Confirmed with the client; recorded here so they don't get silently re-litigated.

| Question | Decision |
|---|---|
| Billing day | **Enrollment anniversary.** `due_date` derives from `students.enrollment_date`; short months clamp to the last valid day (a 31st enrollment bills the 30th/28th). |
| Partial payments | **Not supported in Phase 1.** Strictly paid / not-paid; `paid_amount` always equals `amount_due`. The column exists so a `partially_paid` state is a later migration, not a rewrite. |
| Reminders | **Dashboard only.** No SMS/email/WhatsApp integration in Phase 1. |
| Roles | **`super_admin` only.** The `users.role` column and `RolesGuard` exist so `field_manager` / `prof` / `accountant` can be added without redesign — but no UI or permission logic for them yet (§5). |

## Explicitly out of scope for Phase 1

Second user roles, messaging notifications, partial payment tracking, and
multi-tenant / multi-school support.
