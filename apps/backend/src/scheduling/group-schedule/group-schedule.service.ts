import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
import { and, asc, eq, gt, gte, inArray, lt, lte, or, sql, SQL } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  groups,
  professors,
  scheduleEntries,
  studentAssignments,
  students,
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

  async syncTiles(groupId: string, tiles: TileDto[], profId: string): Promise<SyncTilesResult> {
    const group = await this.db.client.query.groups.findFirst({
      where: eq(groups.id, groupId),
      columns: { id: true, name: true },
    });
    if (!group) throw new NotFoundException(`Group ${groupId} not found`);

    const created: SyncTilesResult["created"] = [];
    const conflicts: SyncTilesResult["conflicts"] = [];

    for (const tile of tiles) {
      const timeSlot = await this.findOrCreateTimeSlot(tile);
      const date = new Date().toISOString().split("T")[0];

      const tileConflicts = await this.conflict.checkProfessor(profId, timeSlot.id, date, undefined);
      if (tile.classroom_id) {
        tileConflicts.push(...(await this.conflict.checkClassroom(tile.classroom_id, timeSlot.id, date, undefined)));
      }
      const studentConflicts = await this.conflict.checkStudents(groupId, timeSlot.id, date, undefined);
      tileConflicts.push(...studentConflicts);

      const [entry] = await this.db.client.insert(scheduleEntries).values({
        group_id: groupId,
        time_slot_id: timeSlot.id,
        classroom_id: tile.classroom_id ?? null,
        prof_id: profId,
        effective_from: new Date(date),
        effective_until: null,
      }).returning();

      const full = await this.entryService.get(entry.id);
      created.push(full);

      const action = tileConflicts.length > 0 ? "schedule.entry.created_with_conflict" : "schedule.entry.created";
      await this.audit.record({
        action,
        entityType: "schedule_entry",
        entityId: entry.id,
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
      newValues: { tiles_synced: tiles.length, conflicts },
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
