import { ApiClient } from "./client";

export interface UpdateStatus {
  available: boolean;
  repo?: string;
  branch?: string;
  installed?: { short: string; branch: string };
  latest?: { sha: string; short: string; message: string; author: string; date: string };
  checkedAt: string;
  reason?: string;
}

export const updatesApi = {
  /** Asks the backend whether this git install is behind the release repo. */
  check: (refresh = false): Promise<UpdateStatus> =>
    ApiClient.get<UpdateStatus>(`/updates${refresh ? "?refresh=1" : ""}`),
  /** super_admin only. Launches the platform update engine, then the app restarts. */
  apply: (): Promise<{ ok: boolean; started: boolean }> => ApiClient.post<{ ok: boolean; started: boolean }>("/updates/apply"),
};