import { Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { whiteboards } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { CreateWhiteboardDto, UpdateWhiteboardDto } from "./dto/whiteboards.dto";

export const DEFAULT_WHITEBOARD_TITLE = "Nouveau tableau";

type WhiteboardRow = typeof whiteboards.$inferSelect;

/** DB rows are snake_case; the API contract is camelCase. */
function toApi(row: WhiteboardRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEditedAt: row.last_edited_at,
    scene: row.scene as unknown as Record<string, unknown>,
  };
}

/**
 * Whiteboard / notes workspace.
 *
 * A whiteboard belongs to the user who created it and is only ever reachable
 * through that user's id — the owner is taken from the JWT on every request,
 * never from the client payload, so listing, reading, updating and deleting
 * all re-check `owner_id` server-side (a missing row reads as 404 rather than
 * 403, so ids of other users' boards cannot even be probed).
 */
@Injectable()
export class WhiteboardsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** History list: metadata only, newest edit first. The scene is fetched by id. */
  async list(userId: string) {
    const rows = await this.db.client
      .select({
        id: whiteboards.id,
        owner_id: whiteboards.owner_id,
        title: whiteboards.title,
        created_at: whiteboards.created_at,
        updated_at: whiteboards.updated_at,
        last_edited_at: whiteboards.last_edited_at,
      })
      .from(whiteboards)
      .where(eq(whiteboards.owner_id, userId))
      .orderBy(desc(whiteboards.updated_at));
    return rows.map((row) => ({
      ...toApi(row as WhiteboardRow),
      scene: undefined,
    }));
  }

  private async findOwned(userId: string, id: string): Promise<WhiteboardRow> {
    const row = (
      await this.db.client
        .select()
        .from(whiteboards)
        .where(and(eq(whiteboards.id, id), eq(whiteboards.owner_id, userId)))
        .limit(1)
    )[0];
    if (!row) throw new NotFoundException("Tableau introuvable");
    return row;
  }

  async findOne(userId: string, id: string) {
    return toApi(await this.findOwned(userId, id));
  }

  async create(userId: string, dto: CreateWhiteboardDto) {
    const [row] = await this.db.client
      .insert(whiteboards)
      .values({
        owner_id: userId,
        title: dto.title?.trim() || DEFAULT_WHITEBOARD_TITLE,
        scene: dto.scene as unknown,
      })
      .returning();

    await this.audit.record({
      action: "whiteboard.created",
      entityType: "whiteboard",
      entityId: row.id,
      entityLabel: row.title,
      actorId: userId,
    });
    return toApi(row);
  }

  async update(userId: string, id: string, dto: UpdateWhiteboardDto) {
    const existing = await this.findOwned(userId, id);

    const [row] = await this.db.client
      .update(whiteboards)
      .set({
        title: dto.title !== undefined ? dto.title.trim() || existing.title : undefined,
        scene: dto.scene !== undefined ? (dto.scene as unknown) : undefined,
        // Content edits (autosaves) stamp `last_edited_at`; metadata-only
        // changes (renaming) only touch `updated_at`.
        last_edited_at: dto.scene !== undefined ? new Date() : undefined,
      })
      .where(and(eq(whiteboards.id, id), eq(whiteboards.owner_id, userId)))
      .returning();

    await this.audit.record({
      action: "whiteboard.updated",
      entityType: "whiteboard",
      entityId: id,
      entityLabel: row.title,
      actorId: userId,
      meta: {
        changed_fields: [
          ...(dto.title !== undefined ? ["title"] : []),
          ...(dto.scene !== undefined ? ["scene"] : []),
        ],
      },
    });
    return toApi(row);
  }

  async remove(userId: string, id: string) {
    const existing = await this.findOwned(userId, id);
    await this.db.client.delete(whiteboards).where(and(eq(whiteboards.id, id), eq(whiteboards.owner_id, userId)));
    await this.audit.record({
      action: "whiteboard.deleted",
      entityType: "whiteboard",
      entityId: id,
      entityLabel: existing.title,
      actorId: userId,
    });
  }
}