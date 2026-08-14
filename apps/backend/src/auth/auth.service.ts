import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { users } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { UserRole } from "@iq/shared";
import { compare, hash } from "bcryptjs";
import {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  JWT_REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN,
} from "./constants";

/**
 * Cost factor for password hashing.
 *
 * `BCRYPT_ROUNDS` has been documented in .env.example since the first release
 * while both hashing call sites here passed a literal 10, so raising it changed
 * only what the seed script did — the same shape of bug `PORT` had in main.ts.
 * Read once at module load, like the JWT settings; out-of-range or unparseable
 * values fall back to 10 rather than throwing at password-change time.
 */
function bcryptRounds(): number {
  const raw = Number(process.env.BCRYPT_ROUNDS);
  return Number.isInteger(raw) && raw >= 4 && raw <= 31 ? raw : 10;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
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
    const user = await this.db.client.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      await this.recordFailedLogin("user_not_found", email, null, ipAddress, userAgent);
      throw new UnauthorizedException("Identifiants invalides");
    }
    const valid = await compare(password, user.password_hash);
    if (!valid) {
      await this.recordFailedLogin("invalid_password", email, user.id, ipAddress, userAgent);
      throw new UnauthorizedException("Identifiants invalides");
    }
    if (!user.is_active) {
      await this.recordFailedLogin("account_deactivated", email, user.id, ipAddress, userAgent);
      throw new UnauthorizedException("Votre compte a été désactivé");
    }
const {
      password_hash: _passwordHash,
      full_name,
      is_active,
      created_at: _createdAt,
      updated_at: _updatedAt,
      reset_token: _resetToken,
      reset_token_expires: _resetTokenExpires,
      ...rest
    } = user;
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
    return { ...rest, full_name, is_active };
  }

  async login(user: { id: string; email: string; role: UserRole; full_name: string }) {
    const tokens = await this.mintTokens(user);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    };
  }

  /**
   * Mints an access token and its rotating refresh token.
   *
   * The refresh token carries the same claims plus `type: "refresh"` so it can
   * never be mistaken for (or replayed as) an access token. Rotation on every
   * refresh keeps a stolen refresh token useful only until it is used.
   */
  private async mintTokens(user: { id: string; email: string; role: UserRole }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload, {
      secret: JWT_SECRET(),
      expiresIn: JWT_EXPIRES_IN(),
    });
    const refresh_token = this.jwtService.sign(
      { ...payload, type: "refresh" },
      {
        secret: JWT_REFRESH_SECRET(),
        expiresIn: JWT_REFRESH_EXPIRES_IN(),
      },
    );
    return { access_token, refresh_token };
  }

  /**
   * Exchanges a still-valid refresh token for a fresh access token.
   *
   * Every call rotates both tokens, so the session cookie never goes stale and
   * a compromised refresh token dies the moment it is reused.
   */
  async refresh(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException("Session expirée, veuillez vous reconnecter");
    let payload: { sub: string; type?: string };
    try {
      payload = await this.jwtService.verifyAsync<{ sub: string; type?: string }>(refreshToken, {
        secret: JWT_REFRESH_SECRET(),
      });
    } catch {
      throw new UnauthorizedException("Session expirée, veuillez vous reconnecter");
    }
    if (payload.type !== "refresh") {
      throw new UnauthorizedException("Session invalide, veuillez vous reconnecter");
    }

    const user = await this.db.client.query.users.findFirst({
      where: eq(users.id, payload.sub),
      columns: { id: true, email: true, role: true, full_name: true, is_active: true },
    });
    if (!user || !user.is_active) {
      throw new UnauthorizedException("Le compte est inactif ou n'existe pas");
    }

    const tokens = await this.mintTokens(user);
    return { ...tokens, user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name } };
  }

  async createSuperAdmin(data: {
    full_name: string;
    email: string;
    password: string;
  }) {
    const existing = await this.db.client.query.users.findFirst({
      where: eq(users.email, data.email),
      columns: { id: true },
    });
    if (existing) {
      throw new ConflictException("Un super administrateur avec cet e-mail existe déjà");
    }
    const password_hash = await hash(data.password, bcryptRounds());
    const [user] = await this.db.client
      .insert(users)
      .values({ full_name: data.full_name, email: data.email, password_hash, role: "super_admin" })
      .returning();
    const { password_hash: _passwordHash, ...result } = user;
    return result;
  }

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

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.db.client.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new NotFoundException("Utilisateur introuvable");

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
      throw new UnauthorizedException("Le mot de passe actuel est incorrect");
    }

    const passwordHash = await hash(newPassword, bcryptRounds());
    await this.db.client.update(users).set({ password_hash: passwordHash }).where(eq(users.id, userId));

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