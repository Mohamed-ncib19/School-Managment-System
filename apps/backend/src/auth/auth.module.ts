import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";
import { AuditModule } from "../audit/audit.module";
import { JWT_SECRET, JWT_EXPIRES_IN } from "./constants";

@Module({
  imports: [
    AuditModule,
    PassportModule.register({ defaultStrategy: "jwt" }),
    // Through `constants.ts`, not a second copy of the same `?? "fallback…"`
    // literal. This module kept its own, so hardening the one in constants.ts
    // would have left this registration still signing with the published
    // string — and the two silently disagreeing is worse than either alone.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: JWT_SECRET(),
        signOptions: { expiresIn: JWT_EXPIRES_IN() },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
