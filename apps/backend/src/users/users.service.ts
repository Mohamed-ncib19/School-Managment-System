import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { users } from "../db/schema";

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}

  async me(userId: string) {
    const user = await this.db.client.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, email: true, full_name: true, role: true, is_active: true },
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      is_active: user.is_active,
    };
  }

  async updateProfile(userId: string, dto: { full_name?: string; email?: string }) {
    const user = await this.db.client.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new NotFoundException("Utilisateur introuvable");

    if (dto.email && dto.email !== user.email) {
      const existing = await this.db.client.query.users.findFirst({
        where: eq(users.email, dto.email),
        columns: { id: true },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException("Cet e-mail est déjà utilisé par un autre compte");
      }
    }

    const [updated] = await this.db.client
      .update(users)
      .set({
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.email !== undefined && { email: dto.email }),
      })
      .where(eq(users.id, userId))
      .returning();

    return {
      id: updated.id,
      email: updated.email,
      full_name: updated.full_name,
      role: updated.role,
      is_active: updated.is_active,
    };
  }
}