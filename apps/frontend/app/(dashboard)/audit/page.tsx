"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronRight, ChevronLeft, ChevronRightIcon, History } from "lucide-react";
import { auditApi, type AuditLogResponse } from "@/lib/api/audit.api";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

const ACTION_LABELS: Record<string, string> = {
  "payment.recorded": "Payment Recorded",
  "import.students": "Students Imported",
  "student.created": "Student Created",
  "student.moved_group": "Student Moved",
  "field.created": "Field Created",
  "field.updated": "Field Updated",
  "field.deleted": "Field Deleted",
  "professor.created": "Professor Created",
  "professor.updated": "Professor Updated",
  "professor.deactivated": "Professor Deactivated",
  "level.created": "Level Created",
  "level.updated": "Level Updated",
  "level.deleted": "Level Deleted",
  "group.created": "Group Created",
  "group.updated": "Group Updated",
  "group.deleted": "Group Deleted",
};

const ENTITY_LABELS: Record<string, string> = {
  student_payment: "Payment",
  students: "Student",
  student: "Student",
  field: "Field",
  professor: "Professor",
  level: "Level",
  group: "Group",
};

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState<string>("");
  const limit = 20;

  const showText = (key: string, fallback: string, values: Record<string, string | number>) => {
    let result = t(key, fallback);
    Object.entries(values).forEach(([k, v]) => {
      result = result.split(`{${k}}`).join(String(v));
    });
    return result;
  };

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page, entityFilter],
    queryFn: () => auditApi.list({ page, limit, entityType: entityFilter || undefined }),
  });

  const logs = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/dashboard" className="hover:text-primary">{t("audit.dashboardBreadcrumb")}</Link>
        <ChevronRight size={14} />
        <span className="text-text-primary font-medium">{t("audit.title")}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-card bg-primary-50 flex items-center justify-center text-primary">
          <History size={20} />
        </div>
        <div>
          <h2 className="text-h4 font-bold text-text-primary">{t("audit.title")}</h2>
          <p className="text-xs text-text-secondary">{t("audit.subtitle")}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { setEntityFilter(""); setPage(1); }}
          className={`btn text-xs ${!entityFilter ? "btn-primary" : "btn-secondary"}`}
        >
          {t("audit.all")}
        </button>
        {["student", "payment", "field", "professor", "level", "group"].map((entity) => (
          <button
            key={entity}
            onClick={() => { setEntityFilter(entity); setPage(1); }}
            className={`btn text-xs ${entityFilter === entity ? "btn-primary" : "btn-secondary"}`}
          >
            {ENTITY_LABELS[entity] ?? entity}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <LoadingSkeleton key={i} type="table-row" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState message={t("audit.noEntries")} />
      ) : (
        <>
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("audit.action")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("audit.entity")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("audit.actor")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("audit.details")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("audit.date")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {ACTION_LABELS[log.action] ?? log.action}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      <span className="inline-flex items-center rounded-full bg-neutral-soft px-2.5 py-0.5 text-xs font-medium">
                        {ENTITY_LABELS[log.entity_type] ?? log.entity_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {(log as any).actor?.full_name ?? t("audit.system")}
                    </td>
                    <td className="px-4 py-3 text-text-secondary text-xs max-w-[200px] truncate">
                      {log.meta ? JSON.stringify(log.meta) : t("audit.dash")}
                    </td>
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-secondary">
                {showText("audit.showing", "Showing {start}\u2013{end} of {total}", { start: ((page - 1) * limit) + 1, end: Math.min(page * limit, meta.total), total: meta.total })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn btn-secondary text-xs disabled:opacity-50"
                >
                  <ChevronLeft size={14} /> {t("audit.previous")}
                </button>
                <span className="text-xs text-text-secondary">
                  {showText("audit.pageOf", "Page {page} of {totalPages}", { page, totalPages: meta.totalPages })}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={page === meta.totalPages}
                  className="btn btn-secondary text-xs disabled:opacity-50"
                >
                  {t("audit.next")} <ChevronRightIcon size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
