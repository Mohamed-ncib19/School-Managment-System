import { ApiClient } from "./client";
import type { AuditLog } from "@/types";

export interface AuditLogResponse {
  data: AuditLog[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const auditApi = {
  list: (params?: { page?: number; limit?: number; entityType?: string; action?: string }) =>
    ApiClient.get<AuditLogResponse>("/audit-logs", { params: params ?? {} }),
};
