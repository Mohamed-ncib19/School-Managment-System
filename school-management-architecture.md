
# Private School Intern Management System — Architecture & Data Model

## 1. Hierarchy Recap

```
Field
 └── Professor(s)
      └── Level(s)
           └── Group(s)
                └── Student(s)
                     └── Monthly Payment Records
```

A **Field** is a subject/domain area (e.g. "Languages", "Sciences"). Each Field has one or more Professors. Each Professor manages one or more Levels (e.g. "Beginner", "Intermediate"). Each Level has one or more Groups (class sections/cohorts). Each Group has a roster of Students. Each Student has a running list of monthly payment records.

---

## 2. Data Model

### 2.1 `users` (system operators — currently Admins only)
| Column | Type | Notes |
|---|---|---|
| id | UUID/PK | |
| full_name | string | |
| email | string, unique | |
| password_hash | string | |
| role | enum | `super_admin` for now. Design supports adding `field_manager`, `accountant`, `prof` later — see §5 |
| is_active | boolean | disable without deleting |
| created_at / updated_at | timestamp | |

### 2.2 `fields`
| Column | Type | Notes |
|---|---|---|
| id | PK | |
| name | string | e.g. "Languages" |
| description | text | |
| created_by | FK → users | |
| created_at | timestamp | |

### 2.3 `professors`
| Column | Type | Notes |
|---|---|---|
| id | PK | |
| field_id | FK → fields | |
| full_name | string | |
| phone | string | |
| email | string, nullable | not a login account yet |
| user_id | FK → users, nullable | reserved for when profs get login access |
| is_active | boolean | |
| created_at | timestamp | |

### 2.4 `levels`
| Column | Type | Notes |
|---|---|---|
| id | PK | |
| prof_id | FK → professors | |
| name | string | e.g. "Level 1", "A2" |
| created_at | timestamp | |

### 2.5 `groups`
| Column | Type | Notes |
|---|---|---|
| id | PK | |
| level_id | FK → levels | |
| name | string | e.g. "Group A" |
| capacity | int, nullable | |
| schedule_notes | text, nullable | |
| created_at | timestamp | |

### 2.6 `students`
| Column | Type | Notes |
|---|---|---|
| id | PK | |
| group_id | FK → groups | |
| first_name / last_name | string | |
| phone | string | |
| parent_phone | string, nullable | |
| email | string, nullable | |
| enrollment_date | date | anchors monthly due-date generation |
| monthly_fee | decimal | can be overridden per student even if group has a default fee |
| status | enum | `active`, `paused`, `withdrawn` |
| created_at | timestamp | |

### 2.7 `student_payments` (the core payment-tracking table — one row per student per billing month)
| Column | Type | Notes |
|---|---|---|
| id | PK | |
| student_id | FK → students | |
| period` | string `YYYY-MM` | which month this record covers |
| amount_due | decimal | copied from `monthly_fee` at generation time |
| due_date | date | e.g. enrollment day-of-month, or a fixed day configured per field/level |
| status | enum | `not_paid` (default) → `due_soon` → `paid` \| `overdue` — see §3 |
| paid_amount | decimal, nullable | |
| paid_at | timestamp, nullable | |
| recorded_by | FK → users | which admin took the cash payment |
| payment_method | enum | `cash` for now; leaves room for `transfer`, `online` later |
| notes | text, nullable | |
| created_at / updated_at | timestamp | |

Unique constraint: (`student_id`, `period`) — one record per student per month.

### 2.8 `audit_logs` (recommended from day one)
| Column | Type | Notes |
|---|---|---|
| id | PK | |
| actor_user_id | FK → users | |
| action | string | e.g. `payment.recorded`, `student.moved_group` |
| entity_type / entity_id | string / UUID | polymorphic reference |
| meta | JSON | before/after snapshot |
| created_at | timestamp | |

Even with a single Admin role today, this becomes essential once you add more staff — every payment edit is traceable to a person.

---

## 3. Payment Status State Machine

```
        (record created at start of billing cycle)
                     │
                     ▼
                not_paid  ──────────────► overdue
                     │      (due_date passed,        ▲
                     │       still unpaid)            │
       (today = due_date - 2 days,                    │
        still unpaid)                                 │
                     ▼                                 │
                due_soon ───────────────────────────────
                     │
     (staff records cash payment, any time)
                     ▼
                   paid
