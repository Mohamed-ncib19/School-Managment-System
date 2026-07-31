import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    meta?: any,
  ) {
    return this.prisma.audit_logs.create({
      data: {
        actor_user_id: actorUserId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        meta: meta ? JSON.parse(JSON.stringify(meta)) : undefined,
      },
    });
  }

  async listLogs(params: {
    page: number;
    limit: number;
    entityType?: string;
    action?: string;
    actorUserId?: string;
  }) {
    const { page, limit, entityType, action, actorUserId } = params;
    const where: any = {};
    if (entityType) where.entity_type = entityType;
    if (action) where.action = { contains: action };
    if (actorUserId) where.actor_user_id = actorUserId;

    const [data, total] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where,
        include: { actor: { select: { id: true, full_name: true, email: true } } },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.audit_logs.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
