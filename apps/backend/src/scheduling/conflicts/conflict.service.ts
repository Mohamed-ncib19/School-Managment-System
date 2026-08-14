import { Injectable } from "@nestjs/common";
import { and, eq, gt, gte, inArray, lt, lte, or, sql, SQL } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { classrooms, professors, scheduleEntries, scheduleEntryExceptions, studentAssignments, students, timeSlots } from "../../db/schema";
import { Conflict, ConflictType } from "../types";
import { schoolDayOfDate } from "../date.util";

export interface ProposedRule {
  group_id: string;
  time_slot_id: string;
  classroom_id?: string | null;
  prof_id: string;
  /** First date of the rule (ISO). */
  effective_from: string;
  /** Last date, or null for open-ended. */
  effective_until?: string | null;
  /** When checking an existing rule, exclude it from the scan. */
  excludeEntryId?: string;
}

export interface TimeSlotRef {
  id: string;
  label: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/**
 * Two conflict layers:
 *
 * Layer 1 — rule vs rule. Any two active rules sharing a resource (professor,
 * classroom, or a student via overlapping rosters) with the same weekday, an
 * overlapping time range and overlapping effective ranges conflict, regardless
 * of when each rule started. Used on every rule create/split.
 *
 * Layer 2 — occurrence vs occurrence. For a concrete target date (a `moved` or
 * `substitute_prof` exception), expand the rules that would actually occupy the
 * professor/classroom on that date — honouring cancellations and re-dates — and
 * check the proposed time window against them. Used on exception creation.
 *
 * Both return the same `Conflict` shape.
 */
@Injectable()
export class ConflictService {
  constructor(private readonly db: DbService) {}

  /** Layer 1 — rule vs rule with full effective-range overlap. */
  async checkRule(proposed: ProposedRule): Promise<Conflict[]> {
    const ts = await this.timeSlotOf(proposed.time_slot_id);
    if (!ts) return [];

    const conflicts: Conflict[] = [];

    conflicts.push(
      ...(await this.clashesFor(
        "professor",
        proposed.prof_id,
        eq(scheduleEntries.prof_id, proposed.prof_id),
        ts,
        proposed,
      )),
    );

    if (proposed.classroom_id) {
      conflicts.push(
        ...(await this.clashesFor(
          "classroom",
          proposed.classroom_id!,
          eq(scheduleEntries.classroom_id, proposed.classroom_id!),
          ts,
          proposed,
        )),
      );
    }

    conflicts.push(...(await this.studentClashes(proposed, ts)));

    return conflicts;
  }

  /**
   * Layer 2 — expanded occupancy check for one concrete date. Used before
   * creating `moved` / `substitute_prof` exceptions.
   */
  async checkOccurrencesOnDate(
    target: { profId?: string; classroomId?: string },
    date: string,
    startTime: string,
    endTime: string,
    excludeEntryId?: string,
  ): Promise<Conflict[]> {
    const dayOfWeek = this.dayOfWeekFromDate(date);
    const fromObj = new Date(date + "T00:00:00Z");
    const toObj = new Date(date + "T23:59:59.999Z");

    const bounds: SQL[] = [
      eq(scheduleEntries.is_active, true),
      lte(scheduleEntries.effective_from, toObj),
      or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, fromObj)) as SQL,
    ];
    if (target.profId) bounds.push(eq(scheduleEntries.prof_id, target.profId));
    if (target.classroomId) bounds.push(eq(scheduleEntries.classroom_id, target.classroomId));
    if (excludeEntryId) bounds.push(sql`${scheduleEntries.id} != ${excludeEntryId}`);

    const rules = await this.db.client
      .select({
        id: scheduleEntries.id,
        day_of_week: timeSlots.day_of_week,
        start_time: timeSlots.start_time,
        end_time: timeSlots.end_time,
        label: timeSlots.label,
      })
      .from(scheduleEntries)
      .innerJoin(timeSlots, eq(timeSlots.id, scheduleEntries.time_slot_id))
      .where(and(...bounds));

    const occupying = new Map<string, { day_of_week: number; start_time: string; end_time: string; label: string }>();
    for (const rule of rules) {
      // Only rules whose weekday matches the target date meet that day.
      if (rule.day_of_week !== dayOfWeek) continue;
      occupying.set(rule.id, rule);
    }

