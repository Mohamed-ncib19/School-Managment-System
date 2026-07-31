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

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Request() req: ExpressRequest) {
    const ipAddress = req.ip || req.connection.remoteAddress || "unknown";
    const userAgent = req.get("user-agent") || "unknown";

    const now = Date.now();
    const entry = loginAttempts.get(ipAddress);
    if (entry) {
      if (now < entry.resetAt && entry.count >= MAX_LOGIN_ATTEMPTS) {
        throw new HttpException("Too many login attempts. Please try again later.", HttpStatus.TOO_MANY_REQUESTS);
      }
      if (now >= entry.resetAt) {
        loginAttempts.delete(ipAddress);
      }
    }

    const user = await this.authService.validateUser(loginDto.email, loginDto.password, ipAddress, userAgent);

    const current = loginAttempts.get(ipAddress);
    if (current && now < current.resetAt) {
      current.count++;
    } else {
      loginAttempts.set(ipAddress, { count: 1, resetAt: now + RATE_WINDOW_MS });
    }

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
