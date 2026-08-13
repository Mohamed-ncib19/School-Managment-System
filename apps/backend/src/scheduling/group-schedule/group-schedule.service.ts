import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  groups,
  scheduleEntries,
  studentAssignments,
  timeSlots,
} from "../../db/schema";
import { AuditService } from "../../audit/audit.service";
import { ConflictService } from "../conflicts/conflict.service";
import { ClassroomRepository } from "../classrooms/classroom.repository";
import { ScheduleEntryService } from "../schedule-entries/schedule-entry.service";
import { SyncTilesResult, TileDto } from "../types";

@Injectable()
export class GroupScheduleService {
  constructor(
    private readonly db: DbService,
    private readonly conflict: ConflictService,
    private readonly entryService: ScheduleEntryService,
    private readonly classroomRepo: ClassroomRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Makes a group's weekly sessions match the submitted set.
   *
   * A *sync*, not an append. Saving an edited timetable used to insert every
   * submitted tile on top of the ones already there, so a group edited twice
   * held its schedule twice over and there was no way to remove a session at
   * all — which is what made editing a group's times look like it "didn't
   * save": the form came up empty, and anything typed into it was added
   * alongside the invisible existing rows.
   *
   * Tiles already present are left untouched rather than dropped and
   * recreated, so their ids, exceptions and history survive an unrelated edit.
   * An empty `tiles` array is a legitimate instruction — it clears the
   * schedule.
   */
  async syncTiles(
    groupId: string,
    tiles: TileDto[],
    profId: string,
    options: { allowConflicts?: boolean } = {},
  ): Promise<SyncTilesResult> {
    const group = await this.db.client.query.groups.findFirst({
      where: eq(groups.id, groupId),
      columns: { id: true, name: true },
    });
    if (!group) throw new NotFoundException(`Group ${groupId} not found`);

    const created: SyncTilesResult["created"] = [];
    const conflicts: SyncTilesResult["conflicts"] = [];
    const date = new Date().toISOString().split("T")[0];

    // What the group already has, so the submitted set can be diffed against
    // it rather than blindly added to it.
    const existing = await this.db.client
      .select({
        id: scheduleEntries.id,
        classroom_id: scheduleEntries.classroom_id,
        time_slot_id: scheduleEntries.time_slot_id,
        day_of_week: timeSlots.day_of_week,
        start_time: timeSlots.start_time,
        end_time: timeSlots.end_time,
      })
      .from(scheduleEntries)
      .innerJoin(timeSlots, eq(timeSlots.id, scheduleEntries.time_slot_id))
      .where(and(eq(scheduleEntries.group_id, groupId), eq(scheduleEntries.is_active, true)));

    /** A session is the same session when it meets at the same time in the same room. */
    const identity = (t: { day_of_week: number; start_time: string; end_time: string; classroom_id: string | null }) =>
      `${t.day_of_week}|${t.start_time.slice(0, 5)}|${t.end_time.slice(0, 5)}|${t.classroom_id ?? ""}`;

    const existingByIdentity = new Map(existing.map((e) => [identity(e), e]));
    const submittedIdentities = new Set(
      tiles.map((t) => identity({ ...t, classroom_id: t.classroom_id ?? null })),
    );

    const unchanged = tiles.filter((t) =>
      existingByIdentity.has(identity({ ...t, classroom_id: t.classroom_id ?? null })),
    );
    const toAdd = tiles.filter(
      (t) => !existingByIdentity.has(identity({ ...t, classroom_id: t.classroom_id ?? null })),
    );
    const toRemove = existing.filter((e) => !submittedIdentities.has(identity(e)));

    /**
     * Sessions this save is retiring cannot be conflicted with.
     *
     * Moving a class from Monday 09:00 to Monday 09:30 submits a new tile whose
     * window overlaps the old one — which is still in the table at the moment
     * the check runs. Without this the most ordinary edit there is would report
     * the session clashing with itself and refuse to save.
     */
    const retiring = new Set(toRemove.map((e) => e.id));
    const survives = (c: { scheduleEntryId: string }) => !retiring.has(c.scheduleEntryId);

    // Only genuinely new sessions are checked: a tile the group already holds
    // conflicts with itself, and re-reporting that on every save would make an
    // untouched timetable look broken.
    const prepared = await Promise.all(
      toAdd.map(async (tile) => {
        const timeSlot = await this.findOrCreateTimeSlot(tile);
        const [professorClashes, classroomClashes, studentClashes] = await Promise.all([
          this.conflict.checkProfessor(profId, timeSlot.id, date),
          tile.classroom_id
            ? this.conflict.checkClassroom(tile.classroom_id, timeSlot.id, date)
            : Promise.resolve([]),
          this.conflict.checkStudents(groupId, timeSlot.id, date),
        ]);
        const rooms = classroomClashes.filter(survives);
        return {
          tile,
          timeSlot,
          classroomClashes: rooms,
          tileConflicts: [...professorClashes.filter(survives), ...rooms, ...studentClashes.filter(survives)],
        };
      }),
    );

    /**
     * A room cannot hold two classes at once.
     *
     * Professor and student clashes are a judgement call — a substitute, a
     * split session, a student who will attend one of the two — so they warn
     * and can be overridden. A double-booked classroom is not a judgement
     * call: whatever the timetable says, only one of the groups can be in the
     * room. Refusing it here is what makes the room column trustworthy.
     */
    const blocked = prepared.filter((p) => p.classroomClashes.length > 0);
    if (blocked.length > 0) {
      throw new ConflictException({
        message: "Cette salle est déjà occupée sur ce créneau",
        code: "CLASSROOM_UNAVAILABLE",
        conflicts: blocked.flatMap((p) => p.classroomClashes),
      });
    }

    // Everything else is overridable, but only deliberately.
    const overridable = prepared.flatMap((p) => p.tileConflicts);
    if (overridable.length > 0 && !options.allowConflicts) {
      throw new ConflictException({
        message: "Ce créneau chevauche un autre cours",
        code: "SCHEDULE_CONFLICT",
        conflicts: overridable,
      });
    }

    // One transaction for the whole reconciliation: adding the new sessions and
    // retiring the removed ones have to land together, or a failure halfway
    // leaves the group with both the old and the new timetable.
    const insertedIds = await this.db.client.transaction(async (tx) => {
      if (toRemove.length > 0) {
        // Archived rather than deleted: an entry may already carry exceptions
        // and attendance history, and those describe sessions that really
        // happened.
        await tx
          .update(scheduleEntries)
          .set({ is_active: false, effective_until: new Date(date) })
          .where(inArray(scheduleEntries.id, toRemove.map((e) => e.id)));
      }

      if (prepared.length === 0) return [];

      const rows = await tx
        .insert(scheduleEntries)
        .values(
          prepared.map(({ tile, timeSlot }) => ({
            group_id: groupId,
            time_slot_id: timeSlot.id,
            classroom_id: tile.classroom_id ?? null,
            prof_id: profId,
            effective_from: new Date(date),
            effective_until: null,
          })),
        )
        .returning({ id: scheduleEntries.id });
      return rows.map((r) => r.id);
    });

    for (const [index, entryId] of insertedIds.entries()) {
      const { tile, timeSlot, tileConflicts } = prepared[index];
      created.push(await this.entryService.get(entryId));

      const action = tileConflicts.length > 0 ? "schedule.entry.created_with_conflict" : "schedule.entry.created";
      await this.audit.record({
        action,
        entityType: "schedule_entry",
        entityId: entryId,
        entityLabel: `${group.name} / ${timeSlot.label}`,
        newValues: { group_id: groupId, time_slot_id: timeSlot.id, classroom_id: tile.classroom_id, prof_id: profId },
        meta: tileConflicts.length > 0 ? { conflicts: tileConflicts } : undefined,
      });
      conflicts.push(...tileConflicts);
    }

    await this.recomputeScheduleNotes(groupId);
    await this.audit.record({
      action: "group.schedule.updated",
      entityType: "group",
      entityId: groupId,
      entityLabel: group.name,
      newValues: {
        added: prepared.length,
        removed: toRemove.length,
        unchanged: unchanged.length,
        conflicts,
      },
    });

    return { created, conflicts };
  }

  async removeTile(groupId: string, scheduleEntryId: string) {
    const entry = await this.entryService.get(scheduleEntryId);
    if (entry.group_id !== groupId) {
      throw new NotFoundException(`Schedule entry ${scheduleEntryId} does not belong to group ${groupId}`);
    }
    await this.entryService.archive(scheduleEntryId);
    await this.recomputeScheduleNotes(groupId);
  }

  async getStudentEligibility(studentId: string): Promise<{ groupCount: number; eligible: boolean }> {
    const rows = await this.db.client
      .select({ count: sql<number>`count(*)::int` })
      .from(studentAssignments)
      .where(eq(studentAssignments.student_id, studentId));
    const count = (rows[0]?.count ?? 0) as number;
    return { groupCount: count, eligible: count >= 2 };
  }

  private async findOrCreateTimeSlot(tile: TileDto): Promise<{ id: string; label: string }> {
    const existing = await this.db.client.query.timeSlots.findFirst({
      where: and(
        eq(timeSlots.day_of_week, tile.day_of_week),
        eq(timeSlots.start_time, tile.start_time),
        eq(timeSlots.end_time, tile.end_time),
      ),
      columns: { id: true, label: true },
    });
    if (existing) return { id: existing.id, label: existing.label };

    const dayNames = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
    const label = `${dayNames[tile.day_of_week] ?? "Day"} ${tile.start_time}–${tile.end_time}`;
    const [slot] = await this.db.client.insert(timeSlots).values({
      label,
      day_of_week: tile.day_of_week,
      start_time: tile.start_time,
      end_time: tile.end_time,
      sort_order: tile.day_of_week * 100,
    }).returning();
    return { id: slot.id, label: slot.label };
  }

  private async recomputeScheduleNotes(groupId: string) {
    const entries = await this.db.client.query.scheduleEntries.findMany({
      where: and(eq(scheduleEntries.group_id, groupId), eq(scheduleEntries.is_active, true)),
      with: { timeSlot: { columns: { label: true, start_time: true, end_time: true, day_of_week: true } } },
      orderBy: [asc(scheduleEntries.created_at)],
    });

    if (entries.length === 0) {
      await this.db.client.update(groups).set({ schedule_notes: null }).where(eq(groups.id, groupId));
      return;
    }

    const dayNames = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
    const parts = entries.map((e) => {
      const ts = e.timeSlot;
      return `${dayNames[ts.day_of_week] ?? ts.day_of_week} ${ts.start_time}–${ts.end_time}`;
    });
    const summary = parts.join(", ");

    await this.db.client.update(groups).set({ schedule_notes: summary }).where(eq(groups.id, groupId));
  }
}
