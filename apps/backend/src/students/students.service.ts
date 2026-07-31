import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

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

  async listStudents(groupId?: string) {
    const where = groupId ? { group_id: groupId } : {};
    return this.prisma.students.findMany({
      where,
      include: {
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
      },
      orderBy: { created_at: "desc" },
    });
  }

  async getStudent(id: string) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      include: { group: true, payments: true },
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
    await this.auditService.createLog(userId, "student.created", "student", student.id, {
      first_name: student.first_name,
      last_name: student.last_name,
      group_id: student.group_id,
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
    await this.getStudent(id);
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

    await this.auditService.createLog(userId, "student.updated", "student", id, {
      updated_fields: Object.keys(dto),
      ...(dto.status && { status: dto.status }),
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

    await this.auditService.createLog(
      userId,
      "student.moved_group",
      "student",
      studentId,
      {
        from_group_id: student.group_id,
        to_group_id: targetGroupId,
        student_name: `${student.first_name} ${student.last_name}`,
      },
    );

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

    await this.auditService.createLog(userId, "student.deleted", "student", studentId, {
      student_name: `${student.first_name} ${student.last_name}`,
      group_id: student.group_id,
      discarded_unpaid_payments: student.payments.length,
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
