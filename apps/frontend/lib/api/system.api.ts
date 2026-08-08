import { ApiClient } from "./client";
import type { SystemSettings } from "@/types";

export const systemApi = {
  get: (): Promise<SystemSettings> => ApiClient.get<SystemSettings>("/system-settings"),
  update: (patch: { system_name?: string; features?: Record<string, boolean> }): Promise<SystemSettings> =>
    ApiClient.put<SystemSettings>("/system-settings", patch),
  /** super_admin only. Shuts down the whole system: API + web servers, and the
   *  portable database on Windows. The browser tab dies with the backend. */
  stop: (): Promise<{ ok: boolean; started: boolean }> =>
    ApiClient.post<{ ok: boolean; started: boolean }>("/system/stop"),
};