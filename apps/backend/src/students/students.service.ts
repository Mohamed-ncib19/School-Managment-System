import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, like, or, sql, SQL } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { groups, paymentTransactions, studentAssignments, studentPayments, students } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { normalizeTunisianPhone } from "../common/phone.util";
import { PaymentService } from "../financial/payment.service";

/** Parent chain each student row carries for display: group -> professor -> field -> level. */
const GROUP_CHAIN_WITH = {
  group: {
    with: {
      professor: {
        with: {
          field: {
            with: { level: true },
          },
        },
      },
    },
  },
} as const;

/** The same enrollments, restricted to the fields the student rows render. */
const ASSIGNMENTS_LITE_WITH = {
  assignments: {
    with: {
      group: {
        columns: { id: true, name: true },
        with: {
          professor: {
            columns: { id: true, full_name: true },
            with: {
              field: {
                columns: { id: true, name: true },
                with: {
                  level: { columns: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [asc(studentAssignments.created_at)] as SQL[],
  },
} as const;

const ASSIGNMENTS_WITH = {
  assignments: {
    with: {
      group: {
        with: {
          professor: {
            with: {
              field: {
                with: { level: true },
              },
            },
          },
        },
      },
    },
    orderBy: [asc(studentAssignments.created_at)] as SQL[],
  },
} as const;

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly db: DbService,
    private readonly auditService: AuditService,
    private readonly paymentService: PaymentService,
  ) {}

  private parseDate(value: Date | string): Date {
    if (value instanceof Date) return value;
    const trimmed = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day));
    }
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException(`Date invalide : ${value}`);
    }
    return parsed;
  }

  /**
   * Normalises the three payload shapes the create/update endpoints accept
   * into a list of enrollments: rich `assignments` (with per-slot fee), plain
   * `group_ids`, or the legacy singular `group_id`. Throws when nothing is
   * usable, and dedupes so the same group cannot be enrolled twice.
   */
  private resolveEnrollments(dto: {
    group_id?: string;
    group_ids?: string[];
    assignments?: Array<{ group_id: string; fee?: number }>;
  }): Array<{ group_id: string; fee?: number }> {
    const provided = dto.assignments?.length
      ? dto.assignments
      : dto.group_ids?.length
        ? dto.group_ids.map((group_id) => ({ group_id }))
        : dto.group_id
          ? [{ group_id: dto.group_id }]
          : [];
    if (provided.length === 0) {
      throw new BadRequestException("Un étudiant doit être assigné à au moins un groupe");
    }
    const seen = new Set<string>();
    return provided.filter((a) => {
      if (!a.group_id || seen.has(a.group_id)) return false;
      seen.add(a.group_id);
      return true;
    });
  }

  private async buildWhere(params: { groupId?: string; status?: string; search?: string }): Promise<ReturnType<typeof and>> {
    const clauses: ReturnType<typeof eq>[] = [];

    if (params.groupId) {
      const ids = (
        await this.db.client
          .select({ student_id: studentAssignments.student_id })
          .from(studentAssignments)
          .where(eq(studentAssignments.group_id, params.groupId))
      ).map((r) => r.student_id);
      clauses.push(inArray(students.id, ids));
    }
    if (params.status) clauses.push(eq(students.status, params.status as any));
    if (params.search?.trim()) {
      const term = params.search.trim();
      clauses.push(
        or(
          ilike(students.first_name, `%${term}%`),
          ilike(students.last_name, `%${term}%`),
          like(students.phone, `%${term}%`),
          like(students.parent_phone, `%${term}%`),
          ilike(students.email, `%${term}%`),
        )!,
      );
    }

    return clauses.length > 0 ? and(...clauses) : undefined;
  }

  /**
   * Returns a bare array when no `page` is supplied, so existing callers keep
   * working, and a paginated envelope when it is.
   */
  async listStudents(params: {
    groupId?: string;
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  } = {}) {
    const { groupId, page, limit = 25, search, status } = params;

    if (!page) {
      return this.db.client.query.students.findMany({
        where: await this.buildWhere({ groupId, status, search }),
        with: { ...GROUP_CHAIN_WITH, ...ASSIGNMENTS_LITE_WITH },
        orderBy: [desc(students.created_at)],
      });
    }

    const take = Math.min(Math.max(1, limit), 200);
    const where = await this.buildWhere({ groupId, status, search });
    const [data, [countRow]] = await Promise.all([
      this.db.client.query.students.findMany({
        where,
        with: { ...GROUP_CHAIN_WITH, ...ASSIGNMENTS_WITH },
        orderBy: [desc(students.created_at)],
        offset: (Math.max(1, page) - 1) * take,
        limit: take,
      }),
      this.db.client.select({ count: sql<number>`count(*)::int` }).from(students).where(where),
    ]);
    const total = countRow.count;

    return {
      data,
      meta: { total, page: Math.max(1, page), limit: take, totalPages: Math.max(1, Math.ceil(total / take)) },
    };
  }

  /** Recent students for dashboard widgets - minimal payload. */
  async recentStudents(limit = 5) {
    const take = Math.min(Math.max(1, limit), 20);
    return this.db.client.query.students.findMany({
      limit: take,
      orderBy: [desc(students.enrollment_date)],
      columns: {
        id: true,
        first_name: true,
        last_name: true,
        enrollment_date: true,
        monthly_fee: true,
        status: true,
      },
      with: {
        group: {
          columns: { id: true, name: true, color: true },
          with: {
            professor: {
              columns: { id: true, full_name: true, color: true },
              with: {
                field: {
                  columns: { id: true, name: true, color: true },
                  with: {
                    level: { columns: { id: true, name: true, color: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Includes the full parent chain, not just the group.
   */
  async getStudent(id: string) {
    const student = await this.db.client.query.students.findFirst({
      where: eq(students.id, id),
      with: {
        ...GROUP_CHAIN_WITH,
        ...ASSIGNMENTS_WITH,
        studentPayments: true,
      },
    });
    if (!student) throw new NotFoundException(`Étudiant ${id} introuvable`);
    return student;
  }

  async createStudent(dto: {
    group_id?: string;
    group_ids?: string[];
    assignments?: Array<{ group_id: string; fee?: number }>;
    first_name: string;
    last_name: string;
    phone: string;
    parent_phone?: string;
    email?: string;
    color?: string;
    enrollment_date: Date | string;
    monthly_fee: number;
  }, userId: string) {
    const phone = normalizeTunisianPhone(dto.phone);
    if (!phone) throw new BadRequestException("Le téléphone de l'étudiant doit comprendre 8 chiffres, ex. +216 22 123 456");
    const parentPhone = dto.parent_phone
      ? normalizeTunisianPhone(dto.parent_phone)
      : undefined;
    if (dto.parent_phone && !parentPhone) {
      throw new BadRequestException("Le téléphone du parent doit comprendre 8 chiffres, ex. +216 22 123 456");
    }
    const enrollments = this.resolveEnrollments(dto);
    const enrollmentDate = this.parseDate(dto.enrollment_date);

    const student = await this.db.client.transaction(async (tx) => {
      const [created] = await tx
        .insert(students)
        .values({
          group_id: enrollments[0].group_id,
          first_name: dto.first_name,
          last_name: dto.last_name,
          phone,
          parent_phone: parentPhone ?? null,
          email: dto.email ?? null,
          color: dto.color ?? null,
          enrollment_date: enrollmentDate,
          monthly_fee: String(dto.monthly_fee),
        })
        .returning();
      for (const { group_id, fee } of enrollments) {
        await tx.insert(studentAssignments).values({
          student_id: created.id,
          group_id,
          fee: String(fee ?? dto.monthly_fee),
        });
      }
      return created;
    });

    const group = await this.db.client.query.groups.findFirst({ where: eq(groups.id, student.group_id) });

    await this.auditService.record({
      action: "student.created",
      entityType: "student",
      entityId: student.id,
      entityLabel: `${student.first_name} ${student.last_name}`,
      actorId: userId,
      newValues: {
        first_name: student.first_name,
        last_name: student.last_name,
        phone: student.phone,
        parent_phone: student.parent_phone,
        email: student.email,
        color: student.color,
        group_id: student.group_id,
        monthly_fee: student.monthly_fee,
        enrollment_date: student.enrollment_date,
        status: student.status,
      },
    });
    // La génération des factures doit lire l'étudiant committé : elle a lieu
    // hors transaction. Chaque inscription (groupe) produit une facture par
    // mois depuis le mois d'inscription ; un échec ici ne casse pas la création
    // — il reste traçable à l'audit et rattrapable via la génération manuelle.
    try {
      await this.paymentService.generateForStudent(student.id);
    } catch (err) {
      this.logger.warn(
        `Factures non générées pour l'étudiant ${student.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.auditService.record({
        action: "student.payments_generation_failed",
        entityType: "student",
        entityId: student.id,
        entityLabel: `${student.first_name} ${student.last_name}`,
        actorId: userId,
      });
    }

    return { ...student, group };
  }

  async updateStudent(id: string, dto: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    parent_phone?: string;
    email?: string;
    color?: string;
    enrollment_date?: Date | string;
    monthly_fee?: number;
    status?: string;
    group_ids?: string[];
    assignments?: Array<{ group_id: string; fee?: number }>;
  }, userId: string) {
    const before = await this.getStudent(id);
    const data: any = {};
    if (dto.first_name !== undefined) data.first_name = dto.first_name;
    if (dto.last_name !== undefined) data.last_name = dto.last_name;
    if (dto.phone !== undefined) {
      const phone = normalizeTunisianPhone(dto.phone);
      if (!phone) throw new BadRequestException("Le téléphone de l'étudiant doit comprendre 8 chiffres, ex. +216 22 123 456");
      data.phone = phone;
    }
    if (dto.parent_phone !== undefined) {
      const parentPhone = dto.parent_phone ? normalizeTunisianPhone(dto.parent_phone) : null;
      if (dto.parent_phone && !parentPhone) {
        throw new BadRequestException("Le téléphone du parent doit comprendre 8 chiffres, ex. +216 22 123 456");
      }
      data.parent_phone = parentPhone;
    }
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.enrollment_date !== undefined) data.enrollment_date = this.parseDate(dto.enrollment_date);
    if (dto.monthly_fee !== undefined) data.monthly_fee = String(dto.monthly_fee);
    if (dto.status !== undefined) data.status = dto.status;

    let enrollments: Array<{ group_id: string; fee?: number }> | null = null;
    if (dto.assignments !== undefined || dto.group_ids !== undefined) {
      enrollments = this.resolveEnrollments(dto);
      data.group_id = enrollments[0].group_id;
    }

    if (enrollments) {
      await this.db.client.transaction(async (tx) => {
        await tx.delete(studentAssignments).where(eq(studentAssignments.student_id, id));
        for (const { group_id, fee } of enrollments) {
          await tx.insert(studentAssignments).values({
            student_id: id,
            group_id,
            fee: String(fee ?? dto.monthly_fee ?? before.monthly_fee),
          });
        }
      });
    }

    const [updated] = await this.db.client
      .update(students)
      .set(data)
      .where(eq(students.id, id))
      .returning();

    const { prevValues, newValues, changed } = changedFields(before, data);
    // A status change is a distinct administrative event and is filed as one so
    // it can be found without digging through generic edits.
    const isStatusChange = changed.includes("status");
    await this.auditService.record({
      action: isStatusChange ? "student.status_changed" : "student.updated",
      entityType: "student",
      entityId: id,
      entityLabel: `${updated.first_name} ${updated.last_name}`,
      actorId: userId,
      prevValues,
      newValues,
      meta: { changed_fields: changed },
    });

    return updated;
  }

  async moveStudent(studentId: string, targetGroupId: string, userId: string) {
    const student = await this.db.client.query.students.findFirst({
      where: eq(students.id, studentId),
      columns: { id: true, group_id: true, first_name: true, last_name: true },
    });
    if (!student) throw new NotFoundException(`Étudiant ${studentId} introuvable`);

    if (student.group_id === targetGroupId) {
      throw new BadRequestException("L'étudiant est déjà dans ce groupe");
    }

    const targetGroup = await this.db.client.query.groups.findFirst({
      where: eq(groups.id, targetGroupId),
      columns: { id: true, is_active: true },
    });
    if (!targetGroup || !targetGroup.is_active) {
      throw new NotFoundException(`Groupe cible ${targetGroupId} introuvable`);
    }

    const updated = await this.db.client.transaction(async (tx) => {
      const [moved] = await tx
        .update(students)
        .set({ group_id: targetGroupId })
        .where(eq(students.id, studentId))
        .returning();
      await tx.delete(studentAssignments).where(eq(studentAssignments.student_id, studentId));
      await tx.insert(studentAssignments).values({ student_id: studentId, group_id: targetGroupId });
      return moved;
    });

    await this.auditService.record({
      action: "student.moved_group",
      entityType: "student",
      entityId: studentId,
      entityLabel: `${student.first_name} ${student.last_name}`,
      actorId: userId,
      prevValues: { group_id: student.group_id },
      newValues: { group_id: targetGroupId },
    });

    return updated;
  }

  /**
   * `student_payments` holds a required FK to `students` with no cascade, so the
   * payment rows have to go first. Settled payments are financial records and
   * aren't thrown away: a student who has paid is retired by setting their
   * status to `withdrawn` instead. The test is whether the ledger holds anything
   * for them, not whether an invoice reads `paid`.
   */
  async deleteStudent(studentId: string, userId: string) {
    const student = await this.getStudent(studentId);

    const [settledRow] = await this.db.client
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentTransactions)
      .innerJoin(studentPayments, eq(paymentTransactions.payment_id, studentPayments.id))
      .where(eq(studentPayments.student_id, studentId));
    const settled = settledRow.count;
    if (settled > 0) {
      throw new BadRequestException(
        `${student.first_name} ${student.last_name} has ${settled} recorded payment(s) and cannot be deleted. ` +
          `Set their status to "withdrawn" instead to keep the payment history.`,
      );
    }

    await this.db.client.transaction(async (tx) => {
      await tx.delete(studentPayments).where(eq(studentPayments.student_id, studentId));
      await tx.delete(students).where(eq(students.id, studentId));
    });

    await this.auditService.record({
      action: "student.deleted",
      entityType: "student",
      entityId: studentId,
      entityLabel: `${student.first_name} ${student.last_name}`,
      actorId: userId,
      prevValues: {
        first_name: student.first_name,
        last_name: student.last_name,
        phone: student.phone,
        group_id: student.group_id,
        monthly_fee: student.monthly_fee,
        status: student.status,
      },
      meta: { discarded_unpaid_payments: student.studentPayments.length },
    });
  }

  async getStudentPayments(studentId: string) {
    const student = await this.db.client.query.students.findFirst({
      where: eq(students.id, studentId),
    });
    if (!student) throw new NotFoundException(`Étudiant ${studentId} introuvable`);
    return this.db.client.query.studentPayments.findMany({
      where: eq(studentPayments.student_id, studentId),
      orderBy: [desc(studentPayments.period)],
    });
  }
}
