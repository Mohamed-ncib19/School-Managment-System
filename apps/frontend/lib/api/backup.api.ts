import { ApiClient } from "./client";

export interface BackupRecord {
  id: string;
  filename: string;
  size: number;
  createdAt: string;
  createdBy: string | null;
  version: string | null;
}

export interface BackupResult {
  success: boolean;
  message: string;
  backup: {
    id: string;
    filename: string;
    path: string;
    size: number;
    createdAt: string;
    version: string | null;
  };
}

export interface RestoreResult {
  success: boolean;
  message: string;
  restoredFrom: string;
  safetyBackup: string | null;
}

export const backupApi = {
  list: () => ApiClient.get<BackupRecord[]>("/backup"),
  create: (version?: string) =>
    ApiClient.post<BackupResult>("/backup/create", { version: version ?? "latest" }),
  restore: (backupId: string) =>
    ApiClient.post<RestoreResult>(`/backup/restore/${backupId}`, { confirm: "RESTORE" }),
};
