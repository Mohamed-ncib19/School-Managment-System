import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UserRole } from "@iq/shared";
import { compare, hash } from "bcryptjs";
import {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  JWT_REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN,
} from "./constants";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * A failed login has no authenticated actor, so the entry is written with a
   * null actor and the attempted address as the label. Passing the literal
   * strings "system"/"unknown" into the uuid columns is what previously made
   * every failed login throw a database error and surface as HTTP 500 - which
   * also meant not one failed attempt was ever recorded.
   */
  private async recordFailedLogin(
    reason: string,
    email: string,
    userId: string | null,
    ipAddress?: string,
    userAgent?: string,
  ) {
    await this.auditService.record({
      action: "auth.login_failed",
      entityType: "user",
      entityId: userId,
      entityLabel: email,
      actorId: null,
      actorLabel: `anonymous (${email})`,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      meta: { reason, email },
    });
  }

  async validateUser(email: string, password: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.users.findUnique({ where: { email } });
    if (!user) {
      await this.recordFailedLogin("user_not_found", email, null, ipAddress, userAgent);
      throw new UnauthorizedException("Invalid credentials");
    }
    const valid = await compare(password, user.password_hash);
    if (!valid) {
      await this.recordFailedLogin("invalid_password", email, user.id, ipAddress, userAgent);
      throw new UnauthorizedException("Invalid credentials");
    }
    if (!user.is_active) {
      await this.recordFailedLogin("account_deactivated", email, user.id, ipAddress, userAgent);
      throw new UnauthorizedException("Your account has been deactivated");
    }
    const { password_hash, ...result } = user;
    await this.auditService.record({
      action: "auth.login_success",
      entityType: "user",
      entityId: user.id,
      entityLabel: user.full_name,
      actorId: user.id,
      actorLabel: user.full_name,
      actorRole: user.role,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      meta: { email },
    });
    return result;
  }

  async login(user: { id: string; email: string; role: UserRole; full_name: string }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload, {
      secret: JWT_SECRET(),
      expiresIn: JWT_EXPIRES_IN(),
    });
    const refresh_token = this.jwtService.sign(
      { sub: user.id, type: "refresh" },
      {
        secret: JWT_REFRESH_SECRET(),
        expiresIn: JWT_REFRESH_EXPIRES_IN(),
      },
    );
    return {
      access_token,
      refresh_token,
      user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    };
  }

  async createSuperAdmin(data: {
    full_name: string;
    email: string;
    password: string;
  }) {
    const existing = await this.prisma.users.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new ConflictException("Super admin with this email already exists");
    }
    const password_hash = await hash(data.password, 10);
    const user = await this.prisma.users.create({
      data: { full_name: data.full_name, email: data.email, password_hash, role: "super_admin" },
    });
    const { password_hash: _, ...result } = user;
    return result;
  }

  async me(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, email: true, full_name: true, role: true, is_active: true },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const valid = await compare(currentPassword, user.password_hash);
    if (!valid) {
      await this.auditService.record({
        action: "auth.change_password_failed",
        entityType: "user",
        entityId: userId,
        entityLabel: user.full_name,
        actorId: userId,
        meta: { reason: "incorrect_current_password" },
      });
      throw new UnauthorizedException("Current password is incorrect");
    }

    const password_hash = await hash(newPassword, 10);
    await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash },
    });

    // The event is recorded; the credential itself never is.
    await this.auditService.record({
      action: "auth.change_password_success",
      entityType: "user",
      entityId: userId,
      entityLabel: user.full_name,
      actorId: userId,
    });
    return { message: "Password changed successfully" };
  }

  async log(userId: string, action: string, meta?: any) {
    await this.auditService.record({
      action,
      entityType: "user",
      entityId: userId,
      actorId: userId,
      meta: meta ?? undefined,
    });
  }
}
