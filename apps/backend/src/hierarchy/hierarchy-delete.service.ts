import { Injectable, NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DbService } from "../db/db.service";
import {
  fields,
  groups,
  levels,
  professors,
  students,
  studentAssignments,
  scheduleEntries,
  studentScheduleExceptions,
  paymentTransactions,
  studentPayments,
} from "../db/schema";
import { AuditService } from "../audit/audit.service";

type HierarchyNodeType = "level" | "field" | "professor" | "group" | "student";

interface DeleteImpact {
  level: number;
  field: number;
  professor: number;
  group: number;
  student: number;
  directChildren: Array<{ id: string; name: string; type: HierarchyNodeType }>;
}

interface ArchiveCascadeResult {
  affected: DeleteImpact;
}

interface DetachPlan {
  mode: "reassign" | "reassign_individual";
  targetParentId?: string;
  assignments?: Array<{ childId: string; targetParentId: string }>;
}

@Injectable()
export class HierarchyDeleteService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  Shared helpers                                                     */
  /* ------------------------------------------------------------------ */

  private async assertActive(type: HierarchyNodeType, id: string) {
    let row: any = null;
    switch (type) {
      case "level":
        row = await this.db.client.query.levels.findFirst({ where: eq(levels.id, id), columns: { id: true, name: true, is_active: true } });
        break;
      case "field":
        row = await this.db.client.query.fields.findFirst({ where: eq(fields.id, id), columns: { id: true, name: true, is_active: true, level_id: true } });
        break;
      case "professor":
        row = await this.db.client.query.professors.findFirst({ where: eq(professors.id, id), columns: { id: true, full_name: true, is_active: true, field_id: true } });
        break;
      case "group":
        row = await this.db.client.query.groups.findFirst({ where: eq(groups.id, id), columns: { id: true, name: true, is_active: true, prof_id: true } });
        break;
      case "student":
        row = await this.db.client.query.students.findFirst({ where: eq(students.id, id), columns: { id: true, first_name: true, last_name: true, status: true } });
        break;
    }
    if (!row) throw new NotFoundException(`${type} ${id} not found`);
    if (type !== "student" && row.is_active === false) {
      throw new ConflictException(`${type} is already archived`);
    }
    if (type === "student" && row.status === "withdrawn") {
      throw new ConflictException(`student is already withdrawn`);
    }
    return row;
  }

  private labelOf(type: HierarchyNodeType, row: any): string {
    if (type === "level") return row.name;
    if (type === "field") return row.name;
    if (type === "professor") return row.full_name;
    if (type === "group") return row.name;
    if (type === "student") return `${row.first_name} ${row.last_name}`.trim();
    return String(row.id);
  }

  private entityLabel(type: HierarchyNodeType, row: any): string {
    return this.labelOf(type, row);
  }

  /* ------------------------------------------------------------------ */
  /*  Delete impact preview (used by all 3 actions)                      */
  /* ------------------------------------------------------------------ */

  /**
   * What deleting this node would touch.
   *
   * The counts are the whole subtree; `directChildren` is strictly the layer
   * immediately below, because that is the only layer "Delete this only" can
   * re-point — a field's professors move to another field, but its groups move
   * with their professor and are never chosen individually.
   *
   * `directChildren` previously collected every descendant except the target,
   * and for a level it collected the professors and groups underneath while
   * never including the level's own fields. The reassignment UI lists exactly
   * this array, so deleting a level offered a row per professor and per group
   * with nothing valid to assign them to, and `detachAndDelete` demanded a
   * target for each of them before it would proceed.
   */
  async deleteImpact(type: HierarchyNodeType, id: string): Promise<DeleteImpact> {
    const impact: DeleteImpact = { level: 0, field: 0, professor: 0, group: 0, student: 0, directChildren: [] };

    const fieldIds: string[] = [];
    const professorIds: string[] = [];
    const groupIds: string[] = [];
    const studentIds: string[] = [];

    /** The layer directly beneath the node being deleted. */
    const isDirectChildLayer = (layer: HierarchyNodeType): boolean =>
      (type === "level" && layer === "field") ||
      (type === "field" && layer === "professor") ||
      (type === "professor" && layer === "group") ||
      (type === "group" && layer === "student");

    if (type === "level") {
      const rows = await this.db.client
        .select({ id: fields.id, name: fields.name })
        .from(fields)
        .where(eq(fields.level_id, id));
      fieldIds.push(...rows.map((r) => r.id));
      if (isDirectChildLayer("field")) {
        rows.forEach((r) => impact.directChildren.push({ id: r.id, name: r.name, type: "field" }));
      }
    } else if (type === "field") {
      fieldIds.push(id);
    }

    if (fieldIds.length > 0) {
      const rows = await this.db.client
        .select({ id: professors.id, full_name: professors.full_name })
        .from(professors)
        .where(inArray(professors.field_id, fieldIds));
      professorIds.push(...rows.map((r) => r.id));
      if (isDirectChildLayer("professor")) {
        rows.forEach((r) => impact.directChildren.push({ id: r.id, name: r.full_name, type: "professor" }));
      }
    }

    if (type === "professor") {
      professorIds.push(id);
    }

    if (professorIds.length > 0) {
      const rows = await this.db.client
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(inArray(groups.prof_id, professorIds));
      groupIds.push(...rows.map((r) => r.id));
      if (isDirectChildLayer("group")) {
        rows.forEach((r) => impact.directChildren.push({ id: r.id, name: r.name, type: "group" }));
      }
    }

    if (type === "group") {
      groupIds.push(id);
    }

    if (groupIds.length > 0) {
      const allRows = await this.db.client
        .select({ id: students.id, first_name: students.first_name, last_name: students.last_name })
        .from(students)
        .innerJoin(studentAssignments, and(eq(studentAssignments.student_id, students.id), inArray(studentAssignments.group_id, groupIds)));
      studentIds.push(...allRows.map((r) => r.id));
      if (isDirectChildLayer("student")) {
        allRows.forEach((r) => impact.directChildren.push({ id: r.id, name: `${r.first_name} ${r.last_name}`, type: "student" }));
      }
    }

    impact.level = type === "level" ? 1 : fieldIds.length;
    impact.field = type === "field" ? 1 : fieldIds.length;
    impact.professor = type === "professor" ? 1 : professorIds.length;
    impact.group = type === "group" ? 1 : groupIds.length;
    impact.student = studentIds.length;

    return impact;
  }

  /* ------------------------------------------------------------------ */
  /*  1. Archive cascade                                                 */
  /* ------------------------------------------------------------------ */

  async archiveCascade(type: HierarchyNodeType, id: string, userId?: string): Promise<ArchiveCascadeResult> {
    const row = await this.assertActive(type, id);
    const impact = await this.deleteImpact(type, id);

    await this.db.client.transaction(async (tx) => {
      const now = new Date();

      // Archive target
      switch (type) {
        case "level":
          await tx.update(levels).set({ is_active: false, archived_at: now }).where(eq(levels.id, id));
          break;
        case "field":
          await tx.update(fields).set({ is_active: false, archived_at: now }).where(eq(fields.id, id));
          break;
        case "professor":
          await tx.update(professors).set({ is_active: false, archived_at: now }).where(eq(professors.id, id));
          break;
        case "group":
          await tx.update(groups).set({ is_active: false, archived_at: now }).where(eq(groups.id, id));
          break;
      }

      // Cascade archive descendants
      const fieldIds =
        type === "level"
          ? (await tx.select({ id: fields.id }).from(fields).where(eq(fields.level_id, id))).map((f) => f.id)
          : type === "field"
            ? [id]
            : [];

      if (fieldIds.length > 0) {
        await tx.update(fields).set({ is_active: false, archived_at: now, archived_because_parent_id: id }).where(inArray(fields.id, fieldIds));
      }

      const professorIds =
        fieldIds.length > 0
          ? (await tx.select({ id: professors.id }).from(professors).where(inArray(professors.field_id, fieldIds))).map((p) => p.id)
          : type === "professor"
            ? [id]
            : [];

      if (professorIds.length > 0) {
        await tx.update(professors).set({ is_active: false, archived_at: now, archived_because_parent_id: type === "field" ? id : null }).where(inArray(professors.id, professorIds));
      }

      const groupIds =
        professorIds.length > 0
          ? (await tx.select({ id: groups.id }).from(groups).where(inArray(groups.prof_id, professorIds))).map((g) => g.id)
          : type === "group"
            ? [id]
            : [];

      if (groupIds.length > 0) {
        await tx.update(groups).set({ is_active: false, archived_at: now, archived_because_parent_id: type === "professor" ? id : null }).where(inArray(groups.id, groupIds));
      }

      // Students: archive via student_assignments join, not direct group_id
      if (groupIds.length > 0) {
        const studentRows = await tx
          .select({ id: students.id })
          .from(students)
          .innerJoin(studentAssignments, and(eq(studentAssignments.student_id, students.id), inArray(studentAssignments.group_id, groupIds)));
        const sids = studentRows.map((s) => s.id);
        if (sids.length > 0) {
          await tx.update(students).set({ archived_at: now, archived_because_parent_id: type === "group" ? id : null }).where(inArray(students.id, sids));
        }
      }
    });

    await this.audit.record({
      action: `${type}.archive_cascade`,
      entityType: type,
      entityId: id,
      entityLabel: this.entityLabel(type, row),
      actorId: userId,
      meta: { affected: impact },
    });

    return { affected: impact };
  }

  /* ------------------------------------------------------------------ */
  /*  2. Delete cascade (permanent)                                     */
  /* ------------------------------------------------------------------ */

  async deleteCascade(type: HierarchyNodeType, id: string, userId?: string): Promise<{ purged: DeleteImpact }> {
    const row = await this.assertActive(type, id);
    const impact = await this.deleteImpact(type, id);

    await this.db.client.transaction(async (tx) => {
      const fieldIds =
        type === "level"
          ? (await tx.select({ id: fields.id }).from(fields).where(eq(fields.level_id, id))).map((f) => f.id)
          : type === "field"
            ? [id]
            : [];

      const professorIds =
        fieldIds.length > 0
          ? (await tx.select({ id: professors.id }).from(professors).where(inArray(professors.field_id, fieldIds))).map((p) => p.id)
          : type === "professor"
            ? [id]
            : [];

      const groupIds =
        professorIds.length > 0
          ? (await tx.select({ id: groups.id }).from(groups).where(inArray(groups.prof_id, professorIds))).map((g) => g.id)
          : type === "group"
            ? [id]
            : [];

      const studentIds =
        groupIds.length > 0
          ? (await tx.select({ id: students.id }).from(students).innerJoin(studentAssignments, and(eq(studentAssignments.student_id, students.id), inArray(studentAssignments.group_id, groupIds)))).map((s) => s.id)
          : [];

      // Bottom-up: students & payments first
      if (studentIds.length > 0) {
        const paymentIds = (await tx.select({ id: studentPayments.id }).from(studentPayments).where(inArray(studentPayments.student_id, studentIds))).map((p) => p.id);
        if (paymentIds.length > 0) {
          await tx.delete(paymentTransactions).where(inArray(paymentTransactions.payment_id, paymentIds));
        }
        await tx.delete(studentPayments).where(inArray(studentPayments.student_id, studentIds));
        await tx.delete(studentScheduleExceptions).where(inArray(studentScheduleExceptions.student_id, studentIds));
        await tx.delete(students).where(inArray(students.id, studentIds));
      }

      if (groupIds.length > 0) {
        await tx.delete(studentPayments).where(inArray(studentPayments.group_id, groupIds));
        await tx.delete(scheduleEntries).where(inArray(scheduleEntries.group_id, groupIds));
        await tx.delete(groups).where(inArray(groups.id, groupIds));
      }

      if (professorIds.length > 0) {
        await tx.delete(paymentTransactions).where(inArray(paymentTransactions.prof_id, professorIds));
        await tx.delete(professors).where(inArray(professors.id, professorIds));
      }

      if (fieldIds.length > 0) {
        await tx.delete(fields).where(inArray(fields.id, fieldIds));
      }

      switch (type) {
        case "level":
          await tx.delete(levels).where(eq(levels.id, id));
          break;
        case "field":
          await tx.delete(fields).where(eq(fields.id, id));
          break;
        case "professor":
          await tx.delete(professors).where(eq(professors.id, id));
          break;
        case "group":
          await tx.delete(groups).where(eq(groups.id, id));
          break;
      }
    });

    await this.audit.record({
      action: `${type}.delete_cascade`,
      entityType: type,
      entityId: id,
      entityLabel: this.entityLabel(type, row),
      actorId: userId,
      meta: { purged: impact },
    });

    return { purged: impact };
  }

  /* ------------------------------------------------------------------ */
  /*  3. Detach children + delete/archive parent                         */
  /* ------------------------------------------------------------------ */

  // Returns the reassignment target for a child. Every child must have a
  // target — there is no "leave unassigned" holding pen anymore.
  private resolveTarget(plan: DetachPlan, childId: string): string | undefined {
    if (plan.mode === "reassign") return plan.targetParentId;
    if (plan.mode === "reassign_individual") {
      return plan.assignments?.find((a) => a.childId === childId)?.targetParentId || undefined;
    }
    return undefined;
  }

  /**
   * Buckets children by the parent they are moving to.
   *
   * A detach usually sends every child to the same place — "reassign" has one
   * target by definition — so resolving the plan per child and then issuing a
   * validation and an update for each of them repeats the same two queries
   * once per row. Grouping first turns that into one validation and one
   * statement per distinct destination.
   */
  private groupByTarget(plan: DetachPlan, childIds: string[]) {
    const reassigned = new Map<string, string[]>();
    const missingTarget: string[] = [];

    for (const childId of childIds) {
      const targetId = this.resolveTarget(plan, childId);
      if (!targetId) {
        missingTarget.push(childId);
        continue;
      }
      const bucket = reassigned.get(targetId) ?? [];
      bucket.push(childId);
      reassigned.set(targetId, bucket);
    }

    if (missingTarget.length > 0) {
      throw new BadRequestException(
        `Reassignment required for ${missingTarget.length} child(ren) — create a target first, or archive/delete everything together.`,
      );
    }

    return { reassigned };
  }

  // Re-point one group enrollment (student_assignments) and, when the old group
  // was the student's primary group, the students.group_id pointer as well.
  private async moveStudent(tx: any, studentId: string, fromGroupId: string, targetGroupId: string) {
    await tx.delete(studentAssignments).where(and(eq(studentAssignments.student_id, studentId), eq(studentAssignments.group_id, fromGroupId)));
    await tx.update(students).set({ group_id: targetGroupId }).where(and(eq(students.id, studentId), eq(students.group_id, fromGroupId)));
    await tx.insert(studentAssignments).values({ student_id: studentId, group_id: targetGroupId }).onConflictDoNothing();
  }

  /**
   * "Delete this only": archive the node and re-point the layer beneath it.
   *
   * A level used to be refused here on the grounds that it "has no parent".
   * That is true of the level itself and irrelevant to this operation — what
   * moves is its *children*, and a field can be re-pointed to any other level
   * exactly as a professor can be re-pointed to another field. The refusal made
   * the option unusable from the UI, which offered it anyway and then failed
   * with a 400 after the operator had filled the form in.
   */
  async detachAndDelete(type: HierarchyNodeType, id: string, plan: DetachPlan, userId?: string): Promise<ArchiveCascadeResult> {
    const parent = await this.assertActive(type, id);
    const impact = await this.deleteImpact(type, id);

    if (plan.mode === "reassign_individual") {
      const childIds = impact.directChildren.map((c) => c.id);
      const assignedIds = (plan.assignments ?? []).map((a) => a.childId);
      const missing = childIds.filter((cid) => !assignedIds.includes(cid));
      if (missing.length > 0) {
        throw new BadRequestException(`Reassignment plan missing targets for ${missing.length} children`);
      }
    }

    await this.db.client.transaction(async (tx) => {
      switch (type) {
        case "level": {
          const childIds = (await tx.select({ id: fields.id }).from(fields).where(inArray(fields.level_id, [id]))).map((f) => f.id);

          // Any other active level is a valid destination. There is no
          // same-parent constraint to check as there is one layer down: levels
          // are the root, so the only thing to reject is the level being
          // deleted and one that is not active.
          const moves = this.groupByTarget(plan, childIds);
          for (const [targetId, ids] of moves.reassigned) {
            if (targetId === id) throw new BadRequestException("A field cannot be reassigned to the level being deleted");
            const valid = await tx.select({ id: levels.id }).from(levels).where(and(eq(levels.id, targetId), eq(levels.is_active, true)));
            if (!valid[0]) throw new BadRequestException("Invalid reassignment target for a field");
            await tx.update(fields).set({ level_id: targetId }).where(inArray(fields.id, ids));
          }
          break;
        }
        case "field": {
          const childIds = (await tx.select({ id: professors.id }).from(professors).where(inArray(professors.field_id, [id]))).map((p) => p.id);

          // Children are grouped by where they are going, so each destination
          // is validated once and moved in one statement. Validating and
          // updating per child meant two round trips each — detaching a field
          // with forty professors was eighty.
          const moves = this.groupByTarget(plan, childIds);
          for (const [targetId, ids] of moves.reassigned) {
            const valid = await tx.select({ id: fields.id }).from(fields).where(and(eq(fields.id, targetId), eq(fields.is_active, true), eq(fields.level_id, parent.level_id)));
            if (!valid[0]) throw new BadRequestException("Invalid reassignment target for a professor");
            await tx.update(professors).set({ field_id: targetId }).where(inArray(professors.id, ids));
          }
          break;
        }
        case "professor": {
          const childIds = (await tx.select({ id: groups.id }).from(groups).where(inArray(groups.prof_id, [id]))).map((g) => g.id);

          const moves = this.groupByTarget(plan, childIds);
          for (const [targetId, ids] of moves.reassigned) {
            const valid = await tx.select({ id: professors.id }).from(professors).where(and(eq(professors.id, targetId), eq(professors.is_active, true), eq(professors.field_id, parent.field_id)));
            if (!valid[0]) throw new BadRequestException("Invalid reassignment target for a group");
            await tx.update(groups).set({ prof_id: targetId }).where(inArray(groups.id, ids));
          }
          break;
        }
        case "group": {
          const childIds = (
            await tx
              .select({ id: students.id })
              .from(students)
              .innerJoin(studentAssignments, and(eq(studentAssignments.student_id, students.id), eq(studentAssignments.group_id, id)))
          ).map((s) => s.id);
          for (const childId of childIds) {
            const targetId = this.resolveTarget(plan, childId);
            if (!targetId) {
              throw new BadRequestException(
                "Reassignment required for every student — create a target group first, or archive/delete everything together.",
              );
            }
            const valid = await tx.select().from(groups).where(and(eq(groups.id, targetId), eq(groups.is_active, true), eq(groups.prof_id, parent.prof_id)));
            if (!valid[0]) throw new BadRequestException("Invalid reassignment target for a student");
            await this.moveStudent(tx, childId, id, targetId);
          }
          break;
        }
      }

      const now = new Date();
      switch (type) {
        case "level":
          await tx.update(levels).set({ is_active: false, archived_at: now }).where(eq(levels.id, id));
          break;
        case "field":
          await tx.update(fields).set({ is_active: false, archived_at: now }).where(eq(fields.id, id));
          break;
        case "professor":
          await tx.update(professors).set({ is_active: false, archived_at: now }).where(eq(professors.id, id));
          break;
        case "group":
          await tx.update(groups).set({ is_active: false, archived_at: now }).where(eq(groups.id, id));
          break;
      }
    });

    await this.audit.record({
      action: `${type}.detach_delete`,
      entityType: type,
      entityId: id,
      entityLabel: this.entityLabel(type, parent),
      actorId: userId,
      meta: { plan, affected: impact },
    });

    return { affected: impact };
  }
}
