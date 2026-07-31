# IQ Academy — Intern Management System

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
scripts/          Launcher, backup and restore PowerShell scripts
backups/          Timestamped database dumps (git-ignored)
docker-compose.yml  Postgres 16 + Redis 7 — alternative to a native install
```

## Daily use

**Double-click `start.bat`.** That's the whole workflow.

It installs anything missing (Node.js, pnpm, packages), starts PostgreSQL if it isn't
running, creates the database and role on first run, applies migrations, takes a safety
backup, builds if needed, starts both servers and opens the portal.

| File | What it does |
|---|---|
| `start.bat` | Start everything and open the portal |
| `stop.bat` | Shut the servers down (frees ports 3000/3001) |
| `backup.bat` | Take an immediate database backup |
| `restore.bat` | Restore from a backup (asks for confirmation) |

`start.bat -Dev` runs watch-mode dev servers instead of the production build.
`start.bat -NoBackup` skips the pre-flight backup.

Seeded login: `admin@iqacademy.com` / `admin123` — change before any real deployment.
API docs (Swagger): <http://localhost:3001/api/docs>. All routes sit under `/api`;
`NEXT_PUBLIC_API_URL` must include it.

### Requirements

**Windows 10/11 and an internet connection. Nothing else.** Clone the repository,
double-click `start.bat`, and it installs whatever is missing:

| Component | How it's obtained |
|---|---|
| Node.js LTS | winget, if `node` isn't on PATH |
| pnpm | corepack, falling back to npm |
| Packages | `pnpm install`, re-run only when the lockfile changes |
| **PostgreSQL 16** | An existing server or Windows service is used if present. Otherwise a private one is downloaded into `.postgres\` (~44 MB), checksum-verified, initialised and started — **no administrator rights needed** |
| Database + role | Created on first run |
| Schema | `prisma migrate deploy` |
| Admin account | Seeded, idempotently |

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

Every `start.bat` writes a compressed `pg_dump` into `backups/`, keeping the most recent
30 and pruning older ones. `backup.bat` takes one on demand.

`restore.bat` lists available backups and restores the one you pick. It **replaces** the
current database — so it takes a safety dump of the present state first, meaning even a
mistaken restore is recoverable. Confirmation is required.

`backups/` and `logs/` are git-ignored: they hold real school data.

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
