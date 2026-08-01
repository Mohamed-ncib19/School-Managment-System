import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";

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
      throw new BadRequestException(`Invalid date: ${value}`);
    }
    return parsed;
  }

  /** Parent chain each student row carries for display. */
  private static readonly HIERARCHY_INCLUDE = {
    group: {
      include: {
        level: {
          include: {
            professor: {
              include: { field: true },
            },
          },
        },
      },
    },
  } as const;

  /**
   * Returns a bare array when no `page` is supplied, so existing callers keep
   * working, and a paginated envelope when it is.
   *
   * Unpaginated, this endpoint serialises every student together with their
   * whole parent chain - 384 KB and ~1.6 s for 324 students, and growing
   * linearly with enrolment. Callers that only need counts should use
   * /hierarchy/summary, which aggregates in SQL instead.
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
    if (groupId) where.group_id = groupId;
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
        include: StudentsService.HIERARCHY_INCLUDE,
        orderBy: { created_at: "desc" },
      });
    }

    const take = Math.min(Math.max(1, limit), 200);
    const [data, total] = await Promise.all([
      this.prisma.students.findMany({
        where,
        include: StudentsService.HIERARCHY_INCLUDE,
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
      include: { ...StudentsService.HIERARCHY_INCLUDE, payments: true },
    });
    if (!student) throw new NotFoundException(`Student ${id} not found`);
    return student;
  }

  async createStudent(dto: {
    group_id: string;
    first_name: string;
    last_name: string;
    phone: string;
    parent_phone?: string;
    email?: string;
    enrollment_date: Date | string;
    monthly_fee: number;
  }, userId: string) {
    const enrollmentDate = this.parseDate(dto.enrollment_date);
    const student = await this.prisma.students.create({
      data: {
        group_id: dto.group_id,
        first_name: dto.first_name,
        last_name: dto.last_name,
        phone: dto.phone,
        parent_phone: dto.parent_phone,
        email: dto.email,
        enrollment_date: enrollmentDate,
        monthly_fee: dto.monthly_fee,
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
    enrollment_date?: Date | string;
    monthly_fee?: number;
    status?: string;
  }, userId: string) {
    const before = await this.getStudent(id);
    const data: any = {};
    if (dto.first_name !== undefined) data.first_name = dto.first_name;
    if (dto.last_name !== undefined) data.last_name = dto.last_name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.parent_phone !== undefined) data.parent_phone = dto.parent_phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.enrollment_date !== undefined) data.enrollment_date = this.parseDate(dto.enrollment_date);
    if (dto.monthly_fee !== undefined) data.monthly_fee = dto.monthly_fee;
    if (dto.status !== undefined) data.status = dto.status;

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
    if (!student) throw new NotFoundException(`Student ${studentId} not found`);

    if (student.group_id === targetGroupId) {
      throw new BadRequestException("Student is already in this group");
    }

    const targetGroup = await this.prisma.groups.findUnique({
      where: { id: targetGroupId },
      select: { id: true, is_active: true },
    });
    if (!targetGroup || !targetGroup.is_active) {
      throw new NotFoundException(`Target group ${targetGroupId} not found`);
    }

    const updated = await this.prisma.students.update({
      where: { id: studentId },
      data: { group_id: targetGroupId },
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
   */
  async deleteStudent(studentId: string, userId: string) {
    const student = await this.getStudent(studentId);

    const settled = await this.prisma.student_payments.count({
      where: { student_id: studentId, status: "paid" },
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
    if (!student) throw new NotFoundException(`Student ${studentId} not found`);
    return this.prisma.student_payments.findMany({
      where: { student_id: studentId },
      orderBy: { period: "desc" },
    });
  }
}
