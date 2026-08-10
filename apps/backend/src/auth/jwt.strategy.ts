import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";
import { JWT_SECRET } from "./constants";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET(),
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.prisma.users.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, is_active: true, full_name: true },
    });
    if (!user || !user.is_active) {
      throw new UnauthorizedException("Le compte est inactif ou n'existe pas");
    }
    return user;
  }
}