```

Rules:
- **`not_paid`** — default state the moment a monthly record is generated.
- **`due_soon`** — automatically set when `today == due_date - 2 days` and status is still `not_paid`. Purely a flag for staff dashboards/reminders — no payment action occurs automatically.
- **`overdue`** — automatically set when `today > due_date` and status is not `paid`.
- **`paid`** — set only by an explicit staff action (cash recorded). Can transition from any prior state.

This requires a **daily scheduled job** (cron) that scans `student_payments` where `status != paid` and updates status based on the date comparisons above. This same job (or a monthly one) also **generates next month's record** for every active student, using `enrollment_date`'s day-of-month (or a configurable billing day) to compute `due_date`.

---

## 4. Recommended Stack (scalable, but simple to start locally)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js (React)** | SSR for dashboards, easy to scale to a proper multi-page admin app, huge ecosystem |
| Backend | **NestJS (Node/TypeScript)** | Modular architecture out of the box (one module per entity: fields, professors, levels, groups, students, payments) — this maps directly onto your hierarchy and keeps things clean as roles/permissions grow |
| ORM | **Prisma** | Type-safe schema matching §2 tables, painless migrations |
| Database | **PostgreSQL** | Strong relational integrity for a strict parent→child hierarchy; supports schema-per-tenant later if you ever offer this to multiple schools |
| Scheduled jobs | **BullMQ + Redis** (or Nest's `@nestjs/schedule` for a single instance) | Runs the daily status-update + monthly record-generation job described in §3 |
| Auth | JWT (access + refresh tokens) | Ready to layer RBAC guards on top later without redesign |
| Deployment | Docker Compose locally → same containers to any VPS/cloud later | No rewrite needed to "scale up" |

This stack lets you start as a single local deployment for one school, and later scale horizontally (more app instances behind a load balancer) or multi-tenant (one Postgres schema per school) without changing the data model.

---

## 5. Visibility & Roles — designed for today, ready for tomorrow

**Today:** a single `super_admin` role sees and manages everything — all fields, all profs, all levels, groups, students, and payments. No scoping needed yet.

**Built-in for later** (no schema changes required, just new role checks in the backend):

| Future role | Suggested visibility scope |
|---|---|
| `field_manager` | Only their assigned field(s) — profs, levels, groups, students, and payments underneath. Add a `field_admins` pivot table (`user_id`, `field_id`) when this role is introduced. |
| `prof` (if given login access) | Only the levels/groups/students under their own `professors.id`. `professors.user_id` already reserved for this. |
| `accountant` | Cross-field visibility into `student_payments` only — no access to editing the academic hierarchy (fields/profs/levels/groups). |

Because every lower-level table carries a foreign key up the chain (`students.group_id → groups.level_id → levels.prof_id → professors.field_id`), scoping a query to "everything under field X" or "everything under prof Y" is a simple join/filter — the hierarchy itself *is* the permission boundary. This is why getting §2's foreign keys right now pays off later.

---

## 6. Suggested Backend Module Structure (NestJS)

```
src/
 ├─ auth/              # login, JWT, guards (role checks live here)
 ├─ users/
 ├─ fields/
 ├─ professors/
 ├─ levels/
 ├─ groups/
 ├─ students/
 ├─ payments/          # student_payments CRUD + status transition logic
 ├─ scheduler/         # daily cron: status updates + monthly record generation
 └─ audit/             # writes to audit_logs, called by other modules
```

## 7. Core API Endpoints (sketch)

```
POST   /fields                       create field
GET    /fields/:id/professors        list profs in a field

POST   /professors
GET    /professors/:id/levels

POST   /levels
GET    /levels/:id/groups

POST   /groups
GET    /groups/:id/students

POST   /students
GET    /students/:id/payments        full payment history for one student

