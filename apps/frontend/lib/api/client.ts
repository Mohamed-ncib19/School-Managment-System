import axios, { AxiosInstance, AxiosError } from "axios";
import { useAuthStore } from "@/hooks/use-auth-store";

let apiClient: AxiosInstance | undefined;

/** Backend mounts every route under `setGlobalPrefix("api")`. */
const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

/** The API base, for building absolute asset URLs (logo, exports) at runtime. */
export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_BASE_URL;
}

export function initApi(baseURL: string = DEFAULT_BASE_URL): AxiosInstance {
  apiClient = axios.create({
    baseURL,
    // The session rides on httpOnly cookies (`iq_session`), so every request
    // must send credentials — there is no token to attach by hand.
    withCredentials: true,
  });

  apiClient.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      // The logout call itself 401s when the session is already invalid;
      // skipping it here prevents the redirect loop (logout 401 -> logout -> ...).
      const skipAuthHandling = Boolean((error.config as any)?.skipAuthHandling);
      if (error.response?.status === 401 && !skipAuthHandling) {
        const { clearSession } = useAuthStore.getState();
        clearSession();
        if (typeof window !== "undefined" && window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
      return Promise.reject(error);
    },
  );

  return apiClient;
}

/**
 * Self-initialising so a query firing on first render can't race the
 * Providers effect. `initApi` stays available to override the base URL.
 */
export function getApiClient(): AxiosInstance {
  if (!apiClient) apiClient = initApi();
  return apiClient;
}

// Relative paths resolve against the instance baseURL; absolute ones pass through.
const resolveUrl = (url: string) => url;

/**
 * The API wraps every success in `{ data, meta, error }` (the backend's
 * TransformInterceptor). Callers want the payload, so peel the envelope here
 * rather than at each call site. Blobs and other raw bodies pass through.
 */
const unwrap = <T>(body: any): T =>
  body && typeof body === "object" && "data" in body && "error" in body ? body.data : body;

/** A paginated payload, with the envelope's `meta` preserved. */
export interface Paginated<
  T,
  M = { total: number; page: number; limit: number; totalPages: number },
> {
  data: T[];
  meta: M;
}

/**
 * Paginated reads must not go through `unwrap`: it returns `body.data` and
 * discards `body.meta`, so the caller receives a bare array. Anything then
 * reading `result.data` / `result.meta` - as the audit history page did - gets
 * `undefined` and renders as permanently empty, however many rows exist.
 */
const unwrapPaginated = <
  T,
  M = { total: number; page: number; limit: number; totalPages: number },
>(body: any): Paginated<T, M> => {
  const rows: T[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const meta = body?.meta ?? {};
  return {
    data: rows,
    meta: {
      total: meta.total ?? rows.length,
      page: meta.page ?? 1,
      limit: meta.limit ?? rows.length,
      totalPages: meta.totalPages ?? 1,
      ...meta,
    } as M,
  };
};

export const ApiClient = {
  get: <T>(url: string, config = {}): Promise<T> => getApiClient().get(resolveUrl(url), config).then((r) => unwrap<T>(r.data)),
  getPaginated: <T, M = Paginated<T>["meta"]>(url: string, config = {}): Promise<Paginated<T, M>> =>
    getApiClient().get(resolveUrl(url), config).then((r) => unwrapPaginated<T, M>(r.data)),
  post: <T = any>(url: string, data?: any, config = {}): Promise<T> => getApiClient().post(resolveUrl(url), data, config).then((r) => unwrap<T>(r.data)),
  put: <T = any>(url: string, data?: any, config = {}): Promise<T> => getApiClient().put(resolveUrl(url), data, config).then((r) => unwrap<T>(r.data)),
  patch: <T = any>(url: string, data?: any, config = {}): Promise<T> => getApiClient().patch(resolveUrl(url), data, config).then((r) => unwrap<T>(r.data)),
  del: (url: string, config = {}): Promise<void> => getApiClient().delete(resolveUrl(url), config).then(() => {}),
};

export default ApiClient;
