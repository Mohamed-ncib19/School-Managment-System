# Scheduling & Classroom Management — Feature Design Document

> **Status:** Draft — ready for implementation  
> **Target:** New first-class module in the School Management System  
> **Touches:** `groups`, `students`, `professors` (existing entities — no schema changes to those tables)  
> **Creates:** New `scheduling` space with its own routes, sidebar section, API module, and database tables

---

## 1. Why This Feature

The system already manages **who** is enrolled (students in groups via `student_assignments`) and **how much** they pay (`student_payments`). What's missing is **when and where** learning happens:

| Question | Current state | After this feature |
|---|---|---|
| Which classroom does Group A meet in? | Unknown | Definitive per-slot room assignment |
| When does a group meet each day? | `schedule_notes` free-text on `groups` | Structured weekly grid with conflict detection |
| What is a student's individual timetable? | Not available | Per-student view that respects multi-group enrollment + exceptions |
| Is Professor X double-booked on Tuesday 10:00? | Not detectable | Automatic conflict detection across all schedules |
| Can we print a weekly class schedule? | No | One-click PDF/print per group, professor, or classroom |
| Does this slot have a substitute teacher? | Not tracked | Schedule exceptions for subs, cancellations, makeups |

---

## 2. Scope

### In scope
- **Classroom (Room) CRUD** — name, building, floor, room number, capacity, equipment list, colour tag
- **Time Slot definitions** — day-of-week + start/end time pairs that form the weekly grid (e.g., "Saturday Period 3 — 09:00–10:30")
- **Schedule Entries** — the assignment `(group + time_slot + classroom + professor + subject)` with effective date range
- **Student Schedule Exceptions** — per-student overrides: substitute session, cancelled session, makeup session
- **Conflict detection** — three checks: professor double-booked, classroom double-booked, student double-booked
- **Four live views** — weekly calendar grid, group schedule, student timetable, professor timetable
- **Print / export** — print-ready weekly schedule per group or classroom (A4 HTML)
- **Audit trail** — every schedule mutation logged with prev/new values
- **Feature flag** — `scheduling` toggle in system settings; sidebar item hidden when disabled

### Out of scope (future phases)
- Automated timetable generation (genetic algorithm / constraint solver)
- Room booking by external parties
- Student self-service schedule changes
- Integration with video-conference links (Zoom/Teams)
- Recurring exceptions (e.g., "every 3rd Saturday")

---

## 3. Database Schema

### 3.1 New Tables

#### `classrooms`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` |
| `name` | `text` | NOT NULL |
| `building` | `text` | nullable |
| `floor` | `text` | nullable |
| `room_number` | `text` | nullable |
| `capacity` | `integer` | nullable, CHECK `> 0` |
| `equipment` | `jsonb` | nullable, e.g. `["projector","whiteboard","computers"]` |
| `is_active` | `boolean` | default `true` |
| `color` | `text` | nullable, hex |
| `created_at` | `timestamp(3)` | `CURRENT_TIMESTAMP` |
| `updated_at` | `timestamp(3)` | `CURRENT_TIMESTAMP` |

Indexes: `is_active`, `(building, room_number)` unique when both present.

#### `time_slots`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` |
| `label` | `text` | NOT NULL, e.g. "P1", "P2", "Period 3" |
| `day_of_week` | `integer` | NOT NULL, 0 = Sunday … 6 = Saturday (Tunisian school week) |
| `start_time` | `time` | NOT NULL |
| `end_time` | `time` | NOT NULL |
| `sort_order` | `integer` | NOT NULL, default `0` — controls display order within a day |
| `created_at` | `timestamp(3)` | `CURRENT_TIMESTAMP` |

Unique constraint on `(day_of_week, start_time, end_time)`.  
CHECK: `end_time > start_time`.

#### `schedule_entries`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` |
| `group_id` | `uuid` | NOT NULL, FK → `groups.id` RESTRICT |
| `time_slot_id` | `uuid` | NOT NULL, FK → `time_slots.id` RESTRICT |
| `classroom_id` | `uuid` | nullable, FK → `classrooms.id` RESTRICT |
| `prof_id` | `uuid` | NOT NULL, FK → `professors.id` RESTRICT |
| `subject` | `text` | nullable, e.g. "Grammar", "Algebra" |
| `notes` | `text` | nullable |
| `effective_from` | `date` | NOT NULL |
| `effective_until` | `date` | nullable — NULL means open-ended |
| `is_active` | `boolean` | default `true` |
| `created_at` | `timestamp(3)` | `CURRENT_TIMESTAMP` |
| `updated_at` | `timestamp(3)` | `CURRENT_TIMESTAMP` |

