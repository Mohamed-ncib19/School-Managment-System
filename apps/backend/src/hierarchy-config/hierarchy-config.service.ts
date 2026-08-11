import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { hierarchyConfigurations } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { CreateHierarchyConfigDto, UpdateHierarchyConfigDto } from "./dto/hierarchy-config.dto";

const VALID_ENTITIES = ["level", "field", "professor", "group", "student"] as const;
const MANDATORY_ENTITIES = ["student"] as const;
const DEFAULT_ENTITY_ORDER = ["level", "field", "professor", "group", "student"] as const;

type HierarchyConfigRow = typeof hierarchyConfigurations.$inferSelect;

/** DB rows are snake_case; the API contract is camelCase. */
function toApi(row: HierarchyConfigRow) {
  return {
    id: row.id,
    name: row.name,
    entityOrder: row.entity_order as unknown as string[],
    isDefault: row.is_default,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class HierarchyConfigService implements OnModuleInit {
  private readonly logger = new Logger(HierarchyConfigService.name);
  private cachedActive: ReturnType<typeof toApi> | null = null;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** The app depends on an active configuration; make sure one always exists. */
  async onModuleInit() {
    await this.ensureDefault();
  }

  private async ensureDefault(): Promise<void> {
    const existing = (await this.db.client.select().from(hierarchyConfigurations).where(eq(hierarchyConfigurations.is_default, true)).limit(1))[0];

    if (existing) {
      if (!existing.is_active) {
        await this.db.client.transaction(async (tx) => {
          await tx.update(hierarchyConfigurations).set({ is_active: false }).where(eq(hierarchyConfigurations.is_active, true));
          await tx.update(hierarchyConfigurations).set({ is_active: true }).where(eq(hierarchyConfigurations.id, existing.id));
        });
        this.cachedActive = toApi({ ...existing, is_active: true });
      } else {
        this.cachedActive = toApi(existing);
      }
      return;
    }

    const [created] = await this.db.client
      .insert(hierarchyConfigurations)
      .values({
        name: "Default Hierarchy",
        entity_order: DEFAULT_ENTITY_ORDER as unknown,
        is_default: true,
        is_active: true,
        updated_at: new Date(),
      })
      .returning();
    this.cachedActive = toApi(created);
    this.logger.log(`Created and activated default hierarchy configuration "${created.name}"`);
  }

  async findAll() {
    const rows = await this.db.client
      .select()
      .from(hierarchyConfigurations)
      .orderBy(desc(hierarchyConfigurations.is_active), desc(hierarchyConfigurations.created_at));
    return rows.map(toApi);
  }

  async findActive() {
    if (this.cachedActive) return this.cachedActive;

    const active = (await this.db.client.select().from(hierarchyConfigurations).where(eq(hierarchyConfigurations.is_active, true)).limit(1))[0];

    if (!active) {
      throw new NotFoundException("Aucune configuration hiérarchique active trouvée");
    }

    this.cachedActive = toApi(active);
    return this.cachedActive;
  }

  async findOne(id: string) {
    const config = (await this.db.client.select().from(hierarchyConfigurations).where(eq(hierarchyConfigurations.id, id)).limit(1))[0];
    if (!config) throw new NotFoundException("Configuration hiérarchique introuvable");
    return toApi(config);
  }

  async create(dto: CreateHierarchyConfigDto, userId: string) {
    this.validateEntityOrder(dto.entityOrder);

    const [config] = await this.db.client
      .insert(hierarchyConfigurations)
      .values({
        name: dto.name,
        entity_order: dto.entityOrder as unknown,
        is_default: false,
        is_active: false,
        updated_at: new Date(),
      })
      .returning();

    this.logger.log(`Created hierarchy config "${config.name}" by user ${userId}`);
    return toApi(config);
  }

  async update(id: string, dto: UpdateHierarchyConfigDto, userId: string) {
    const existing = await this.findOne(id);

    if (dto.entityOrder) {
      this.validateEntityOrder(dto.entityOrder);
    }

    const [updated] = await this.db.client
      .update(hierarchyConfigurations)
      .set({
        name: dto.name ?? existing.name,
        entity_order: (dto.entityOrder ?? existing.entityOrder) as unknown,
      })
      .where(eq(hierarchyConfigurations.id, id))
      .returning();

    if (this.cachedActive?.id === id) {
      this.cachedActive = toApi(updated);
    }

    this.logger.log(`Updated hierarchy config "${updated.name}" by user ${userId}`);
    return toApi(updated);
  }

  async activate(id: string, userId: string) {
    const config = await this.findOne(id);

    await this.db.client.transaction(async (tx) => {
      await tx.update(hierarchyConfigurations).set({ is_active: false }).where(eq(hierarchyConfigurations.is_active, true));
      await tx.update(hierarchyConfigurations).set({ is_active: true }).where(eq(hierarchyConfigurations.id, id));
    });

    const activated = { ...config, isActive: true };
    this.cachedActive = activated;

    this.logger.log(`Activated hierarchy config "${config.name}" by user ${userId}`);
    return activated;
  }

  async remove(id: string, userId: string): Promise<void> {
    const config = await this.findOne(id);

    if (config.isDefault) {
      throw new BadRequestException("Impossible de supprimer la configuration hiérarchique par défaut");
    }

    if (config.isActive) {
      throw new BadRequestException("Impossible de supprimer la configuration hiérarchique active. Activez-en une autre d'abord.");
    }

    await this.db.client.delete(hierarchyConfigurations).where(eq(hierarchyConfigurations.id, id));
    this.logger.log(`Deleted hierarchy config "${config.name}" by user ${userId}`);
  }

  async resetToDefault(userId: string) {
    const defaultConfig = (await this.db.client.select().from(hierarchyConfigurations).where(eq(hierarchyConfigurations.is_default, true)).limit(1))[0];

    if (!defaultConfig) {
      throw new NotFoundException("Configuration hiérarchique par défaut introuvable");
    }

    return this.activate(defaultConfig.id, userId);
  }

  private validateEntityOrder(entityOrder: string[]): void {
    const validSet = new Set(VALID_ENTITIES);
    const seen = new Set<string>();

    for (const entity of entityOrder) {
      if (!validSet.has(entity as (typeof VALID_ENTITIES)[number])) {
        throw new BadRequestException(`Entité invalide : "${entity}". Entités valides : ${VALID_ENTITIES.join(", ")}`);
      }
      if (seen.has(entity)) {
        throw new BadRequestException(`Entité en double : "${entity}"`);
      }
      seen.add(entity);
    }

    for (const mandatory of MANDATORY_ENTITIES) {
      if (!seen.has(mandatory)) {
        throw new BadRequestException(`L'entité obligatoire "${mandatory}" doit être incluse dans la hiérarchie`);
      }
    }
  }
}