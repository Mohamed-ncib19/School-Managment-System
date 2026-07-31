export type ApiMeta = { total?: number; page?: number; pageSize?: number };

export type ApiError = {
  code: string;
  message: string | string[];
  statusCode: number;
  path: string;
};

/** The `{ data, meta, error }` envelope every endpoint returns (§12). */
export type ApiResponse<T> = {
  data: T | null;
  meta?: ApiMeta;
  error: ApiError | null;
};
