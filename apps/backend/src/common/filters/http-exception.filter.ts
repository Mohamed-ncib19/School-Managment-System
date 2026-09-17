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
 * Translates PostgreSQL's native error codes into the HTTP status and wording
 * an administrator can act on. Returns null for anything unrecognised, which
 * then falls through to the generic 500 path.
 */
function mapPgError(
  exception: unknown,
): { status: number; code: string; message: string } | null {
  // Drizzle wraps every driver failure in DrizzleQueryError, which carries
  // the query text and params but NOT the pg code — it sits one level down
  // in `.cause`. Without unwrapping, every constraint violation in the app
  // (duplicate, foreign key, not-null, …) falls through to an opaque 500.
  let err = exception as {
    code?: string;
    detail?: string;
    constraint?: string;
    table?: string;
    cause?: unknown;
  };
  for (let depth = 0; depth < 3 && err; depth++) {
    if (err?.code && typeof err.code === "string") break;
    err = err?.cause as typeof err;
  }
  if (!err?.code || typeof err.code !== "string") return null;

  switch (err.code) {
    case "23505":
      return {
        status: HttpStatus.CONFLICT,
        code: "DUPLICATE_VALUE",
        message: err.detail ?? "That record already exists.",
      };
    case "23503":
      return {
        status: HttpStatus.BAD_REQUEST,
        code: "INVALID_REFERENCE",
        message: err.detail ?? "That references a record which does not exist.",
      };
    case "23514":
      return {
        status: HttpStatus.BAD_REQUEST,
        code: "CONSTRAINT_VIOLATION",
        message: err.constraint
          ? `This operation violates the "${err.constraint}" rule.`
          : "This operation violates a database rule.",
      };
    case "23502":
      return {
        status: HttpStatus.BAD_REQUEST,
        code: "REQUIRED_FIELD",
        message: err.detail ?? "A required value is missing.",
      };
    case "22P02":
      return {
        status: HttpStatus.BAD_REQUEST,
        code: "INVALID_INPUT",
        message: "One or more values are the wrong type or missing.",
      };
    case "22003":
      return {
        status: HttpStatus.BAD_REQUEST,
        code: "NUMBER_OUT_OF_RANGE",
        message: "A number is too large for the column it was stored in.",
      };
    case "42P01":
      return {
        status: HttpStatus.BAD_REQUEST,
        code: "UNKNOWN_TABLE",
        message:
          "The file references a table this database does not have — update the application on both sides to the same version, then export and import again.",
      };
    default:
      return null;
  }
}

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
    /**
     * Extra fields a thrower attached to describe *what* went wrong.
     *
     * Some refusals are only actionable with their details — a timetable clash
     * has to name the class already in the room, or the user is told "no" and
     * nothing else. A handler supplies those by throwing with an object
     * carrying its own `code`; everything on it besides `message` and `code`
     * rides along in the envelope.
     */
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        // ValidationPipe puts field errors in `message` as a string[]
        message = (body as any).message ?? exception.message;
        const { message: _m, code: _c, statusCode: _s, error: _e, ...rest } = body as Record<string, unknown>;
        if (Object.keys(rest).length > 0) details = rest;
      }
      // An explicit code from the thrower wins over the one derived from the
      // exception class, which can only ever say "CONFLICT" or "BAD_REQUEST".
      const explicitCode = body && typeof body === "object" ? (body as any).code : undefined;
      code = typeof explicitCode === "string"
        ? explicitCode
        : (exception.constructor?.name ?? "HTTP_ERROR")
            .replace(/Exception$/, "")
            .replace(/([a-z])([A-Z])/g, "$1_$2")
            .toUpperCase();
    } else {
      /**
       * Database constraint violations are the caller's fault, not a server
       * fault. Left unmapped they became opaque 500s - a duplicate email or a
       * reference to a deleted row read as "Internal server error", telling the
       * administrator nothing about what to correct.
       */
      const mapped = mapPgError(exception);
      if (mapped) {
        code = mapped.code;
        message = mapped.message;
        return response.status(mapped.status).json({
          data: null,
          meta: undefined,
          error: { code, message, statusCode: mapped.status, path: request.url },
        });
      }
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
      error: { code, message, statusCode: status, path: request.url, ...details },
    });
  }
}
