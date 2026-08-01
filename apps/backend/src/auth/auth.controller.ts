import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
  Req,
  Request,
  HttpException,
} from "@nestjs/common";
import { Request as ExpressRequest } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 10;
const RATE_WINDOW_MS = 60_000;
/** Bounds the map so a flood of distinct source addresses cannot grow it without limit. */
const MAX_TRACKED_IPS = 5_000;

/** Drops windows that have expired; called on write, so it costs nothing when idle. */
function pruneLoginAttempts(now: number) {
  if (loginAttempts.size < MAX_TRACKED_IPS) {
    for (const [key, value] of loginAttempts) {
      if (now >= value.resetAt) loginAttempts.delete(key);
    }
    return;
  }
  loginAttempts.clear();
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * The throttle counts *failed* attempts. It previously incremented only after
   * `validateUser` returned - that is, only on success - so a brute-force run
   * (which never reaches that line) was never throttled at all, while a
   * legitimate administrator logging in repeatedly was the only one who could
   * ever lock themselves out.
   */
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Request() req: ExpressRequest) {
    const forwarded = req.headers["x-forwarded-for"];
    const ipAddress =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ||
      req.ip ||
      req.socket?.remoteAddress ||
      "unknown";
    const userAgent = req.get("user-agent") || "unknown";

    const now = Date.now();
    const entry = loginAttempts.get(ipAddress);
    if (entry && now >= entry.resetAt) loginAttempts.delete(ipAddress);

    const active = loginAttempts.get(ipAddress);
    if (active && active.count >= MAX_LOGIN_ATTEMPTS) {
      const retryInSec = Math.max(1, Math.ceil((active.resetAt - now) / 1000));
      throw new HttpException(
        `Too many failed login attempts. Please try again in ${retryInSec} second(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let user: Awaited<ReturnType<AuthService["validateUser"]>>;
    try {
      user = await this.authService.validateUser(loginDto.email, loginDto.password, ipAddress, userAgent);
    } catch (err) {
      const current = loginAttempts.get(ipAddress);
      if (current && now < current.resetAt) {
        current.count++;
      } else {
        pruneLoginAttempts(now);
        loginAttempts.set(ipAddress, { count: 1, resetAt: now + RATE_WINDOW_MS });
      }
      throw err;
    }

    // A correct sign-in clears the window so earlier typos don't accumulate.
    loginAttempts.delete(ipAddress);
    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@Req() req: any) {
    return this.authService.me(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: any) {
    const userId = req.user.id;
    await this.authService.log(userId, "auth.logout");
    return { message: "Logged out successfully" };
  }

  @UseGuards(JwtAuthGuard)
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: any,
    @Body() dto: { current_password: string; new_password: string },
  ) {
    return this.authService.changePassword(req.user.id, dto.current_password, dto.new_password);
  }
}
