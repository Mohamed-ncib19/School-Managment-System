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

  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.db.client.query.users.findFirst({
      where: eq(users.id, payload.sub),
      columns: { id: true, email: true, role: true, is_active: true, full_name: true },
    });
    if (!user || !user.is_active) {
      throw new UnauthorizedException("Le compte est inactif ou n'existe pas");
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