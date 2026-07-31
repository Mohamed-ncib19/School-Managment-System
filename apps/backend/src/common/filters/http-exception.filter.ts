import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";

/**
 * Centralised exception filter (§12): every error leaves the API in the same
 * `{ data, meta, error }` envelope, so the frontend can surface a toast
 * instead of ever seeing a raw stack trace.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = "Internal server error";
    let code = "INTERNAL_ERROR";

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        // ValidationPipe puts field errors in `message` as a string[]
        message = (body as any).message ?? exception.message;
      }
      code = (exception.constructor?.name ?? "HTTP_ERROR")
        .replace(/Exception$/, "")
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toUpperCase();
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      data: null,
      meta: undefined,
      error: { code, message, statusCode: status, path: request.url },
    });
  }
}
