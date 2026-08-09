import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateHierarchyConfigDto, UpdateHierarchyConfigDto } from "./dto/hierarchy-config.dto";
import { Prisma } from "@prisma/client";

const VALID_ENTITIES = ["level", "field", "professor", "group", "student"] as const;
const MANDATORY_ENTITIES = ["student"] as const;
const DEFAULT_ENTITY_ORDER = ["level", "field", "professor", "group", "student"] as const;

@Injectable()
export class HierarchyConfigService implements OnModuleInit {
  private readonly logger = new Logger(HierarchyConfigService.name);
  private cachedActive: any = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The app depends on an active configuration; make sure one always exists. */
  async onModuleInit() {
    await this.ensureDefault();
  }

  private async ensureDefault(): Promise<void> {
    const existing = await this.prisma.hierarchy_configurations.findFirst({
      where: { isDefault: true },
    });

    if (existing) {
      if (!existing.isActive) {
        await this.prisma.$transaction([
          this.prisma.hierarchy_configurations.updateMany({
            where: { isActive: true },
            data: { isActive: false },
          }),
          this.prisma.hierarchy_configurations.update({
            where: { id: existing.id },
            data: { isActive: true },
          }),
        ]);
        this.cachedActive = { ...existing, isActive: true };
      } else {
        this.cachedActive = existing;
      }
      return;
    }

    const created = await this.prisma.hierarchy_configurations.create({
      data: {
        name: "Default Hierarchy",
        entityOrder: DEFAULT_ENTITY_ORDER as unknown as Prisma.InputJsonValue,
        isDefault: true,
        isActive: true,
      },
    });
    this.cachedActive = created;
    this.logger.log(`Created and activated default hierarchy configuration "${created.name}"`);
  }

  async findAll() {
    return this.prisma.hierarchy_configurations.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    });
  }

  async findActive() {
    if (this.cachedActive) return this.cachedActive;

    const active = await this.prisma.hierarchy_configurations.findFirst({
      where: { isActive: true },
    });

    if (!active) {
      throw new NotFoundException("No active hierarchy configuration found");
    }

    this.cachedActive = active;
    return active;
  }

  async findOne(id: string) {
    const config = await this.prisma.hierarchy_configurations.findUnique({
      where: { id },
    });
    if (!config) throw new NotFoundException("Hierarchy configuration not found");
    return config;
  }

  async create(dto: CreateHierarchyConfigDto, userId: string) {
    this.validateEntityOrder(dto.entityOrder);

    const config = await this.prisma.hierarchy_configurations.create({
      data: {
        name: dto.name,
        entityOrder: dto.entityOrder as unknown as Prisma.InputJsonValue,
        isDefault: false,
        isActive: false,
      },
    });

    this.logger.log(`Created hierarchy config "${config.name}" by user ${userId}`);
    return config;
  }

  async update(id: string, dto: UpdateHierarchyConfigDto, userId: string) {
    const existing = await this.findOne(id);

    if (dto.entityOrder) {
      this.validateEntityOrder(dto.entityOrder);
    }

    const updated = await this.prisma.hierarchy_configurations.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        entityOrder: (dto.entityOrder ?? existing.entityOrder) as unknown as Prisma.InputJsonValue,
      },
    });

    if (this.cachedActive?.id === id) {
      this.cachedActive = updated;
    }

    this.logger.log(`Updated hierarchy config "${updated.name}" by user ${userId}`);
    return updated;
  }

  async activate(id: string, userId: string) {
    const config = await this.findOne(id);

    await this.prisma.$transaction([
      this.prisma.hierarchy_configurations.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      }),
      this.prisma.hierarchy_configurations.update({
        where: { id },
        data: { isActive: true },
      }),
    ]);

    const activated = { ...config, isActive: true };
    this.cachedActive = activated;

    this.logger.log(`Activated hierarchy config "${config.name}" by user ${userId}`);
    return activated;
  }

  async remove(id: string, userId: string): Promise<void> {
    const config = await this.findOne(id);

    if (config.isDefault) {
      throw new BadRequestException("Cannot delete the default hierarchy configuration");
    }

    if (config.isActive) {
      throw new BadRequestException("Cannot delete the active hierarchy configuration. Activate another one first.");
    }

    await this.prisma.hierarchy_configurations.delete({ where: { id } });
    this.logger.log(`Deleted hierarchy config "${config.name}" by user ${userId}`);
  }

  async resetToDefault(userId: string) {
    const defaultConfig = await this.prisma.hierarchy_configurations.findFirst({
      where: { isDefault: true },
    });

    if (!defaultConfig) {
      throw new NotFoundException("Default hierarchy configuration not found");
    }

    return this.activate(defaultConfig.id, userId);
  }

  private validateEntityOrder(entityOrder: string[]): void {
    const validSet = new Set(VALID_ENTITIES);
    const seen = new Set<string>();

    for (const entity of entityOrder) {
      if (!validSet.has(entity as (typeof VALID_ENTITIES)[number])) {
        throw new BadRequestException(`Invalid entity: "${entity}". Valid entities: ${VALID_ENTITIES.join(", ")}`);
      }
      if (seen.has(entity)) {
        throw new BadRequestException(`Duplicate entity: "${entity}"`);
      }
      seen.add(entity);
    }

    for (const mandatory of MANDATORY_ENTITIES) {
      if (!seen.has(mandatory)) {
        throw new BadRequestException(`Mandatory entity "${mandatory}" must be included in the hierarchy`);
      }
    }
  }
}
