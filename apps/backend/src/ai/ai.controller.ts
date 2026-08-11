import { Controller, Post, Body, Res, Req, UseGuards, Logger } from "@nestjs/common";
import { Request, Response } from "express";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";
import { AiService, type AiProvider } from "./ai.service";

class ChatMessageDto {
  role: "user" | "assistant" = "user";
  content: string = "";
}

class ChatRequestDto {
  messages: ChatMessageDto[] = [];
  provider: AiProvider = "endpoint";
}

@ApiTags("ai")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
@Controller("ai")
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  @Post("chat")
  async chat(@Body() body: ChatRequestDto, @Req() req: Request, @Res() res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // Stop generation as soon as the client disconnects (pause/stop button).
    const abortController = new AbortController();
    res.on("close", () => abortController.abort());
    req.on("aborted", () => abortController.abort());

    try {
      this.logger.log(
        `Chat request with ${body.messages?.length ?? 0} messages via ${body.provider ?? "endpoint"}`,
      );

      const stream = this.aiService.chatStream(
        body.messages || [],
        abortController.signal,
        body.provider === "self-hosted" ? "self-hosted" : "endpoint",
      );

      for await (const event of stream) {
        if (res.destroyed || abortController.signal.aborted) break;
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        const ok = res.write(payload);
        if (!ok) {
          await new Promise<void>((resolve) => {
            res.once("drain", () => resolve());
            res.once("close", () => resolve());
          });
        }
      }
    } catch (error) {
      this.logger.error("Chat stream failed", (error as Error).stack);
      try {
        res.write(
          `data: ${JSON.stringify({ type: "error", content: (error as Error).message || "Unknown error" })}\n\n`,
        );
      } catch {
        this.logger.error("Chat stream failed to send error frame", (error as Error).stack);
      }
    } finally {
      try {
        if (!res.destroyed) {
          res.write("data: [DONE]\n\n");
          res.end();
        }
      } catch {
        this.logger.error("Chat stream failed to close after request finished");
      }
    }
  }
}