Unique constraint on `(group_id, time_slot_id, effective_from)` — a group can't have two entries for the same slot on the same day.  
Unique constraint on `(classroom_id, time_slot_id, effective_from)` WHERE `classroom_id IS NOT NULL` — a classroom can't host two groups simultaneously.  
Unique constraint on `(prof_id, time_slot_id, effective_from)` — a professor can't teach two groups simultaneously.  
CHECK: `effective_until IS NULL OR effective_until >= effective_from`.

#### `student_schedule_exceptions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` |
| `student_id` | `uuid` | NOT NULL, FK → `students.id` CASCADE |
| `schedule_entry_id` | `uuid` | NOT NULL, FK → `schedule_entries.id` CASCADE |
| `exception_type` | `text` | NOT NULL, CHECK IN (`substitute`, `cancelled`, `makeup`) |
| `exception_date` | `date` | NOT NULL |
| `notes` | `text` | nullable |
| `created_by` | `uuid` | nullable, FK → `users.id` SET NULL |
| `created_at` | `timestamp(3)` | `CURRENT_TIMESTAMP` |

Unique constraint on `(student_id, schedule_entry_id, exception_date)`.

### 3.2 New Enum

```
ScheduleExceptionType  —  substitute | cancelled | makeup
```

No new enums needed — `exception_type` uses a text CHECK for simplicity (only 3 values, unlikely to change).

### 3.3 Schema Diagram

```
classrooms (id, name, building, …)
      ▲
      │ schedule_entries.classroom_id (nullable — online sessions have no room)
      │
time_slots (id, label, day_of_week, start_time, end_time, sort_order)
      ▲
      │ schedule_entries.time_slot_id
      │
schedule_entries (id, group_id, time_slot_id, classroom_id, prof_id, subject, …)
      ▲                    ▲           ▲
      │                    │           │
      └── groups.id         └── professors.id
      │
      └── student_schedule_exceptions.schedule_entry_id
              ▲
              └── students.id
```

### 3.4 No Changes to Existing Tables

- `groups` — untouched (existing `schedule_notes` stays as a free-text summary)
- `students` — untouched
- `student_assignments` — untouched
- `professors` — untouched

---

## 4. Backend Architecture

### 4.1 Module Structure

```
apps/backend/src/scheduling/
├── scheduling.module.ts          # NestJS module — imports DrizzleModule, AuditModule
├── scheduling.controller.ts      # REST endpoints
├── scheduling.service.ts         # Orchestrator — delegates to sub-services
├── classrooms/
│   ├── classroom.repository.ts   # Drizzle queries for classrooms
│   └── classroom.service.ts      # CRUD + search
├── time-slots/
│   ├── time-slot.repository.ts
│   └── time-slot.service.ts      # CRUD + reorder
├── schedule-entries/
│   ├── schedule-entry.repository.ts
│   └── schedule-entry.service.ts # CRUD + conflict detection + student derivation
├── student-exceptions/
│   ├── student-exception.repository.ts
│   └── student-exception.service.ts
├── conflicts/
│   └── conflict.service.ts       # Three-way conflict detection (prof/classroom/student)
├── dto/
│   ├── classroom.dto.ts
│   ├── time-slot.dto.ts
│   ├── schedule-entry.dto.ts
│   └── student-exception.dto.ts
├── types/
│   └── index.ts                  # Domain interfaces
└── __tests__/                    # Unit tests (conflict detection, date-range logic)
```

### 4.2 Sub-Service Responsibilities

#### `ClassroomService`
- `create(dto)` — validates `(building, room_number)` uniqueness, audits
- `list(building?, active?)` — paginated, filterable
- `update(id, dto)` — partial, audits changed fields
- `remove(id)` — soft archive (`is_active = false`) if no active schedule entries reference it; otherwise throws with a hint to reschedule
- `search(query)` — full-text-ish search across name, building, room_number

#### `TimeSlotService`
- `create(dto)` — validates `(day_of_week, start_time, end_time)` uniqueness, audits
- `list(dayOfWeek?)` — sorted by `sort_order` then `start_time`
- `update(id, dto)` — partial, re-validates uniqueness
- `reorder(ids[])` — batch update `sort_order` from array position
- `remove(id)` — soft delete if no schedule entries reference it

