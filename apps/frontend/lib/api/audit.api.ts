import { ApiClient, type Paginated } from "./client";
import type { AuditLog } from "@/types";

export type AuditLogResponse = Paginated<AuditLog>;

export interface AuditListParams {
  page?: number;
  limit?: number;
  entityType?: string;
  action?: string;
  actorUserId?: string;
  search?: string;
  from?: string;
  to?: string;
  sortBy?: "created_at" | "action" | "entity_type";
  sortDir?: "asc" | "desc";
}

export interface AuditFilterOptions {
  actions: string[];
  entityTypes: string[];
  actors: { id: string; full_name: string; email: string }[];
}

/** Counts for the overview cards and the daily activity chart. */
export interface AuditSummary {
  total: number;
  byAction: { action: string; count: number }[];
  series: { day: string; count: number }[];
}

/** Drops empty values so the query string stays clean and cache keys stay stable. */
const compact = (params: object) =>
  Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );

export const auditApi = {
  // Paginated: keeps the envelope's `meta` instead of collapsing to a bare array.
  list: (params?: AuditListParams) =>
    ApiClient.getPaginated<AuditLog>("/audit-logs", { params: compact(params ?? {}) }),

  options: () => ApiClient.get<AuditFilterOptions>("/audit-logs/options"),

  summary: (params?: AuditListParams) =>
    ApiClient.get<AuditSummary>("/audit-logs/summary", { params: compact(params ?? {}) }),
};
