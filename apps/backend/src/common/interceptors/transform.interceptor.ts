import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, map } from "rxjs";
import { ApiResponse } from "../types";

/**
 * Wraps every successful response in the `{ data, meta, error }` envelope
 * mandated by §12. A handler may return `{ data, meta }` itself to supply
 * pagination metadata; anything else is treated as the payload.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((payload: any) => {
        if (payload && typeof payload === "object" && "data" in payload && !Array.isArray(payload)) {
          return { data: payload.data, meta: payload.meta ?? undefined, error: null };
        }
        return { data: payload, meta: undefined, error: null };
      }),
    );
  }
}