#### `ScheduleEntryService`
- `create(dto)` — **runs conflict detection first**; if conflicts found, throws `409 Conflict` with a structured payload listing each conflict; otherwise inserts, audits
- `list(filters)` — filters by `groupId`, `profId`, `classroomId`, `timeSlotId`, `date`, `active?`; joins group→professor→field→level chain + classroom; always joins time_slot for display
- `get(id)` — single entry with full chain
- `update(id, dto)` — re-runs conflict detection (excluding the current row); partial update of subject/notes/effective dates/classroom; cannot change group, time_slot, or prof (those require delete + create to re-run conflict checks)
- `archive(id)` — soft delete (`is_active = false`) with optional `effective_until` stamp
- `remove(id)` — hard delete (super_admin only), audits
- `getStudentSchedule(studentId, fromDate, toDate)` — derives the student's personal timetable:
  1. Find all groups the student is enrolled in (`student_assignments`)
  2. Find all active `schedule_entries` for those groups whose `effective_from ≤ toDate` AND (`effective_until IS NULL OR effective_until ≥ fromDate`)
  3. Left-join `student_schedule_exceptions` for each entry + each date in range
  4. Apply exceptions: `cancelled` entries are excluded, `substitute` entries replace the prof, `makeup` entries are added as extra slots
  5. Return sorted by day_of_week, sort_order
- `getGroupSchedule(groupId, fromDate, toDate)` — same as above but for a single group (no exceptions)
- `getProfessorSchedule(profId, fromDate, toDate)` — all entries for a professor
- `getClassroomSchedule(classroomId, fromDate, toDate)` — all entries for a classroom

#### `StudentExceptionService`
- `create(dto)` — validates the student is enrolled in the schedule entry's group, creates exception, audits
- `list(studentId?, scheduleEntryId?)` — filtered list
- `remove(id)` — hard delete

#### `ConflictService`
The conflict engine runs three queries for every `create`/`update`:

```
-- Professor double-booked
SELECT se.id, se.group_id, se.time_slot_id, se.effective_from
FROM schedule_entries se
JOIN time_slots ts ON ts.id = se.time_slot_id
WHERE se.prof_id = :profId
  AND se.id != :excludeId
  AND se.is_active = true
  AND ts.day_of_week = :targetDayOfWeek
  AND ts.start_time < :targetEndTime
  AND ts.end_time   > :targetStartTime
  AND se.effective_from <= :targetDate
  AND (se.effective_until IS NULL OR se.effective_until >= :targetDate)
```

The same pattern repeats for `classroom_id` and for students (joining through `student_assignments`).

Returns a typed array:
```typescript
type Conflict = {
  type: 'professor' | 'classroom' | 'student';
  entityId: string;
  entityName: string;       // "Group A / Prof. Smith" or "Room 204"
  scheduleEntryId: string;
  timeSlotLabel: string;    // "Saturday P3 (09:00–10:30)"
  date: string;             // "2026-09-01"
}
```

If the array is non-empty, the caller gets a `409` with this array in the response body.

### 4.3 Controller Routes

