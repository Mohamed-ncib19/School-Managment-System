import { ApiClient } from "@/lib/api/client";
import type { SystemSettings } from "@/types";

export const systemApi = {
  get: () => ApiClient.get<SystemSettings>("/system-settings"),
  update: (data: Partial<Pick<SystemSettings, "system_name" | "features">>) =>
    ApiClient.put<SystemSettings>("/system-settings", data),
};
