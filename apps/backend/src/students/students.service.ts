import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { normalizeTunisianPhone } from "../common/phone.util";

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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

  /** Parent chain each student row carries for display: group -> professor -> field -> level. */
  private static readonly HIERARCHY_INCLUDE = {
    group: {
      include: {
        professor: {
          include: {
            field: {
              include: { level: true },
            },
          },
        },
      },
    },
  } as const;

  /** Lite version for unpaginated list - drops assignments to keep payload small. */
  private static readonly LITE_HIERARCHY_INCLUDE = {
    group: {
      include: {
        professor: {
          include: {
            field: {
              include: { level: true },
            },
          },
        },
      },
    },
  } as const;

  /**
   * Every enrollment of a student, with the same full chain as the primary
   * group. A student can be registered in several groups (different fields of
   * the same level, for example); `group_id` stays the primary for billing.
   */
  private static readonly ASSIGNMENTS_INCLUDE = {
    assignments: {
      include: {
        group: {
          include: {
            professor: {
              include: {
                field: {
                  include: { level: true },
                },
              },
            },
          },
        },
      },
      orderBy: { created_at: "asc" as const },
    },
  } as const;

  /**
   * The same enrollments, restricted to the fields the student rows render
   * (name + hierarchy chain, no fee rows or audit dates). Kept small so the
   * unpaginated list does not regrow into the multi-hundred-KB payload it used
   * to be while still showing every group a multi-enrolled student belongs to.
   */
  private static readonly ASSIGNMENTS_LITE_INCLUDE = {
    assignments: {
      include: {
        group: {
          select: {
            id: true,
            name: true,
            professor: {
              select: {
                id: true,
                full_name: true,
                field: {
                  select: {
                    id: true,
                    name: true,
                    level: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { created_at: "asc" as const },
    },
  } as const;

  /**
   * Returns a bare array when no `page` is supplied, so existing callers keep
   * working, and a paginated envelope when it is.
   *
   * Unpaginated, this endpoint used to serialise every student together with their
   * whole parent chain - 384 KB and ~1.6 s for 324 students. The lite payload
   * drops the assignments include and keeps only the hierarchy chain needed for
   * the students page's breadcrumb rendering. Callers that need full detail
   * should paginate or fetch each student individually.
   */
  async listStudents(params: {
    groupId?: string;
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  } = {}) {
    const { groupId, page, limit = 25, search, status } = params;

    const where: any = {};
    if (groupId) where.assignments = { some: { group_id: groupId } };
    if (status) where.status = status;
    if (search?.trim()) {
      const term = search.trim();
      where.OR = [
        { first_name: { contains: term, mode: "insensitive" } },
        { last_name: { contains: term, mode: "insensitive" } },
        { phone: { contains: term } },
        { parent_phone: { contains: term } },
        { email: { contains: term, mode: "insensitive" } },
      ];
    }

    if (!page) {
      return this.prisma.students.findMany({
        where,
        include: { ...StudentsService.LITE_HIERARCHY_INCLUDE, ...StudentsService.ASSIGNMENTS_LITE_INCLUDE },
        orderBy: { created_at: "desc" },
      });
    }

    const take = Math.min(Math.max(1, limit), 200);
    const [data, total] = await Promise.all([
      this.prisma.students.findMany({
        where,
        include: { ...StudentsService.HIERARCHY_INCLUDE, ...StudentsService.ASSIGNMENTS_INCLUDE },
        orderBy: { created_at: "desc" },
        skip: (Math.max(1, page) - 1) * take,
        take,
      }),
      this.prisma.students.count({ where }),
    ]);

    return {
      data,
      meta: { total, page: Math.max(1, page), limit: take, totalPages: Math.max(1, Math.ceil(total / take)) },
    };
  }

  /** Recent students for dashboard widgets - minimal payload. */
  async recentStudents(limit = 5) {
    const take = Math.min(Math.max(1, limit), 20);
    return this.prisma.students.findMany({
      take,
      orderBy: { enrollment_date: "desc" },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        enrollment_date: true,
        monthly_fee: true,
        status: true,
        group: {
          select: {
            id: true,
            name: true,
            color: true,
            professor: {
              select: {
                id: true,
                full_name: true,
                color: true,
                field: {
                  select: {
                    id: true,
                    name: true,
                    color: true,
                    level: {
                      select: { id: true, name: true, color: true },
                    },
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
   *
   * The detail modal reads `group.level.professor.field`, but this endpoint
   * only ever loaded `group`, so Specialty / Professor / Level rendered as "—"
   * while the group name resolved - the assignment card looked half-empty for
   * every student.
   */
  async getStudent(id: string) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      include: {
        ...StudentsService.HIERARCHY_INCLUDE,
        ...StudentsService.ASSIGNMENTS_INCLUDE,
        payments: true,
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
    const student = await this.prisma.students.create({
      data: {
        group_id: enrollments[0].group_id,
        first_name: dto.first_name,
        last_name: dto.last_name,
        phone,
        parent_phone: parentPhone,
        email: dto.email,
        color: dto.color,
        enrollment_date: enrollmentDate,
        monthly_fee: dto.monthly_fee,
        assignments: {
          create: enrollments.map(({ group_id, fee }) => ({
            group_id,
            fee: fee ?? dto.monthly_fee,
          })),
        },
      },
      include: { group: true },
    });
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
    return student;
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
    if (dto.monthly_fee !== undefined) data.monthly_fee = dto.monthly_fee;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.assignments !== undefined || dto.group_ids !== undefined) {
      const enrollments = this.resolveEnrollments(dto);
      data.group_id = enrollments[0].group_id;
      data.assignments = {
        deleteMany: {},
        create: enrollments.map(({ group_id, fee }) => ({
          group_id,
          fee: fee ?? dto.monthly_fee ?? before.monthly_fee,
        })),
      };
    }

    const updated = await this.prisma.students.update({ where: { id }, data });

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
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { id: true, group_id: true, first_name: true, last_name: true },
    });
    if (!student) throw new NotFoundException(`Étudiant ${studentId} introuvable`);

    if (student.group_id === targetGroupId) {
      throw new BadRequestException("L'étudiant est déjà dans ce groupe");
    }

    const targetGroup = await this.prisma.groups.findUnique({
      where: { id: targetGroupId },
      select: { id: true, is_active: true },
    });
    if (!targetGroup || !targetGroup.is_active) {
      throw new NotFoundException(`Groupe cible ${targetGroupId} introuvable`);
    }

    const updated = await this.prisma.students.update({
      where: { id: studentId },
      data: {
        group_id: targetGroupId,
        assignments: {
          deleteMany: {},
          create: [{ group_id: targetGroupId }],
        },
      },
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
   * payment rows have to go first — deleting the student outright raised a
   * foreign-key violation, and since the UI bills every student the moment it
   * creates them, that meant no student could ever be deleted.
   *
   * Settled payments are financial records and aren't thrown away: a student who
   * has paid is retired by setting their status to `withdrawn` instead.
   *
   * The test is whether the ledger holds anything for them, not whether an
   * invoice reads `paid`. A part-paid invoice sits at `partially_paid`, and
   * checking the status alone would let a student with money against their name
   * be deleted — taking the transactions with them through the cascade, and the
   * collection out of the academy's revenue.
   */
  async deleteStudent(studentId: string, userId: string) {
    const student = await this.getStudent(studentId);

    const settled = await this.prisma.payment_transactions.count({
      where: { payment: { student_id: studentId } },
    });
    if (settled > 0) {
      throw new BadRequestException(
        `${student.first_name} ${student.last_name} has ${settled} recorded payment(s) and cannot be deleted. ` +
          `Set their status to "withdrawn" instead to keep the payment history.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.student_payments.deleteMany({ where: { student_id: studentId } }),
      this.prisma.students.delete({ where: { id: studentId } }),
    ]);

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
      meta: { discarded_unpaid_payments: student.payments.length },
    });
  }

  async getStudentPayments(studentId: string) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException(`Étudiant ${studentId} introuvable`);
    return this.prisma.student_payments.findMany({
      where: { student_id: studentId },
      orderBy: { period: "desc" },
    });
  }
}
