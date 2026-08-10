import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, email: true, full_name: true, role: true, is_active: true },
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");
    return user;
  }

  async updateProfile(userId: string, dto: { full_name?: string; email?: string }) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Utilisateur introuvable");

    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.users.findUnique({ where: { email: dto.email } });
      if (existing && existing.id !== userId) {
        throw new ConflictException("Cet e-mail est déjà utilisé par un autre compte");
      }
    }

    return this.prisma.users.update({
      where: { id: userId },
      data: {
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.email !== undefined && { email: dto.email }),
      },
      select: { id: true, email: true, full_name: true, role: true, is_active: true },
    });
  }
}