Prefix: `/scheduling`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/scheduling/classrooms` | JWT | List classrooms |
| GET | `/scheduling/classrooms/:id` | JWT | Get one |
| POST | `/scheduling/classrooms` | JWT + super_admin | Create |
| PUT | `/scheduling/classrooms/:id` | JWT + super_admin | Update |
| DELETE | `/scheduling/classrooms/:id` | JWT + super_admin | Soft delete |
| GET | `/scheduling/time-slots` | JWT | List (sorted) |
| POST | `/scheduling/time-slots` | JWT + super_admin | Create |
| PUT | `/scheduling/time-slots/:id` | JWT + super_admin | Update |
| PUT | `/scheduling/time-slots/reorder` | JWT + super_admin | Batch reorder |
| DELETE | `/scheduling/time-slots/:id` | JWT + super_admin | Delete |
| GET | `/scheduling/entries` | JWT | List (rich filter set) |
| GET | `/scheduling/entries/:id` | JWT | Get one with full chain |
| POST | `/scheduling/entries` | JWT + super_admin | Create (with conflict check) |
| PUT | `/scheduling/entries/:id` | JWT + super_admin | Update (with conflict check) |
| PATCH | `/scheduling/entries/:id/archive` | JWT + super_admin | Soft archive |
| DELETE | `/scheduling/entries/:id` | JWT + super_admin | Hard delete |
| GET | `/scheduling/students/:studentId/schedule` | JWT | Student timetable (with exceptions) |
| GET | `/scheduling/groups/:groupId/schedule` | JWT | Group timetable |
| GET | `/scheduling/professors/:profId/schedule` | JWT | Professor timetable |
| GET | `/scheduling/classrooms/:id/schedule` | JWT | Classroom timetable |
| POST | `/scheduling/students/:studentId/exceptions` | JWT + super_admin | Add exception |
| DELETE | `/scheduling/exceptions/:id` | JWT + super_admin | Remove exception |
| GET | `/scheduling/conflicts` | JWT + super_admin | Scan all active entries for conflicts |
| GET | `/scheduling/conflicts/preview` | JWT + super_admin | Preview conflicts for a proposed entry (dry-run) |

### 4.4 Audit

Every mutation calls the existing `AuditService`:

```typescript
auditService.log({
  action: 'schedule.entry.created',
  entity_type: 'schedule_entry',
  entity_id: entry.id,
  meta: { group_id, time_slot_id, classroom_id, prof_id, subject, effective_from },
  prev_values: null,
  new_values: { ...dto },
});
```

Soft archive uses `schedule.entry.archived`, hard delete uses `schedule.entry.deleted`.

---

## 5. Frontend Architecture

### 5.1 New Routes

```
app/(dashboard)/
├── scheduling/
│   ├── page.tsx                          # Dashboard: stats, active conflicts count, quick actions
│   ├── classrooms/
│   │   └── page.tsx                      # Classroom CRUD (cards + table, filter by building)
│   ├── time-slots/
│   │   └── page.tsx                      # Weekly grid builder, drag to reorder
│   ├── timetable/
│   │   └── page.tsx                      # Weekly/monthly calendar (all groups, colour-coded)
│   ├── groups/
│   │   └── [groupId]/
│   │       └── page.tsx                  # Single group's weekly schedule
│   ├── students/
│   │   └── [studentId]/
│   │       └── page.tsx                  # Individual student timetable (with exceptions)
│   ├── professors/
│   │   └── [profId]/
│   │       └── page.tsx                  # Professor weekly commitments
│   └── conflicts/
│       └── page.tsx                      # Conflict report list with one-click navigation
```

### 5.2 New Files

```
components/
├── scheduling/
│   ├── scheduling-shell.tsx              # Shell layout with scheduling-specific nav tabs
│   ├── classroom-card.tsx                # Classroom display + edit trigger
│   ├── classroom-form.tsx                # Create/edit modal
│   ├── time-slot-grid.tsx                # Weekly period grid with drag handles
│   ├── time-slot-form.tsx                # Create/edit time slot modal
│   ├── schedule-entry-card.tsx           # Compact card: group + prof + room + subject
│   ├── schedule-entry-form-modal.tsx     # Full modal with group/prof/room/time-slot pickers + conflict preview
│   ├── weekly-calendar.tsx               # 6-day grid (Sat–Thu) with colour-coded entries
│   ├── monthly-calendar.tsx              # 30-day overview (small cells, entry dots)
│   ├── conflict-badge.tsx                # Red/yellow warning chip with count
│   ├── student-schedule.tsx              # Per-student weekly view with exception overlays
│   ├── exception-form-modal.tsx          # Substitute / cancel / makeup selector
│   └── print-schedule.tsx                # A4 print layout (group or classroom)
└── shared/
    └── sidebar.tsx                       # Extended: new "Scheduling" section

hooks/
├── use-scheduling.ts                     # useSchedulingEntries, useClassrooms, useTimeSlots, useConflicts
├── use-classrooms.ts
├── use-time-slots.ts
└── use-schedule-entries.ts

lib/api/
└── scheduling.api.ts                     # Typed API client (mirrors controller routes)

types/index.ts                            # Add: Classroom, TimeSlot, ScheduleEntry, ScheduleException, Conflict
```

### 5.3 Sidebar Registration

`components/shared/sidebar.tsx` gets a new section:

```tsx
const SCHEDULING_NAV_ITEMS: NavItem[] = [
  { href: "/scheduling",            label: t("scheduling.dashboard"),  icon: CalendarDays },
  { href: "/scheduling/timetable",  label: t("scheduling.timetable"),  icon: CalendarRange },
  { href: "/scheduling/classrooms", label: t("scheduling.classrooms"), icon: DoorOpen },
  { href: "/scheduling/time-slots", label: t("scheduling.timeSlots"), icon: Clock },
  { href: "/scheduling/conflicts",  label: t("scheduling.conflicts"),  icon: AlertTriangle },
];
```

Visibility controlled by feature flag `scheduling`. When the flag is off, the entire section is hidden.

### 5.4 Weekly Calendar Design

The weekly view (`weekly-calendar.tsx`) is a CSS Grid:

```
          │  Sat P1  │  Sat P2  │  Sat P3  │  Sun P1  │  …