    // Cancel / moved-away overrides free the slot; moved-onto-date overrides occupy it.
    if (occupying.size > 0) {
      const overrides = await this.db.client.query.scheduleEntryExceptions.findMany({
        where: and(
          inArray(scheduleEntryExceptions.schedule_entry_id, [...occupying.keys()]),
          or(
            eq(scheduleEntryExceptions.exception_type, "cancelled"),
            eq(scheduleEntryExceptions.exception_type, "moved"),
          ) as SQL,
        ),
        columns: { id: true, schedule_entry_id: true, occurrence_date: true, exception_type: true, new_date: true },
      });
      for (const ov of overrides) {
        if (ov.occurrence_date.toISOString().slice(0, 10) !== date) continue;
        if (ov.exception_type === "cancelled") occupying.delete(ov.schedule_entry_id);
        if (ov.exception_type === "moved" && ov.new_date?.toISOString().slice(0, 10) !== date) {
          occupying.delete(ov.schedule_entry_id);
        }
      }
    }

    const movedIn = await this.db.client.query.scheduleEntryExceptions.findMany({
      where: and(
        eq(scheduleEntryExceptions.exception_type, "moved"),
        gte(scheduleEntryExceptions.new_date, fromObj),
        lte(scheduleEntryExceptions.new_date, toObj),
      ),
      columns: { id: true, schedule_entry_id: true, new_time_slot_id: true, new_prof_id: true, new_classroom_id: true },
      with: {
        scheduleEntry: {
          columns: { prof_id: true, classroom_id: true },
          with: { timeSlot: { columns: { day_of_week: true, start_time: true, end_time: true, label: true } } },
        },
      },
    });

    for (const mov of movedIn) {
      if (!mov.scheduleEntry) continue;
      const matches =
        (target.profId && mov.scheduleEntry.prof_id === target.profId) ||
        (target.classroomId && mov.scheduleEntry.classroom_id === target.classroomId);
      if (!matches) continue;
      if (mov.schedule_entry_id === excludeEntryId) continue;
      const ts = mov.new_time_slot_id
        ? await this.timeSlotOf(mov.new_time_slot_id)
        : mov.scheduleEntry.timeSlot;
      if (!ts) continue;
      occupying.set(`${mov.schedule_entry_id}#moved`, {
        day_of_week: ts.day_of_week,
        start_time: ts.start_time,
        end_time: ts.end_time,
        label: ts.label,
      });
    }

    const entityId = target.profId ?? target.classroomId ?? "";
    const type: ConflictType = target.profId ? "professor" : "classroom";
    const overlapping = [...occupying].filter(
      ([, slot]) => slot.start_time < endTime && slot.end_time > startTime,
    );
    // Same reasoning as `clashesFor`: don't pay for the name when there is
    // nothing to name.
    if (overlapping.length === 0) return [];

