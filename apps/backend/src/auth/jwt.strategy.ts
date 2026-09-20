import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request as ExpressRequest } from "express";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { users } from "../db/schema";
import { JWT_SECRET } from "./constants";

/** The session cookie name — also read by the Next.js middleware. */
export const SESSION_COOKIE = "iq_session";
export const REFRESH_COOKIE = "iq_refresh";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(private readonly db: DbService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: ExpressRequest) => {
          if (req?.cookies?.[SESSION_COOKIE]) return req.cookies[SESSION_COOKIE];
          return null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET(),
    });
  }

  async validate(payload: { sub: string; email: string; role: string; iat?: number }) {
    const user = await this.db.client.query.users.findFirst({
      where: eq(users.id, payload.sub),
      columns: { id: true, email: true, role: true, is_active: true, full_name: true, tokens_valid_after: true },
    });
    if (!user || !user.is_active) {
      throw new UnauthorizedException("Le compte est inactif ou n'existe pas");
    }
    // Server-side revocation floor: a session minted before the last
    // credential event (password change) is dead even though its JWT still
    // verifies. Without this, logout-and-change-password cannot evict a
    // stolen refresh token that lives for 30 days on a stolen laptop.
    if (user.tokens_valid_after && payload.iat !== undefined) {
      if (payload.iat * 1000 < user.tokens_valid_after.getTime()) {
        throw new UnauthorizedException("Session révoquée — veuillez vous reconnecter.");
      }
      // A token minted after the floor was set proves the credential is
      // current; clear the floor so future clock normalisation never
      // re-kills a session that was legitimately minted afterwards.
      await this.db.client
        .update(users)
        .set({ tokens_valid_after: null })
        .where(eq(users.id, user.id));
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
      full_name: user.full_name,
    };
  }
}