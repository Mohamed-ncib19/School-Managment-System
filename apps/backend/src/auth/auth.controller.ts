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
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { Request as ExpressRequest } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { SESSION_COOKIE, REFRESH_COOKIE } from "./jwt.strategy";
import { JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN } from "./constants";

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

function sessionCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeMs,
  };
}

/** Parses a `jsonwebtoken`-style duration ("7d", "12h") into milliseconds. */
function msFromExpires(expiresIn: string): number {
  const match = /^(\d+)([smhdw])$/.exec(expiresIn);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit: Record<string, number> = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60, w: 7 * 24 * 60 * 60 };
  return value * (unit[match[2]] ?? 24 * 60 * 60) * 1000;
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
  async login(@Body() loginDto: LoginDto, @Request() req: ExpressRequest, @Res({ passthrough: true }) res: Response) {
    // The throttle key must be something the caller cannot choose. It used to
    // prefer `x-forwarded-for`, a request header, so varying it per attempt
    // defeated the limiter entirely — the only brute-force defence this app
    // has. The socket address is the one value a client cannot forge.
    //
    // Express resolves `req.ip` from `x-forwarded-for` only when `trust proxy`
    // is enabled, which it is not here; behind a real reverse proxy, set that
    // setting rather than reading the header by hand.
    const ipAddress = req.ip || req.socket?.remoteAddress || "unknown";
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
    const result = await this.authService.login(user);
    this.setSessionCookies(res, result.access_token, result.refresh_token);
    return result;
  }

  /** Sets the httpOnly session cookies — the frontend never touches the tokens. */
  private setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
    const accessMaxAge = msFromExpires(JWT_EXPIRES_IN());
    const refreshMaxAge = msFromExpires(JWT_REFRESH_EXPIRES_IN());
    res.cookie(SESSION_COOKIE, accessToken, sessionCookieOptions(accessMaxAge));
    res.cookie(REFRESH_COOKIE, refreshToken, sessionCookieOptions(refreshMaxAge));
  }

  /**
   * Rotates the session from the refresh cookie. The access token keeps its
   * short lifetime while the session itself stays alive until the refresh
   * expires — the browser asks for a new token before the old one dies.
   */
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: ExpressRequest, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refresh(req.cookies?.[REFRESH_COOKIE]);
    this.setSessionCookies(res, result.access_token, result.refresh_token);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@Req() req: any) {
    return this.authService.me(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const userId = req.user.id;
    await this.authService.log(userId, "auth.logout");
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(REFRESH_COOKIE, { path: "/" });
    return { message: "Logged out successfully" };
  }

  @UseGuards(JwtAuthGuard)
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: any,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(req.user.id, dto.current_password, dto.new_password);
  }
}