    const entityName = (await this.entityName(type, entityId)) ?? entityId;
    return overlapping.map(([entryId, slot]) => ({
      type,
      entityId,
      entityName,
      scheduleEntryId: entryId,
      timeSlotLabel: `${slot.label} (${slot.start_time}–${slot.end_time})`,
      date,
    }));
  }

  /**
   * Full active-rule conflict scan — feeds the conflicts page and its badges.
   *
   * Three set-based queries rather than a pass per rule.
   *
   * The shape this replaces walked every active rule and called `checkRule` on
   * it, and each of those calls issued between seven and nine round trips of
   * its own — a time-slot lookup, a clash query and a name lookup per resource,
   * and four more for the student roster. Sequentially, in a loop. Three
   * hundred rules meant something in the order of two and a half thousand
   * queries to answer one question, and the cost grew with the square of the
   * timetable rather than with the number of conflicts in it.
   *
   * Every clause below is the same predicate `clashesFor` and `studentClashes`
   * apply per rule — same weekday, overlapping time window, overlapping
   * effective range — expressed once as a self-join so the database finds the
   * pairs directly.
   */
  async scanAll(): Promise<Conflict[]> {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // Rules in force today, for the `a` side of every join below. Written with
    // the alias rather than Drizzle column references: those render as
    // `schedule_entries.<col>`, which is not in scope once the table is joined
    // to itself under aliases.
    const liveToday = sql`
      a.is_active = true
      and a.effective_from <= ${today}
      and (a.effective_until is null or a.effective_until >= ${today})
    `;

    interface Row {
      entity_id: string;
      entity_name: string;
      schedule_entry_id: string;
      label: string;
      start_time: string;
      end_time: string;
    }

    /**
     * Pairs of live rules that occupy the same resource at an overlapping time.
     *
     * `a` is the rule being reported against and `b` the one it clashes with;
     * the pair is emitted in both directions by the join itself, which is what
     * the per-rule loop produced by scanning every rule in turn.
     */
    const resourceClashes = (type: "professor" | "classroom") => {
      const joinOn =
        type === "professor"
          ? sql`b.prof_id = a.prof_id`
          : sql`b.classroom_id = a.classroom_id and a.classroom_id is not null`;
      const entityId = type === "professor" ? sql`a.prof_id` : sql`a.classroom_id`;
      const entityName =
        type === "professor"
          ? sql`p.full_name`
          : sql`case when c.room_number is null then c.name else c.name || ' - ' || c.room_number end`;
      const entityJoin =
        type === "professor"
          ? sql`join professors p on p.id = a.prof_id`
          : sql`join classrooms c on c.id = a.classroom_id`;

      return this.db.rawQuery<Row>(sql`
        select ${entityId} as entity_id,
               ${entityName} as entity_name,
               b.id as schedule_entry_id,
               tsa.label as label,
               tsa.start_time as start_time,
               tsa.end_time as end_time
        from schedule_entries a
        join schedule_entries b
          on b.id <> a.id
         and ${joinOn}
         and b.is_active = true
         and (b.effective_until is null or b.effective_until >= ${today})
        join time_slots tsa on tsa.id = a.time_slot_id
        join time_slots tsb on tsb.id = b.time_slot_id
        ${entityJoin}
        where ${liveToday}
          and tsa.day_of_week = tsb.day_of_week
          and tsa.start_time < tsb.end_time
          and tsa.end_time > tsb.start_time
      `);
    };

    /**
     * Students sitting in two groups that meet at the same time.
     *
     * The roster join replaces the per-rule "who is enrolled here, what else
     * are they in, do any of those clash" sequence with one pass.
     */
    const studentClashes = this.db.rawQuery<Row>(sql`
      select st.id as entity_id,
             st.first_name || ' ' || st.last_name as entity_name,
             b.id as schedule_entry_id,
             tsa.label as label,
             tsa.start_time as start_time,
             tsa.end_time as end_time
      from schedule_entries a
      join student_assignments sa_a on sa_a.group_id = a.group_id
      join student_assignments sa_b
        on sa_b.student_id = sa_a.student_id
       and sa_b.group_id <> a.group_id
      join schedule_entries b
        on b.group_id = sa_b.group_id
       and b.id <> a.id
       and b.is_active = true
       and (b.effective_until is null or b.effective_until >= ${today})
      join students st on st.id = sa_a.student_id
      join time_slots tsa on tsa.id = a.time_slot_id
      join time_slots tsb on tsb.id = b.time_slot_id
      where ${liveToday}
        and tsa.day_of_week = tsb.day_of_week
        and tsa.start_time < tsb.end_time
        and tsa.end_time > tsb.start_time
    `);

    const [professorRows, classroomRows, studentRows] = await Promise.all([
      resourceClashes("professor"),
      resourceClashes("classroom"),
      studentClashes,
    ]);

    const conflicts: Conflict[] = [];
    const seen = new Set<string>();
    const collect = (type: ConflictType, rows: Row[]) => {
      for (const row of rows) {
        const timeSlotLabel = `${row.label} (${row.start_time}–${row.end_time})`;
        const key = `${type}:${row.entity_id}:${row.schedule_entry_id}:${timeSlotLabel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          type,
          entityId: row.entity_id,
          entityName: row.entity_name,
          scheduleEntryId: row.schedule_entry_id,
          timeSlotLabel,
          date: todayStr,
        });
      }
    };

    collect("professor", professorRows);
    collect("classroom", classroomRows);
    collect("student", studentRows);

    return conflicts;
  }

  // ---- Layer 1 internals ----

  private async clashesFor(
    type: "professor" | "classroom",
    entityId: string,
    entityClause: SQL,
    ts: TimeSlotRef,
    proposed: ProposedRule,
  ): Promise<Conflict[]> {
    const rangeClauses: SQL[] = [
      eq(scheduleEntries.is_active, true),
      eq(timeSlots.day_of_week, ts.day_of_week),
      lt(timeSlots.start_time, ts.end_time),
      gt(timeSlots.end_time, ts.start_time),
      lte(scheduleEntries.effective_from, new Date((proposed.effective_until ?? "9999-12-31") + "T23:59:59.999Z")),
      or(
        sql`${scheduleEntries.effective_until} IS NULL`,
        gte(scheduleEntries.effective_until, new Date(proposed.effective_from + "T00:00:00Z")),
      ) as SQL,
    ];
    if (proposed.excludeEntryId) rangeClauses.push(sql`${scheduleEntries.id} != ${proposed.excludeEntryId}`);

    const clashes = await this.db.client
      .select({ id: scheduleEntries.id })
      .from(scheduleEntries)
      .innerJoin(timeSlots, eq(timeSlots.id, scheduleEntries.time_slot_id))
      .where(and(entityClause, ...rangeClauses));

    // The name is only needed to label a clash. Resolving it first meant a
    // second round trip on every check, and the check almost always comes back
    // clean — the weekly builder fires one per keystroke-debounced edit.
    if (clashes.length === 0) return [];

    const entityName = (await this.entityName(type, entityId)) ?? entityId;
    return clashes.map((clash) => ({
      type,
      entityId,
      entityName,
      scheduleEntryId: clash.id,
      timeSlotLabel: `${ts.label} (${ts.start_time}–${ts.end_time})`,
      date: proposed.effective_from,
    }));
  }

  /**
   * Students enrolled in the proposed group who also sit in another group whose
   * rule clashes with the proposed slot — per affected student.
   */
  private async studentClashes(proposed: ProposedRule, ts: TimeSlotRef): Promise<Conflict[]> {
    const enrolled = await this.db.client
      .select({ student_id: studentAssignments.student_id })
      .from(studentAssignments)
      .where(eq(studentAssignments.group_id, proposed.group_id));
    const studentIds = enrolled.map((r) => r.student_id);
    if (studentIds.length === 0) return [];

    // Every other group each of those students belongs to.
    const others = await this.db.client
      .select({ student_id: studentAssignments.student_id, group_id: studentAssignments.group_id })
      .from(studentAssignments)
      .where(and(inArray(studentAssignments.student_id, studentIds), sql`${studentAssignments.group_id} != ${proposed.group_id}`));
    if (others.length === 0) return [];

    const otherGroupIds = [...new Set(others.map((r) => r.group_id))];
    const clashes = await this.db.client
      .select({ rule_id: scheduleEntries.id, group_id: scheduleEntries.group_id })
      .from(scheduleEntries)
      .innerJoin(timeSlots, eq(timeSlots.id, scheduleEntries.time_slot_id))
      .where(
        and(
          inArray(scheduleEntries.group_id, otherGroupIds),
          eq(scheduleEntries.is_active, true),
          eq(timeSlots.day_of_week, ts.day_of_week),
          lt(timeSlots.start_time, ts.end_time),
          gt(timeSlots.end_time, ts.start_time),
          lte(scheduleEntries.effective_from, new Date((proposed.effective_until ?? "9999-12-31") + "T23:59:59.999Z")),
          or(
            sql`${scheduleEntries.effective_until} IS NULL`,
            gte(scheduleEntries.effective_until, new Date(proposed.effective_from + "T00:00:00Z")),
          ) as SQL,
          proposed.excludeEntryId ? sql`${scheduleEntries.id} != ${proposed.excludeEntryId}` : sql`true`,
        ),
      );

    if (clashes.length === 0) return [];

    const names = await this.db.client.query.students.findMany({
      where: inArray(students.id, studentIds),
      columns: { id: true, first_name: true, last_name: true },
    });
    const nameMap = new Map(names.map((s) => [s.id, `${s.first_name} ${s.last_name}`]));
    const studentsByOtherGroup = new Map<string, Set<string>>();
    for (const row of others) {
      if (!clashes.some((c) => c.group_id === row.group_id)) continue;
      let set = studentsByOtherGroup.get(row.group_id);
      if (!set) {
        set = new Set();
        studentsByOtherGroup.set(row.group_id, set);
      }
      set.add(row.student_id);
    }

    const conflicts: Conflict[] = [];
    const seen = new Set<string>();
    for (const clash of clashes) {
      for (const studentId of studentsByOtherGroup.get(clash.group_id) ?? []) {
        const key = `${studentId}:${clash.rule_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          type: "student",
          entityId: studentId,
          entityName: nameMap.get(studentId) ?? studentId,
          scheduleEntryId: clash.rule_id,
          timeSlotLabel: `${ts.label} (${ts.start_time}–${ts.end_time})`,
          date: proposed.effective_from,
        });
      }
    }
    return conflicts;
  }

  // ---- legacy single-date helpers (used by the weekly tile builder) ----

  /**
   * These take either a stored slot's id or a bare window.
   *
   * Only the weekday and the two times decide whether something clashes, so a
   * window that has never been saved can be answered as well as one that has.
   * That is what lets the tile builder's live preview stay a pure read: it used
   * to have to *create* a `time_slots` row for the window being dragged just to
   * have an id to ask about, so every distinct time an admin tried while
   * hesitating left a permanent row behind — and every keystroke on a preview
   * wrote to the database.
   */
  async checkProfessor(profId: string, slot: string | TimeSlotRef, date: string, excludeEntryId?: string): Promise<Conflict[]> {
    const ts = await this.timeSlotOf(slot);
    if (!ts) return [];
    return this.clashesFor("professor", profId, eq(scheduleEntries.prof_id, profId), ts, {
      group_id: "",
      time_slot_id: ts.id,
      prof_id: profId,
      effective_from: date,
      effective_until: date,
      excludeEntryId,
    });
  }

  async checkClassroom(classroomId: string, slot: string | TimeSlotRef, date: string, excludeEntryId?: string): Promise<Conflict[]> {
    const ts = await this.timeSlotOf(slot);
    if (!ts) return [];
    return this.clashesFor("classroom", classroomId, eq(scheduleEntries.classroom_id, classroomId), ts, {
      group_id: "",
      time_slot_id: ts.id,
      classroom_id: classroomId,
      prof_id: "",
      effective_from: date,
      effective_until: date,
      excludeEntryId,
    });
  }

  async checkStudents(groupId: string, slot: string | TimeSlotRef, date: string, excludeEntryId?: string): Promise<Conflict[]> {
    const ts = await this.timeSlotOf(slot);
    if (!ts) return [];
    return this.studentClashes({ group_id: groupId, time_slot_id: ts.id, prof_id: "", effective_from: date, effective_until: date, excludeEntryId }, ts);
  }

  // ---- helpers ----

  private async timeSlotOf(slot: string | TimeSlotRef): Promise<TimeSlotRef | null> {
    if (typeof slot !== "string") return slot;
    const ts = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, slot),
      columns: { id: true, label: true, day_of_week: true, start_time: true, end_time: true },
    });
    return ts as TimeSlotRef | null;
  }

  private async entityName(type: ConflictType, id: string): Promise<string | null> {
    if (type === "professor") {
      const prof = await this.db.client.query.professors.findFirst({ where: eq(professors.id, id), columns: { full_name: true } });
      return prof?.full_name ?? null;
    }
    if (type === "classroom") {
      const room = await this.db.client.query.classrooms.findFirst({ where: eq(classrooms.id, id), columns: { name: true, room_number: true } });
      if (!room) return null;
      return room.room_number ? `${room.name} - ${room.room_number}` : room.name;
    }
    const student = await this.db.client.query.students.findFirst({ where: eq(students.id, id), columns: { first_name: true, last_name: true } });
    return student ? `${student.first_name} ${student.last_name}` : null;
  }

  /**
   * The `time_slots.day_of_week` a date falls on.
   *
   * This used to apply `(getUTCDay() + 6) % 7` — the school→JS rotation — in
   * the JS→school direction, which is wrong on every day of the week and two
   * days off. `checkOccurrencesOnDate` then filtered candidate rules against
   * the wrong weekday entirely, so a substitution or room change silently
   * missed a genuine double-booking on the target date while being blocked by
   * an unrelated rule two weekdays away.
   */
  private dayOfWeekFromDate(date: string): number {
    return schoolDayOfDate(date);
  }
}