POST   /payments/:id/record-payment  { amount, method, notes } → sets status = paid
GET    /payments?status=due_soon     dashboard: who needs a reminder
GET    /payments?status=overdue      dashboard: who's overdue
```

---

## 8. Features Map

A module-by-module inventory of what the system does, so scope stays explicit as it grows.

| Module | Core Features | Phase |
|---|---|---|
| **Auth & Session** | Login, logout, JWT session, password reset | 1 (now) |
| **Fields** | Create/edit/archive a field, list professors under it | 1 |
| **Professors** | Create/edit/deactivate, assign to a field, list levels under them | 1 |
| **Levels** | Create/edit/archive, assign to a professor, list groups under it | 1 |
| **Groups** | Create/edit/archive, set capacity/schedule notes, list students | 1 |
| **Students** | Enroll, edit profile, move between groups, set status (active/paused/withdrawn), full payment history | 1 |
| **Payments** | View per-student history, record a cash payment, auto-generate next month's record, auto status transitions (`not_paid → due_soon → overdue`), filter by status/field/level/group | 1 |
| **Dashboard & Analytics** | Stat cards (students, professors, today's payments, monthly revenue, pending, overdue), charts (revenue by month, payments by status, students per field/professor, monthly enrollments), due-soon & overdue lists, recent payments & latest enrollments feeds | 1 |
| **Audit Log** | Read-only history of who did what (payment edits, student moves, record creation) | 1 |
| **Notifications** | SMS/WhatsApp/email reminder when a payment flips to `due_soon` or `overdue` | 2 |
| **Role-Based Access** | Field Manager (scoped to a field), Prof (scoped to own levels), Accountant (payments-only, cross-field) — see §5 | 2 |
| **Partial Payments** | Allow `paid_amount < amount_due` with a distinct "partially paid" state | 2 (pending your answer to open question #2) |
| **Multi-Tenant / Multi-School** | Schema-per-school or tenant_id scoping if this expands beyond one school | 3 |

Phase 1 is everything needed for a single Admin running one school with manual cash payments — matches what's being built now. Phases 2–3 are the scaling paths the architecture in §5–§6 was designed to absorb without a rewrite.

---

## 9. Design System & Brand Guidelines (IQ Academy)

### 9.1 Brand Identity

IQ Academy positions itself as a modern educational institution focused on learning, organization, and trust. The visual language should communicate: education, intelligence, simplicity, organization, professionalism, accessibility, and friendliness.

The application should avoid dark, corporate interfaces and instead embrace a **clean educational dashboard** aesthetic.

### 9.2 Color Palette

> These are approximations derived from the logo, not exact extracted values — treat as a strong starting point, refine once final brand assets are available.

| Role | Color | Hex | Used for |
|---|---|---|---|
| Primary Blue | 🔵 | `#264EAE` | Primary buttons, sidebar, active navigation, important actions, charts |
| Secondary Sky Blue | 🔵 | `#77D4F2` | Headers, cards, icons, links, selected rows |
| Accent Gold | 🟡 | `#F5B940` | Highlights only — notifications, pending-payment badge, stats/counters, icons |

**Neutrals**

| Token | Hex |
|---|---|
| Background | `#F8FAFC` |
| Surface | `#FFFFFF` |
| Border | `#E5E7EB` |
| Text Primary | `#1F2937` |
| Text Secondary | `#6B7280` |

**Semantic**

| Token | Hex |
|---|---|
| Success | `#22C55E` |
| Warning | `#F59E0B` |
| Danger | `#EF4444` |
| Info | `#3B82F6` |

### 9.3 Typography

The logo uses a rounded geometric sans-serif. Closest production fonts, in order of preference: **Poppins** (recommended), Nunito, Manrope.

| Level | Size |
|---|---|
| H1 | 32px |
| H2 | 28px |
| H3 | 22px |
| H4 | 18px |
| Body | 16px |
| Small | 14px |
| Caption | 12px |

Weights: Bold `600`, Medium `500`, Regular `400`.

### 9.4 Design Philosophy

**Embrace:** clean, minimal, spacious, bright, modern, educational, rounded components, no unnecessary visual noise.

**Avoid:** heavy gradients, glassmorphism, neumorphism, dark backgrounds, excessive animation.

### 9.5 Border Radius

| Element | Radius |
|---|---|
| Buttons | 10px |
| Inputs | 10px |
| Cards | 14px |
| Modals | 18px |
| Tables | 12px |

All components share the same rounded language — no mixing sharp and rounded corners.

### 9.6 Elevation

```css
/* Card */
box-shadow: 0 4px 16px rgba(0,0,0,.06);

/* Hover */
box-shadow: 0 8px 24px rgba(0,0,0,.08);
```

Subtle only — never a heavy drop shadow.

### 9.7 Spacing System

