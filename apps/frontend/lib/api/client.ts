import axios, { AxiosInstance, AxiosError } from "axios";
import { useAuthStore } from "@/hooks/use-auth-store";

let apiClient: AxiosInstance | undefined;

/** Backend mounts every route under `setGlobalPrefix("api")`. */
const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export function initApi(baseURL: string = DEFAULT_BASE_URL): AxiosInstance {
  apiClient = axios.create({ baseURL });

  apiClient.interceptors.request.use((config) => {
    const token = useAuthStore.getState().token;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  apiClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      if (error.response?.status === 401) {
        useAuthStore.getState().logout();
        window.location.href = "/login";
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

export const ApiClient = {
  get: <T>(url: string, config = {}): Promise<T> => getApiClient().get(resolveUrl(url), config).then((r) => unwrap<T>(r.data)),
  post: <T = any>(url: string, data?: any, config = {}): Promise<T> => getApiClient().post(resolveUrl(url), data, config).then((r) => unwrap<T>(r.data)),
  put: <T = any>(url: string, data?: any, config = {}): Promise<T> => getApiClient().put(resolveUrl(url), data, config).then((r) => unwrap<T>(r.data)),
  patch: <T = any>(url: string, data?: any, config = {}): Promise<T> => getApiClient().patch(resolveUrl(url), data, config).then((r) => unwrap<T>(r.data)),
  del: (url: string, config = {}): Promise<void> => getApiClient().delete(resolveUrl(url), config).then(() => {}),
};

export default ApiClient;
