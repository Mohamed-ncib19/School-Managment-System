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

/** Live state of the update engine (mirrors logs/update-progress.json). */
export interface UpdateProgress {
  state: "idle" | "running" | "done" | "failed" | "stalled";
  step?: number;
  stepTotal?: number;
  label?: string;
  message?: string;
  updatedAt?: string;
  /** Relative path of the verified pre-schema safety dump, when taken. */
  backupPath?: string;
  /** True when a destructive schema change was blocked - data untouched. */
  destructive?: boolean;
  /** Post-restart API health check result (undefined = engine too old to report it). */
  healthOk?: boolean;
}

export const updatesApi = {
  /** Asks the backend whether this git install is behind the release repo. */
  check: (refresh = false): Promise<UpdateStatus> =>
    ApiClient.get<UpdateStatus>(`/updates${refresh ? "?refresh=1" : ""}`),
  /** super_admin only. Launches the platform update engine, then the app restarts. */
  apply: (): Promise<{ ok: boolean; started: boolean }> => ApiClient.post<{ ok: boolean; started: boolean }>("/updates/apply"),
  /** Current step/state of a running (or finished) update engine. */
  progress: (): Promise<UpdateProgress> => ApiClient.get<UpdateProgress>("/updates/progress"),
};