──────────┼──────────┼──────────┼──────────┼──────────┼────
Room 101  │  Grp A   │  Grp B   │          │  Grp C   │  …
Room 102  │  Grp D   │          │  Grp E   │          │  …
Online    │  Grp F   │  Grp G   │  Grp A   │          │  …
```

Each cell is a `schedule-entry-card` showing:
- Group name + field colour
- Professor avatar/name
- Subject tag
- Exception badge (cancelled/substitute)

Colour coding: group colour → cell left border. Clicking a cell opens the edit modal.

### 5.5 Feature Flag

Add `"scheduling"` to `FEATURE_KEYS` in `hooks/use-system-settings.ts`:

```ts
export const FEATURE_KEYS = [
  // ... existing ...
  "scheduling",          // ← new
] as const;
```

The settings page (`app/(dashboard)/settings/page.tsx`) auto-picks up the new key in its "Features" tab — no additional wiring needed beyond adding it to the list.

---

## 6. Data Flow Diagrams

### 6.1 Creating a Schedule Entry (with conflict detection)

```
User clicks "Add entry" in weekly calendar
  │
  ├─► ScheduleEntryFormModal opens
  │     Fields: group, time_slot, classroom (optional), professor, subject, date range
  │
  ├─► User clicks "Save"
  │     │
  │     ├─► POST /scheduling/entries  (dto)
  │     │
  │     ├─► ScheduleEntryService.create()
  │     │     │
  │     │     ├─► ConflictService.checkProfessor(...)
  │     │     │     └─► Query: prof double-booked at this (day, time)?
  │     │     │
  │     │     ├─► ConflictService.checkClassroom(...)
  │     │     │     └─► Query: room double-booked at this (day, time)?
  │     │     │
  │     │     ├─► ConflictService.checkStudent(...)
  │     │     │     └─► Query: any student in this group double-booked?
  │     │     │
  │     │     ├─► If conflicts found → throw 409 with conflict array
  │     │     │     └─► Frontend: red banner listing each conflict
  │     │     │
  │     │     └─► If no conflicts → insert row, audit, return created entry
  │     │
  │     └─► Frontend: calendar refreshes, new card appears in correct cell
  │
  └─► (Optional) Auto-generate attendance sheet for the new slot's month
```

### 6.2 Deriving a Student's Timetable

```
GET /scheduling/students/:studentId/schedule?from=2026-09-01&to=2026-09-30
  │
  ├─► ScheduleEntryService.getStudentSchedule(studentId, from, to)
  │     │
  │     ├─► Find all group_ids for this student via student_assignments
  │     │
  │     ├─► Find all schedule_entries where:
  │     │     group_id IN (…) AND is_active = true
  │     │     AND effective_from ≤ to
  │     │     AND (effective_until IS NULL OR effective_until ≥ from)
  │     │
  │     ├─► For each entry in range, LEFT JOIN student_schedule_exceptions
  │     │     WHERE student_id = :studentId AND exception_date BETWEEN from AND to
  │     │
  │     ├─► Apply exception logic:
  │     │     cancelled  → drop from result
  │     │     substitute → override prof_id on that date
  │     │     makeup     → add as extra entry (different date, same slot)
  │     │
  │     └─► Return sorted array:
  │           { day_of_week, start_time, end_time, label, group, prof, classroom, subject, exception? }
  │
  └─► Frontend: weekly-calendar renders 6 rows (Sat–Thu) × time slots
```

---

## 7. API Contract (TypeScript)

```typescript
// types/scheduling.ts