8-point grid: `4 · 8 · 12 · 16 · 24 · 32 · 40 · 48 · 64`. No arbitrary spacing values anywhere in the codebase.

### 9.8 Buttons

- **Primary** — blue background, white text, rounded, medium shadow. Used for: Save, Create Student, Record Payment, Login.
- **Secondary** — white background, blue border, blue text.
- **Danger** — red, used only for delete operations.
- **Warning** — gold, used for reminders and due-payment actions.

### 9.9 Inputs

White background, rounded, thin gray border, blue focus outline. States: default, focused, disabled, error.

### 9.10 Cards

Every dashboard section lives inside a card: `Icon → Title → Content → (optional action)`. Padding: `24px`.

### 9.11 Tables

Alternating row backgrounds, soft borders, sticky header, rounded container, hover effect. Core columns for the payments table: Student, Group, Due Date, Status, Amount. Status is always a colored badge, never plain text.

### 9.12 Status Badges

| Status | Style |
|---|---|
| Paid | Green — `✓ Paid` |
| Due Soon | Gold — `⏰ Due Soon` |
| Not Paid | Gray — `Pending` |
| Overdue | Red — `⚠ Overdue` |

### 9.13 Icons

**Lucide React** (already in the Next.js stack) or Heroicons. Style: outlined, rounded, simple. Avoid filled icons.

### 9.14 Dashboard Layout

```
Top Navbar
   ↓
Left Sidebar → Dashboard
                 ├── Statistics Cards
                 ├── Recent Payments
                 ├── Due Soon Students
                 ├── Overdue Students
                 └── Latest Enrollments
```

### 9.15 Sidebar

Primary Blue background, white icons/text. Active item gets a Sky Blue background with white text. Supports a collapsed mode.

### 9.16 Statistics Cards

Examples: Total Students, Total Professors, Today's Payments, Monthly Revenue, Pending Payments, Overdue Payments. Each card: icon, title, value, small trend indicator.

### 9.17 Charts

**Recharts**, following the brand palette (Primary Blue, Sky Blue, Gold, Green, Red):
- Revenue by Month
- Payments by Status
- Students per Field
- Students per Professor
- Monthly Enrollments

### 9.18 Motion

Subtle only. Duration 150–250ms. Effects: fade, scale, slide. Avoid large/showy animations.

### 9.19 Responsive Rules

| Breakpoint | Behavior |
|---|---|
| Desktop | Sidebar expanded |
| Tablet | Sidebar collapsible |
| Mobile | Drawer navigation, stacked cards, scrollable tables |

### 9.20 Accessibility

- Minimum contrast ratio: WCAG AA
- Visible keyboard focus states
- ARIA labels on all interactive elements
- Minimum touch target: 44×44px
- Never rely on color alone to communicate status (pair every badge with an icon/label, as in §9.12)

### 9.21 Development Standards for the Design System

Implement a **centralized design system using design tokens** rather than hard-coded values:

- **Tailwind CSS** with a custom theme extending the tokens in §9.2, §9.3, §9.5, §9.7
- **shadcn/ui** as the component foundation
- **Lucide React** for icons
- **Recharts** for analytics
- **React Hook Form + Zod** for forms and validation

All colors, typography, spacing, radii, and shadows are defined once as tokens (e.g. `tailwind.config.ts` theme extension) and consumed everywhere — no page should hard-code a hex value or a `px` spacing number.

---

## 10. Frontend Architecture

```
app/
 ├─ (auth)/
 │   └─ login/
 ├─ (dashboard)/
 │   ├─ dashboard/                      # stats, charts, due-soon/overdue feeds
 │   ├─ fields/
 │   │   └─ [fieldId]/professors/
 │   │       └─ [profId]/levels/
 │   │           └─ [levelId]/groups/
 │   │               └─ [groupId]/students/
 │   ├─ students/[studentId]/payments/  # cross-cutting view: one student's full history
 │   └─ payments/                       # global payments table, filterable by status/field/level/group
 ├─ layout.tsx                          # top navbar + sidebar shell
 └─ globals.css                         # Tailwind base + design tokens

components/
 ├─ ui/            # shadcn primitives (button, input, dialog, table...)
 ├─ shared/         # Sidebar, Navbar, StatCard, StatusBadge, EmptyState, LoadingSkeleton
 ├─ tables/         # generic DataTable + column defs per entity
 ├─ forms/          # StudentForm, ProfessorForm, PaymentForm (Zod-validated)
 └─ charts/         # RevenueChart, PaymentsByStatusChart, EnrollmentsChart

lib/
 ├─ api/            # typed API client functions, one file per resource
 ├─ validators/     # Zod schemas (mirrored against backend DTOs)
 └─ utils/          # date/currency formatting, status-color mapping

hooks/
 ├─ useStudents.ts / usePayments.ts / ...   # TanStack Query wrappers per resource
 └─ useSidebar.ts                            # local UI state (collapsed/expanded)
```

