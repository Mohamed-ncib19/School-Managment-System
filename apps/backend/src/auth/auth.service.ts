import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UserRole } from "@iq/shared";
import { compare, hash } from "bcryptjs";
import { randomBytes } from "crypto";
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

  async validateUser(email: string, password: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.users.findUnique({ where: { email } });
    if (!user) {
      await this.auditService.createLog("system", "auth.login_failed", "user", "unknown", {
        reason: "user_not_found",
        email,
        ip_address: ipAddress,
        user_agent: userAgent,
      });
      throw new UnauthorizedException("Invalid credentials");
    }
    const valid = await compare(password, user.password_hash);
    if (!valid) {
      await this.auditService.createLog("system", "auth.login_failed", "user", user.id, {
        reason: "invalid_password",
        email,
        ip_address: ipAddress,
        user_agent: userAgent,
      });
      throw new UnauthorizedException("Invalid credentials");
    }
    if (!user.is_active) {
      await this.auditService.createLog("system", "auth.login_failed", "user", user.id, {
        reason: "account_deactivated",
        email,
        ip_address: ipAddress,
        user_agent: userAgent,
      });
      throw new UnauthorizedException("Your account has been deactivated");
    }
    const { password_hash, ...result } = user;
    await this.auditService.createLog(user.id, "auth.login_success", "user", user.id, {
      email,
      ip_address: ipAddress,
      user_agent: userAgent,
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
      await this.auditService.createLog(userId, "auth.change_password_failed", "user", userId, {
        reason: "incorrect_current_password",
      });
      throw new UnauthorizedException("Current password is incorrect");
    }

    const password_hash = await hash(newPassword, 10);
    await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash },
    });

    await this.auditService.createLog(userId, "auth.change_password_success", "user", userId, {});
    return { message: "Password changed successfully" };
  }

  async log(userId: string, action: string, meta?: any) {
    await this.auditService.createLog(userId, action, "user", userId, meta ?? {});
  }
}