export interface Classroom {
  id: string;
  name: string;
  building: string | null;
  floor: string | null;
  room_number: string | null;
  capacity: number | null;
  equipment: string[] | null;
  is_active: boolean;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimeSlot {
  id: string;
  label: string;
  day_of_week: number;   // 0-6
  start_time: string;    // "09:00"
  end_time: string;      // "10:30"
  sort_order: number;
  created_at: string;
}

export interface ScheduleEntry {
  id: string;
  group_id: string;
  time_slot_id: string;
  classroom_id: string | null;
  prof_id: string;
  subject: string | null;
  notes: string | null;
  effective_from: string;   // "2026-09-01"
  effective_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined fields (always present in API responses):
  group: GroupSummary;
  time_slot: TimeSlot;
  classroom: Classroom | null;
  professor: ProfessorSummary;
}

export interface GroupSummary {
  id: string;
  name: string;
  color: string | null;
  field: { id: string; name: string; color: string | null };
}

export interface ProfessorSummary {
  id: string;
  full_name: string;
  color: string | null;
}

export interface StudentScheduleException {
  id: string;
  student_id: string;
  schedule_entry_id: string;
  exception_type: 'substitute' | 'cancelled' | 'makeup';
  exception_date: string;
  notes: string | null;
  created_at: string;
}

export type ConflictType = 'professor' | 'classroom' | 'student';

export interface Conflict {
  type: ConflictType;
  entityId: string;
  entityName: string;
  scheduleEntryId: string;
  timeSlotLabel: string;
  date: string;
}

// API client shape:
export const schedulingApi = {
  // Classrooms
  classrooms: {
    list:   (building?: string, active?: boolean) => ApiClient.get<Classroom[]>("/scheduling/classrooms", { params: { building, active } }),
    get:    (id: string) => ApiClient.get<Classroom>(`/scheduling/classrooms/${id}`),
    create: (data: CreateClassroomDto) => ApiClient.post<Classroom>("/scheduling/classrooms", data),
    update: (id: string, data: Partial<CreateClassroomDto>) => ApiClient.put<Classroom>(`/scheduling/classrooms/${id}`, data),
    remove: (id: string) => ApiClient.del(`/scheduling/classrooms/${id}`),
  },
  // Time slots
  timeSlots: {
    list:    (dayOfWeek?: number) => ApiClient.get<TimeSlot[]>("/scheduling/time-slots", { params: { dayOfWeek } }),
    create:  (data: CreateTimeSlotDto) => ApiClient.post<TimeSlot>("/scheduling/time-slots", data),
    update:  (id: string, data: Partial<CreateTimeSlotDto>) => ApiClient.put<TimeSlot>(`/scheduling/time-slots/${id}`, data),
    reorder: (ids: string[]) => ApiClient.post<void>("/scheduling/time-slots/reorder", { ids }),
    remove:  (id: string) => ApiClient.del(`/scheduling/time-slots/${id}`),
  },
  // Schedule entries
  entries: {
    list:      (filters: ScheduleEntryFilters) => ApiClient.get<ScheduleEntry[]>("/scheduling/entries", { params: filters }),
    get:       (id: string) => ApiClient.get<ScheduleEntry>(`/scheduling/entries/${id}`),
    create:    (data: CreateScheduleEntryDto) => ApiClient.post<ScheduleEntry>("/scheduling/entries", data),
    update:    (id: string, data: Partial<CreateScheduleEntryDto>) => ApiClient.put<ScheduleEntry>(`/scheduling/entries/${id}`, data),
    archive:   (id: string) => ApiClient.patch<void>(`/scheduling/entries/${id}/archive`),
    remove:    (id: string) => ApiClient.del(`/scheduling/entries/${id}`),
    // Derived schedules
    studentSchedule: (studentId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/students/${studentId}/schedule`, { params: { from, to } }),
    groupSchedule:   (groupId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/groups/${groupId}/schedule`, { params: { from, to } }),
    professorSchedule: (profId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/professors/${profId}/schedule`, { params: { from, to } }),
    classroomSchedule: (classroomId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/classrooms/${classroomId}/schedule`, { params: { from, to } }),
  },
  // Student exceptions
  exceptions: {
    create: (studentId: string, data: CreateExceptionDto) =>
      ApiClient.post<StudentScheduleException>(`/scheduling/students/${studentId}/exceptions`, data),
    remove: (id: string) => ApiClient.del(`/scheduling/exceptions/${id}`),
  },
  // Conflicts
  conflicts: {
    scan:   () => ApiClient.get<Conflict[]>("/scheduling/conflicts"),
    preview: (dto: Partial<CreateScheduleEntryDto>) => ApiClient.post<Conflict[]>("/scheduling/conflicts/preview", dto),
  },
};
```

### DTOs

```typescript
// dto/classroom.dto.ts
export interface CreateClassroomDto {
  name: string;
  building?: string;
  floor?: string;
  room_number?: string;
  capacity?: number;
  equipment?: string[];
  color?: string;
}

// dto/time-slot.dto.ts
export interface CreateTimeSlotDto {
  label: string;
  day_of_week: number;   // 0-6
  start_time: string;    // "HH:MM"
  end_time: string;      // "HH:MM"
  sort_order?: number;
}

// dto/schedule-entry.dto.ts
export interface CreateScheduleEntryDto {
  group_id: string;
  time_slot_id: string;
  classroom_id?: string | null;
  prof_id: string;
  subject?: string;
  notes?: string;
  effective_from: string;   // "YYYY-MM-DD"
  effective_until?: string | null;
}

// dto/student-exception.dto.ts
export type ExceptionType = 'substitute' | 'cancelled' | 'makeup';

export interface CreateExceptionDto {
  schedule_entry_id: string;
  exception_type: ExceptionType;
  exception_date: string;   // "YYYY-MM-DD"
  notes?: string;
}
```

---

## 8. Implementation Phases

### Phase 1 — Foundation (Week 1)

**Goal:** Database + backend core that can store and query the new entities.

| Task | Files | Notes |
|---|---|---|
| Drizzle schema | `apps/backend/src/db/schema.ts` | 4 new tables + indexes + CHECK constraints |
| Drizzle relations | `apps/backend/src/db/relations.ts` | 5 new relation blocks |
| Migration | `pnpm run db:generate` then review `drizzle/` output | Push via existing `db:push` |
| Module scaffold | `apps/backend/src/scheduling/scheduling.module.ts` | Imports DrizzleModule + AuditModule |
| Classroom service + controller | `classrooms/` folder | Full CRUD, soft delete with FK guard |
| Time slot service + controller | `time-slots/` folder | Full CRUD + reorder |
| Register module | `apps/backend/src/app.module.ts` | Add `SchedulingModule` |
| Feature flag | `hooks/use-system-settings.ts` | Add `"scheduling"` to `FEATURE_KEYS` |

### Phase 2 — Schedule Engine (Week 2)

**Goal:** Create/update schedule entries with conflict detection.

| Task | Files | Notes |
|---|---|---|
| Schedule entry service | `schedule-entries/schedule-entry.service.ts` | Create/update with conflict checks |
| Conflict service | `conflicts/conflict.service.ts` | Three queries, structured result |
| Student schedule derivation | `getStudentSchedule()` | Multi-group + exceptions |
| Group / Professor / Classroom schedule | `getGroupSchedule()`, `getProfessorSchedule()`, `getClassroomSchedule()` |
| Schedule entry controller | Full route table from §4.3 | Auth + super_admin gating |
| Student exception service + controller | `student-exceptions/` folder | |
| Unit tests | `__tests__/` | Conflict detection edge cases, date-range overlap logic |

### Phase 3 — Frontend — Classrooms & Time Slots (Week 3)

**Goal:** CRUD pages for the two foundational entities.

| Task | Files | Notes |
|---|---|---|
| API client | `lib/api/scheduling.api.ts` | Typed, mirrors controller |
| Custom hooks | `hooks/use-classrooms.ts`, `hooks/use-time-slots.ts` | TanStack Query with proper keys |
| Classroom page | `app/(dashboard)/scheduling/classrooms/page.tsx` | Cards + table toggle, filter by building |
| Classroom form modal | `components/scheduling/classroom-form.tsx` | React Hook Form + Zod |
| Time slot page | `app/(dashboard)/scheduling/time-slots/page.tsx` | Grid with drag handles for reorder |
| Time slot form modal | `components/scheduling/time-slot-form.tsx` | Day-of-week selector, time inputs |
| Sidebar registration | `components/shared/sidebar.tsx` | New "Scheduling" section |
| Types | `types/index.ts` | `Classroom`, `TimeSlot` interfaces |

### Phase 4 — Frontend — Schedule Entries & Calendar (Week 4–5)

**Goal:** The core scheduling UI — weekly calendar and entry management.

| Task | Files | Notes |
|---|---|---|
| Schedule entry form modal | `components/scheduling/schedule-entry-form-modal.tsx` | Group / prof / room / time pickers; conflict preview button |
| Conflict badge | `components/scheduling/conflict-badge.tsx` | Red chip with conflict count |
| Weekly calendar | `components/scheduling/weekly-calendar.tsx` | CSS Grid, colour-coded, 6-day (Sat–Thu) |
| Monthly calendar | `components/scheduling/monthly-calendar.tsx` | 30-day dot overview |
| Schedule entry card | `components/scheduling/schedule-entry-card.tsx` | Compact card for calendar cells |
| Entry page | `app/(dashboard)/scheduling/timetable/page.tsx` | Tab bar: Weekly / Monthly / By Group |
| Group schedule page | `app/(dashboard)/scheduling/groups/[groupId]/page.tsx` | Single group's week |
| Hooks | `hooks/use-schedule-entries.ts` | Cached queries keyed by group/prof/classroom/date |
| Print component | `components/scheduling/print-schedule.tsx` | A4 HTML, opens in new window |

### Phase 5 — Frontend — Student & Professor Views (Week 6)

**Goal:** Individual timetables with exception management.

| Task | Files | Notes |
|---|---|---|
| Student schedule page | `app/(dashboard)/scheduling/students/[studentId]/page.tsx` | Shows multi-group schedule + exception badges |
| Professor schedule page | `app/(dashboard)/scheduling/professors/[profId]/page.tsx` | Weekly view with colour-coded groups |
| Exception form modal | `components/scheduling/exception-form-modal.tsx` | Sub / Cancel / Makeup with date picker |
| Student exception hooks | `hooks/use-scheduling.ts` | `useStudentSchedule()`, `useCreateException()` |
| Conflict scan page | `app/(dashboard)/scheduling/conflicts/page.tsx` | List of all active conflicts with navigation |
| Dashboard page | `app/(dashboard)/scheduling/page.tsx` | Stats cards: total entries, rooms, conflicts, this week's sessions |

### Phase 6 — Polish & Integration (Week 7)

| Task | Notes |
|---|---|
| Attendance integration | Attendance sheet page gains "Generate from schedule" button — pulls active schedule entries for the group's month |
| Financial integration | Billing period display in financial views can reference schedule periods |
| Import enhancement | Student import wizard can auto-create schedule entries for imported groups (optional flag) |
| Print polish | Print layout matches existing attendance-sheet print style (A4, embedded logo) |
| Empty states | All pages have proper empty-state illustrations + CTAs |
| Mobile responsiveness | Calendar cells stack on narrow screens |
| E2E validation | Create group → add schedule → verify student sees it → add exception → verify |
| Documentation | README update + operator guide (setting up the weekly grid) |

---

## 9. Non-Functional Requirements

### Performance
- Schedule list queries use indexed columns (`group_id`, `time_slot_id`, `prof_id`, `classroom_id`, `is_active`, `effective_from`)
- Student schedule derivation is a single SQL query with JOINs — no N+1
- Conflict scan is capped at the active academic year (add `effective_from <= NOW() AND (effective_until IS NULL OR effective_until >= NOW())`)
- Weekly calendar data is cached in TanStack Query (5 min stale time, since schedules don't change minute-by-minute)

### Security
- All routes require JWT auth (cookie-based)
- Mutations require `super_admin` role
- Read routes are open to any authenticated user (teachers viewing their own schedule can be added later when roles expand)
- No raw SQL in route handlers — Drizzle ORM only
- Conflict detection runs in a read transaction before any write

### Data Safety
- Schedule entry creation/update runs conflict check in a **read transaction** before the write transaction — never leaves the database in an inconsistent state
- Soft delete on classrooms and time slots is blocked when active schedule entries reference them (RESTRICT behaviour enforced in service layer)
- Hard delete on schedule entries cascades to `student_schedule_exceptions` (DB-level `ON DELETE CASCADE`)

### Audit
Every mutation calls `auditService.log()` with:
- `action`: `schedule.classroom.created`, `schedule.entry.updated`, `schedule.exception.removed`, etc.
- `entity_type`: `classroom`, `time_slot`, `schedule_entry`, `student_schedule_exception`
- `entity_id`: the affected row UUID
- `prev_values` / `new_values`: full before/after snapshots

---

## 10. Migration Path

1. **New installations:** The new tables are created automatically by `drizzle-kit push` on first run. No operator action needed.

2. **Existing installations:** Run `pnpm run db:push` after pulling the new code. The four new tables are additive — they don't touch existing data. No seed data is required; operators create classrooms and time slots through the UI.

3. **Feature flag:** `"scheduling": false` by default in new installs (the seed script adds it). Existing installs that upgrade get the flag absent → treated as `false` by the frontend's `isFeatureEnabled()`. The operator enables it from Settings → Features.

4. **Rollback:** Disabling the feature flag hides the sidebar items and routes. The data remains in the database and can be re-enabled immediately.

---

## 11. Open Questions

| Question | Options | Recommended |
|---|---|---|
| Tunisian school week: Sat–Thu or Sun–Thu? | Sat–Thu (most common) | `day_of_week` 0=Saturday … 4=Wednesday, 5=Thursday |
| Should schedule entries cascade-delete with their group? | Yes (simplifies cleanup) | DB `ON DELETE CASCADE` on `group_id` FK |
| Should there be a "draft" status before entries go live? | No — `is_active` + `effective_from` handles this | `is_active = false` for draft; `effective_from` for future start |
| Max concurrent schedule entries per time slot? | Unlimited (classrooms constrain it) | Rely on unique constraints + conflict detection |
| Should time slots be per-school or global? | Per-school (some schools have different period counts) | Add `school_id` if multi-tenant is planned; omit for now (single-tenant) |