**State management:** server state (students, payments, etc.) via **TanStack Query** — handles caching, refetching, and optimistic updates for actions like "record payment" without a separate global store. Local-only UI state (sidebar collapse, modal open/close) via component state or a small **Zustand** store if it grows past a couple of components.

**Routing:** Next.js App Router, nested layouts mirroring the Field → Professor → Level → Group → Student hierarchy, so breadcrumbs and scoping fall out of the URL structure naturally.

---

## 11. UI Components Specification

| Component | Purpose | Key props/behavior |
|---|---|---|
| `StatCard` | Dashboard summary tile | `icon, title, value, trend?` |
| `StatusBadge` | Renders payment status consistently | `status: 'paid' \| 'due_soon' \| 'not_paid' \| 'overdue'` → maps to color + icon per §9.12 |
| `DataTable` | Generic sortable/paginated table used for students, payments, professors lists | `columns, data, onRowClick?, pagination` |
| `StudentForm` | Create/edit a student | Zod-validated: name, phone, parent phone, group, enrollment date, monthly fee |
| `PaymentRecordModal` | Record a cash payment against a `student_payments` row | Fields: amount received, method (cash), notes → PATCHes status to `paid` |
| `ProfessorForm` / `LevelForm` / `GroupForm` | Create/edit the corresponding hierarchy entity | Scoped selects (e.g. Level form only shows Professors from the current Field) |
| `ConfirmDeleteDialog` | Guard against accidental deletes/archives | `entityName, onConfirm` |
| `Sidebar` | Primary navigation | Collapsible, highlights active route per §9.15 |
| `Navbar` | Top bar | Search, current user, logout |
| `DashboardChartCard` | Wraps a Recharts chart in a standard card | `title, chart` |
| `EmptyState` | Shown when a list (e.g. a group with no students yet) is empty | `icon, message, actionLabel?` |
| `LoadingSkeleton` | Placeholder while data loads | Matches shape of the component it replaces (card/table row) |

---

## 12. Development Standards

- **Naming:** kebab-case file names, `PascalCase` for components, `camelCase` for variables/functions, plural table names (`students`, `student_payments`).
- **API pattern:** REST, resource-based (`/students`, `/students/:id/payments`), consistent response envelope `{ data, meta, error }`, standard HTTP status codes.
- **Validation:** Zod schemas on the frontend, mirrored by `class-validator` DTOs in NestJS — one source of truth for shape, kept in sync manually or via a shared types package if the project grows.
- **Error handling:** centralized exception filter in NestJS returning consistent error shapes; frontend surfaces them via toast notifications (shadcn `use-toast`), never a raw stack trace.
- **Testing:** unit tests (Jest) for backend services — especially the payment status state machine in §3, since silent bugs there directly mean money isn't tracked correctly; a handful of e2e tests (Playwright) for critical flows: record a payment, create a student, generate next month's records.
- **Git workflow:** trunk-based development with short-lived feature branches per module (`feat/payments-status-cron`), Conventional Commits (`feat:`, `fix:`, `chore:`), PR review before merging to main even as a solo/small team — it's cheap insurance once the audit log (§2.8) needs to line up with actual code history.
- **Environment config:** `.env` per environment, secrets never committed, `.env.example` kept up to date for onboarding.

---

## Open questions to lock down before building

1. **Billing day**: is the due date the student's enrollment anniversary day each month, or one fixed day for the whole school/field (e.g. the 5th of every month)?
2. **Partial payments**: can a student pay less than `amount_due` and remain partially paid, or is it strictly paid/not-paid?
3. **Reminders**: when a record flips to `due_soon`, do you want this surfaced only on the admin dashboard, or also as an SMS/email/WhatsApp notification to the parent (this would need a messaging provider integration later)?
