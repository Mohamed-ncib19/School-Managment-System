"use client";

import { useState, useMemo, useCallback, Fragment } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import {
  ChevronRight,
  ChevronLeft,
  ChevronRightIcon,
  History,
  Search,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Monitor,
  Globe,
  ChevronDown,
} from "lucide-react";
import { auditApi, type AuditListParams } from "@/lib/api/audit.api";
import { TableSkeleton, PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { AuditLog } from "@/types";

/**
 * Readable names for the recorded actions. Anything unmapped falls back to a
 * humanised form of the raw key, so a newly added action still reads sensibly
 * instead of showing "professor.account_linked".
 */
const ACTION_LABELS: Record<string, string> = {
  "auth.login_success": "Connexion réussie",
  "auth.login_failed": "Échec de connexion",
  "auth.logout": "Déconnexion",
  "auth.change_password_success": "Mot de passe modifié",
  "auth.change_password_failed": "Échec de changement du mot de passe",
  "payment.recorded": "Paiement enregistré",
  "payment.status_changed": "Statut de paiement modifié",
  "import.students": "Étudiants importés",
  "student.created": "Étudiant créé",
  "student.updated": "Étudiant modifié",
  "student.status_changed": "Statut de l'étudiant modifié",
  "student.moved_group": "Étudiant transféré",
  "student.deleted": "Étudiant supprimé",
  "field.created": "Filière créée",
  "field.updated": "Filière modifiée",
  "field.deleted": "Filière supprimée",
  "professor.created": "Professeur créé",
  "professor.updated": "Professeur modifié",
  "professor.account_linked": "Compte professeur lié",
  "professor.deactivated": "Professeur désactivé",
  "professor.restored": "Professeur restauré",
  "level.created": "Niveau créé",
  "level.updated": "Niveau modifié",
  "level.archived": "Niveau archivé",
  "level.restored": "Niveau restauré",
  "group.created": "Classe créée",
  "group.updated": "Classe modifiée",
  "group.archived": "Classe archivée",
  "group.restored": "Classe restaurée",
  "user.profile_updated": "Profil modifié",
  "backup.created": "Sauvegarde créée",
  "backup.restored": "Sauvegarde restaurée",
};

const ENTITY_LABELS: Record<string, string> = {
  student_payment: "Paiement",
  payment: "Paiement",
  students: "Étudiant",
  student: "Étudiant",
  field: "Filière",
  professor: "Professeur",
  level: "Niveau",
  group: "Classe",
  user: "Utilisateur",
  backup: "Sauvegarde",
};

/** Filter chips. `payment` and `student` are expanded server-side to cover the
 *  stored aliases (`student_payment`, `students`) - sending the raw chip value
 *  used to match nothing at all. */
const ENTITY_FILTERS = ["student", "payment", "field", "professor", "level", "group", "user"] as const;

const humanise = (action: string) =>
  action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const actionLabel = (action: string) => ACTION_LABELS[action] ?? humanise(action);

/** Sign-in failures and deletions are the entries an auditor scans for. */
function toneFor(action: string): string {
  if (action.includes("failed") || action.includes("deleted")) {
    return "bg-danger-soft text-danger-strong dark:bg-danger-dark-soft dark:text-danger-dark-strong";
  }
  if (action.includes("created") || action.includes("restored") || action.includes("success")) {
    return "bg-success-soft text-success-strong dark:bg-success-dark-soft dark:text-success-dark-strong";
  }
  if (action.includes("archived") || action.includes("deactivated")) {
    return "bg-warning-soft text-warning-strong dark:bg-warning-dark-soft dark:text-warning-dark-strong";
  }
  return "bg-neutral-soft text-neutral-strong dark:bg-white/10 dark:text-neutral-dark-strong";
}

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "vide";
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Before/after pairs for one entry, falling back to meta when there is no diff. */
function ChangeDetail({ log }: { log: AuditLog }) {
  const prev = (log.prev_values ?? {}) as Record<string, unknown>;
  const next = (log.new_values ?? {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));

  const extraMeta = log.meta && typeof log.meta === "object" ? { ...(log.meta as Record<string, unknown>) } : {};
  delete extraMeta.changed_fields;

  return (
    <div className="space-y-4 bg-background/60 px-4 py-4">
      {keys.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Modifications</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-text-secondary">
                  <th className="py-1 pr-6 font-medium">Champ</th>
                  <th className="py-1 pr-6 font-medium">Avant</th>
                  <th className="py-1 font-medium">Après</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key} className="border-t border-border/60">
                    <td className="py-1.5 pr-6 font-medium text-text-primary">{humanise(key)}</td>
                    <td className="py-1.5 pr-6 text-danger-strong line-through decoration-danger/40 dark:text-danger-dark-strong">
                      {formatValue(prev[key])}
                    </td>
                    <td className="py-1.5 text-success-strong dark:text-success-dark-strong">
                      {formatValue(next[key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {Object.keys(extraMeta).length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Contexte</p>
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {Object.entries(extraMeta).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="text-text-secondary">{humanise(key)}:</dt>
                <dd className="min-w-0 break-words font-medium text-text-primary">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-text-secondary">
        {log.ip_address && (
          <span className="inline-flex items-center gap-1.5">
            <Globe size={12} /> {log.ip_address}
          </span>
        )}
        {log.user_agent && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Monitor size={12} />
            <span className="truncate" title={log.user_agent}>{log.user_agent}</span>
          </span>
        )}
        {log.entity_id && <span className="font-mono">ID {log.entity_id.slice(0, 8)}</span>}
      </div>
    </div>
  );
}

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState<NonNullable<AuditListParams["sortBy"]>>("created_at");
  const [sortDir, setSortDir] = useState<NonNullable<AuditListParams["sortDir"]>>("desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const limit = 20;

  // Search hits the server, so wait for a pause rather than firing per keystroke.
  const search = useDebouncedValue(searchInput, 350);

  const params = useMemo<AuditListParams>(
    () => ({ page, limit, entityType: entityFilter || undefined, actorUserId: actorFilter || undefined, search: search || undefined, from: from || undefined, to: to || undefined, sortBy, sortDir }),
    [page, entityFilter, actorFilter, search, from, to, sortBy, sortDir],
  );

  const { data, isPending, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => auditApi.list(params),
    // Holds the current rows while the next page resolves - no empty flash.
    placeholderData: keepPreviousData,
  });

  const { data: options } = useQuery({
    queryKey: ["audit-log-options"],
    queryFn: () => auditApi.options(),
    staleTime: 5 * 60_000,
  });

  const logs = data?.data ?? [];
  const meta = data?.meta;
  const hasFilters = Boolean(entityFilter || actorFilter || search || from || to);

  const resetFilters = useCallback(() => {
    setEntityFilter("");
    setActorFilter("");
    setSearchInput("");
    setFrom("");
    setTo("");
    setPage(1);
  }, []);

  const toggleSort = useCallback((column: NonNullable<AuditListParams["sortBy"]>) => {
    setSortBy((currentColumn) => {
      setSortDir((currentDir) => (currentColumn === column ? (currentDir === "asc" ? "desc" : "asc") : "desc"));
      return column;
    });
    setPage(1);
  }, []);

  const SortHeader = ({ column, children }: { column: NonNullable<AuditListParams["sortBy"]>; children: React.ReactNode }) => {
    const active = sortBy === column;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th scope="col" className="px-4 py-3 text-left">
        <button
          type="button"
          onClick={() => toggleSort(column)}
          aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
        >
          {children}
          <Icon size={12} className={active ? "text-primary" : "opacity-50"} />
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/dashboard" className="rounded transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200">
          {t("audit.dashboardBreadcrumb")}
        </Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span className="font-medium text-text-primary" aria-current="page">{t("audit.title")}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-card bg-primary-50 text-primary dark:bg-primary/15">
            <History size={20} />
          </div>
          <div>
            <h2 className="text-h4 font-bold text-text-primary">{t("audit.title")}</h2>
            <p className="text-xs text-text-secondary">{t("audit.subtitle")}</p>
          </div>
        </div>
        {meta && (
          <span className="rounded-full bg-neutral-soft px-3 py-1 text-xs font-medium text-text-secondary dark:bg-white/10">
            {meta.total.toLocaleString()} {meta.total === 1 ? "entrée" : "entrées"}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
              placeholder="Rechercher une action, une personne, une cible, une IP…"
              aria-label="Rechercher dans l'historique d'audit"
              className="input pl-9 pr-8 text-sm"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(""); setPage(1); }}
                aria-label="Effacer la recherche"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <select
            value={actorFilter}
            onChange={(e) => { setActorFilter(e.target.value); setPage(1); }}
            aria-label="Filtrer par administrateur"
            className="input w-auto min-w-[150px] text-sm"
          >
            <option value="">Tous les administrateurs</option>
            {options?.actors?.map((actor) => (
              <option key={actor.id} value={actor.id}>{actor.full_name}</option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            Du
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="input w-auto py-1.5 text-sm" aria-label="Date de début" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            Au
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="input w-auto py-1.5 text-sm" aria-label="Date de fin" />
          </label>

          {hasFilters && (
            <button type="button" onClick={resetFilters} className="btn btn-secondary px-3 py-1.5 text-xs">
              <X size={13} /> Effacer
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setEntityFilter(""); setPage(1); }}
            aria-pressed={!entityFilter}
            className={`btn px-4 py-1.5 text-xs ${!entityFilter ? "btn-primary" : "btn-secondary"}`}
          >
            {t("audit.all")}
          </button>
          {ENTITY_FILTERS.map((entity) => (
            <button
              key={entity}
              type="button"
              onClick={() => { setEntityFilter(entity); setPage(1); }}
              aria-pressed={entityFilter === entity}
              className={`btn px-4 py-1.5 text-xs ${entityFilter === entity ? "btn-primary" : "btn-secondary"}`}
            >
              {ENTITY_LABELS[entity] ?? entity}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <PageLoader text={t("common.loading", "Loading…")} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} isRetrying={isFetching} />
      ) : logs.length === 0 ? (
        <EmptyState
          message={hasFilters ? "Aucune entrée ne correspond à ces filtres." : t("audit.noEntries")}
          actionLabel={hasFilters ? "Effacer les filtres" : undefined}
          onAction={hasFilters ? resetFilters : undefined}
        />
      ) : (
        <>
          {/* Dimmed while a filter/page change is in flight, instead of blanking. */}
          <div className={`table-container overflow-x-auto transition-opacity ${isFetching ? "opacity-60" : "opacity-100"}`}>
            <table className="min-w-full text-sm">
              <caption className="sr-only">Historique d'audit administratif</caption>
              <thead>
                <tr className="bg-background">
                  <SortHeader column="action">{t("audit.action")}</SortHeader>
                  <SortHeader column="entity_type">{t("audit.entity")}</SortHeader>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-text-secondary">{t("audit.actor")}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-text-secondary">Cible</th>
                  <SortHeader column="created_at">{t("audit.date")}</SortHeader>
                  <th scope="col" className="w-10 px-2 py-3"><span className="sr-only">Détails</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => {
                  const isOpen = expanded === log.id;
                  const hasDetail =
                    Boolean(log.prev_values) || Boolean(log.new_values) || Boolean(log.ip_address) || Boolean(log.meta);
                  return (
                    <Fragment key={log.id}>
                      <tr
                        className={`transition-colors hover:bg-background/60 ${hasDetail ? "cursor-pointer" : ""}`}
                        onClick={() => hasDetail && setExpanded(isOpen ? null : log.id)}
                      >
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${toneFor(log.action)}`}>
                            {actionLabel(log.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {ENTITY_LABELS[log.entity_type] ?? log.entity_type}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-text-primary">
                            {log.actor?.full_name ?? log.actor_label ?? t("audit.system")}
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-text-secondary" title={log.entity_label ?? ""}>
                          {log.entity_label ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{formatDate(log.created_at)}</td>
                        <td className="px-2 py-3 text-right">
                          {hasDetail && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setExpanded(isOpen ? null : log.id); }}
                              aria-expanded={isOpen}
                              aria-label={isOpen ? "Masquer les détails" : "Afficher les détails"}
                              className="rounded p-1 text-text-secondary transition-transform hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
                            >
                              <ChevronDown size={15} className={isOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <ChangeDetail log={log} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-text-secondary">
                Showing {((page - 1) * limit) + 1}&ndash;{Math.min(page * limit, meta.total)} of {meta.total.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || isFetching}
                  className="btn btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft size={14} /> {t("audit.previous")}
                </button>
                <span className="text-xs text-text-secondary">Page {page} of {meta.totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={page >= meta.totalPages || isFetching}
                  className="btn btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
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
