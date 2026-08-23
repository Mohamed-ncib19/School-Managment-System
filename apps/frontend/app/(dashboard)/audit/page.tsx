"use client";

import { useState, useMemo, useCallback, Fragment } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  History,
  Search,
  X,
  Globe,
  Monitor,
  ShieldAlert,
  ShieldCheck,
  LogIn,
  LogOut,
  KeyRound,
  Wallet,
  FileUp,
  FileDown,
  GraduationCap,
  Layers,
  UserRound,
  Library,
  Users,
  UserCog,
  Database,
  CalendarDays,
  PenTool,
  DoorOpen,
  Clock,
  ClipboardCheck,
  Settings2,
  Network,
  Banknote,
  Activity,
  CheckCircle2,
  Archive,
  type LucideIcon,
} from "lucide-react";
import { auditApi, type AuditListParams } from "@/lib/api/audit.api";
import { Shimmer } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { BarChartSvg } from "@/components/charts/svg-charts";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, cn } from "@/lib/utils/format";
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
  "system.data-import": "Import de données",
  "system.data-export": "Export de données",
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
  schedule_entry: "Séance",
  classroom: "Salle",
  time_slot: "Créneau",
  working_hour: "Horaire",
  whiteboard: "Tableau blanc",
  attendance_sheet: "Feuille d'appel",
  hierarchy_configuration: "Configuration de hiérarchie",
  professor_compensation: "Rémunération",
  payroll_payment: "Paiement de salaire",
  payment_transaction: "Transaction",
  student_assignment: "Affectation",
  financial_settings: "Paramètres financiers",
  system_settings: "Paramètres système",
  student_schedule_exception: "Exception d'étudiant",
  schedule_entry_exception: "Exception de séance",
  audit_log: "Journal",
  system: "Système",
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

type Tone = "danger" | "success" | "warning" | "neutral";

/** Sign-in failures and deletions are the entries an auditor scans for. */
function toneOf(action: string): Tone {
  if (action.includes("failed") || action.includes("deleted")) return "danger";
  if (action.includes("created") || action.includes("restored") || action.includes("success")) return "success";
  if (action.includes("archived") || action.includes("deactivated")) return "warning";
  return "neutral";
}

const TONE_CLASSES: Record<Tone, string> = {
  danger: "bg-danger-soft text-danger-strong dark:bg-danger-dark-soft dark:text-danger-dark-strong",
  success: "bg-success-soft text-success-strong dark:bg-success-dark-soft dark:text-success-dark-strong",
  warning: "bg-warning-soft text-warning-strong dark:bg-warning-dark-soft dark:text-warning-dark-strong",
  neutral: "bg-neutral-soft text-neutral-strong dark:bg-white/10 dark:text-neutral-dark-strong",
};

const ACTION_ICONS: Record<string, LucideIcon> = {
  "auth.login_success": LogIn,
  "auth.login_failed": ShieldAlert,
  "auth.logout": LogOut,
  "auth.change_password_success": KeyRound,
  "auth.change_password_failed": KeyRound,
  "payment.recorded": Wallet,
  "payment.status_changed": Wallet,
  "import.students": FileUp,
  "student.created": GraduationCap,
  "student.updated": GraduationCap,
  "student.status_changed": GraduationCap,
  "student.moved_group": GraduationCap,
  "student.deleted": GraduationCap,
  "backup.created": Database,
  "backup.restored": Database,
  "system.data-import": FileUp,
  "system.data-export": FileDown,
};

const PREFIX_ICONS: Record<string, LucideIcon> = {
  auth: ShieldCheck,
  payment: Wallet,
  import: FileUp,
  student: GraduationCap,
  field: Layers,
  professor: UserRound,
  level: Library,
  group: Users,
  user: UserCog,
  backup: Database,
  schedule: CalendarDays,
  classroom: DoorOpen,
  time_slot: Clock,
  attendance: ClipboardCheck,
  whiteboard: PenTool,
  setting: Settings2,
  hierarchy: Network,
  payroll: Banknote,
};

const actionIcon = (action: string): LucideIcon =>
  ACTION_ICONS[action] ?? PREFIX_ICONS[action.split(".")[0]] ?? Activity;

/** Human labels for the internal field names stored in prev/new values. */
const FIELD_LABELS: Record<string, string> = {
  full_name: "Nom complet",
  name: "Nom",
  first_name: "Prénom",
  last_name: "Nom",
  phone: "Téléphone",
  parent_phone: "Téléphone parent",
  email: "E-mail",
  monthly_fee: "Frais mensuels",
  enrollment_date: "Date d'inscription",
  status: "Statut",
  is_active: "Actif",
  description: "Description",
  capacity: "Capacité",
  color: "Couleur",
  notes: "Notes",
  group_id: "Classe",
  field_id: "Filière",
  prof_id: "Professeur",
  level_id: "Niveau",
  percentage: "Pourcentage",
  fixed_amount: "Montant fixe",
  model: "Modèle",
  custom_formula: "Formule personnalisée",
  amount_due: "Montant dû",
  due_date: "Échéance",
  paid_amount: "Montant payé",
  paid_at: "Payé le",
  payment_method: "Méthode de paiement",
  receipt_number: "N° de reçu",
  period: "Période",
  start_time: "Début",
  end_time: "Fin",
  day_of_week: "Jour",
  subject: "Matière",
  classroom_id: "Salle",
  time_slot_id: "Créneau",
  effective_from: "À partir du",
  effective_until: "Jusqu'au",
  building: "Bâtiment",
  floor: "Étage",
  room_number: "N° de salle",
  equipment: "Équipement",
  exception_type: "Type d'exception",
  exception_date: "Date",
  student_id: "Étudiant",
  schedule_entry_id: "Séance",
  title: "Titre",
  is_default: "Par défaut",
  entity_order: "Ordre des entités",
  compensation_model: "Modèle",
  schedule_notes: "Notes de planning",
  academy_name: "Nom de l'académie",
  currency: "Devise",
  reason: "Raison",
  amount: "Montant",
  created_at: "Créé le",
  updated_at: "Modifié le",
  imported: "Contenu importé",
  fileName: "Fichier",
  file: "Fichier",
  exportedAt: "Exporté le",
  sourceVersion: "Version du fichier",
};

/**
 * French labels for the data-transfer table keys recorded in an import's
 * `imported` meta — the same labels the export preview uses, so the audit
 * trail reads like the screen that performed the import.
 */
const TABLE_LABELS: Record<string, string> = {
  levels: "Niveaux",
  users: "Utilisateurs",
  fields: "Filières",
  professors: "Professeurs",
  groups: "Groupes",
  students: "Étudiants",
  student_assignments: "Inscriptions",
  time_slots: "Créneaux horaires",
  classrooms: "Salles",
  working_hours: "Horaires de travail",
  hierarchy_configurations: "Configurations de navigation",
  professor_compensations: "Rémunérations",
  student_payments: "Paiements étudiants",
  payment_transactions: "Transactions",
  payroll_payments: "Paiements professeurs",
  payroll_documents: "Documents de paie",
  schedule_entries: "Séances d'emploi du temps",
  student_schedule_exceptions: "Exceptions d'élèves",
  schedule_entry_exceptions: "Exceptions de séances",
  attendance_sheets: "Feuilles de présence",
  whiteboards: "Tableaux blancs",
  receipt_counters: "Compteurs de reçus",
  financial_settings: "Paramètres financiers",
  system_settings: "Paramètres système",
};

/** Enum-ish stored values that read better in French than as raw keys. */
const STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  paused: "En pause",
  withdrawn: "Retiré",
  paid: "Payé",
  not_paid: "Non payé",
  due_soon: "Échéance proche",
  overdue: "En retard",
  partially_paid: "Partiellement payé",
  cancelled: "Annulé",
  percentage: "Pourcentage",
  fixed_salary: "Salaire fixe",
  fixed_per_student: "Fixe par étudiant",
  fixed_per_group: "Fixe par groupe",
  hybrid: "Hybride",
  custom: "Personnalisé",
  cash: "Espèces",
  refund: "Remboursement",
  correction: "Correction",
  substitute: "Remplaçant",
  makeup: "Rattrapage",
  moved: "Déplacé",
  substitute_prof: "Professeur remplaçant",
  room_change: "Changement de salle",
};

const fieldLabel = (key: string) => FIELD_LABELS[key] ?? humanise(key);

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "string") {
    // ISO timestamps render as dates; known enum values as French labels.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDate(value);
    if (STATUS_LABELS[value]) return STATUS_LABELS[value];
    return value;
  }
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    return json.length > 120 ? `${json.slice(0, 120)}…` : json;
  }
  return String(value);
};

const deepEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A plain `{ key: count }` object (e.g. an import's `imported` meta). */
const isCountRecord = (value: unknown): value is Record<string, number> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(([, v]) => typeof v === "number");
};

/**
 * Friendly rendering of a per-table row count (import results) as labelled
 * pills with a running total — instead of a raw JSON blob in the trail.
 */
function CountBreakdown({ counts, showTotal = true }: { counts: Record<string, number>; showTotal?: boolean }) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) return <span className="text-text-secondary">—</span>;
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {entries.map(([key, count]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface px-2 py-0.5 text-xs text-text-primary"
        >
          <span className="font-semibold tabular-nums">{count}</span>
          <span className="text-text-secondary">{TABLE_LABELS[key] ?? humanise(key)}</span>
        </span>
      ))}
      {showTotal && (
        <span className="text-xs font-medium text-text-secondary">
          {total} {total === 1 ? "élément" : "éléments"} au total
        </span>
      )}
    </span>
  );
}

/** Only the fields whose value actually changed, not the whole snapshot. */
const changedKeys = (prev: Record<string, unknown>, next: Record<string, unknown>) =>
  Array.from(new Set([...Object.keys(prev), ...Object.keys(next)])).filter(
    (key) => !deepEqual(prev[key], next[key]),
  );

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const relativeTimeFormatter = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

const relativeTime = (date: Date): string => {
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return "à l'instant";
  if (abs < 3_600_000) return relativeTimeFormatter.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return relativeTimeFormatter.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 7 * 86_400_000) return relativeTimeFormatter.format(Math.round(diff / 86_400_000), "day");
  return formatDate(date);
};

const exactDateTime = (date: Date) =>
  date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function dayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.getTime() === today.getTime()) return "Aujourd'hui";
  if (d.getTime() === yesterday.getTime()) return "Hier";
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
  if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  const label = d.toLocaleDateString("fr-FR", opts);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const actorName = (log: AuditLog) => log.actor?.full_name ?? log.actor_label ?? "Système";

/** Before/after pairs for one entry, falling back to meta when there is no diff. */
function EntryDetails({ log }: { log: AuditLog }) {
  const prev = (log.prev_values ?? {}) as Record<string, unknown>;
  const next = (log.new_values ?? {}) as Record<string, unknown>;
  const keys = changedKeys(prev, next);

  const extraMeta =
    log.meta && typeof log.meta === "object" ? { ...(log.meta as Record<string, unknown>) } : {};
  delete extraMeta.changed_fields;
  const metaEntries = Object.entries(extraMeta);

  return (
    <div className="space-y-4 border-t border-border bg-background/50 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
        <span>
          Par <span className="font-medium text-text-primary">{actorName(log)}</span>
        </span>
        <time dateTime={log.created_at} className="tabular-nums">
          {exactDateTime(new Date(log.created_at))}
        </time>
        {log.ip_address && (
          <span className="inline-flex items-center gap-1.5">
            <Globe size={12} /> {log.ip_address}
          </span>
        )}
        {log.entity_id && <span className="font-mono">ID {log.entity_id.slice(0, 8)}…</span>}
      </div>

      {keys.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Modifications</p>
          <div className="overflow-x-auto rounded-card border border-border/60">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-background text-left text-text-secondary">
                  <th className="px-3 py-2 font-medium">Champ</th>
                  <th className="px-3 py-2 font-medium">Avant</th>
                  <th className="px-3 py-2 font-medium">Après</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {keys.map((key) => (
                  <tr key={key}>
                    <td className="px-3 py-2 font-medium text-text-primary">{fieldLabel(key)}</td>
                    <td className="px-3 py-2 text-danger-strong line-through decoration-danger/40 dark:text-danger-dark-strong">
                      {formatValue(prev[key])}
                    </td>
                    <td className="px-3 py-2 text-success-strong dark:text-success-dark-strong">
                      {formatValue(next[key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {keys.length === 0 && metaEntries.length === 0 && (
        <p className="text-xs text-text-secondary">Aucune modification détaillée enregistrée pour cet événement.</p>
      )}

      {metaEntries.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Contexte</p>
          <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {metaEntries.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="shrink-0 text-text-secondary">{fieldLabel(key)}:</dt>
                <dd className="min-w-0 break-words font-medium text-text-primary">
                  {isCountRecord(value) ? <CountBreakdown counts={value} /> : formatValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {log.user_agent && (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
          <Monitor size={12} className="shrink-0" />
          <span className="truncate" title={log.user_agent}>
            {log.user_agent}
          </span>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-primary shadow-dropdown">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Retirer le filtre ${label}`}
        className="rounded-full p-0.5 text-text-secondary transition-colors hover:text-danger-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
      >
        <X size={12} />
      </button>
    </span>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: Tone;
}) {
  return (
    <div className="card flex items-center gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-card ${TONE_CLASSES[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-text-secondary">{label}</p>
        <p className="text-lg font-bold tabular-nums text-text-primary">{value.toLocaleString("fr-FR")}</p>
      </div>
    </div>
  );
}

/** Feed-shaped loading placeholder, mirroring the rows it replaces. */
function FeedSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Shimmer className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Shimmer className="h-4 w-2/3" />
            <Shimmer className="h-3 w-1/3" />
          </div>
          <Shimmer className="h-4 w-6" />
        </div>
      ))}
    </div>
  );
}

type PresetKey = "all" | "today" | "7d" | "30d" | "custom";

const DATE_PRESETS: { key: Exclude<PresetKey, "custom">; label: string }[] = [
  { key: "all", label: "Toute période" },
  { key: "today", label: "Aujourd'hui" },
  { key: "7d", label: "7 derniers jours" },
  { key: "30d", label: "30 derniers jours" },
];

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [preset, setPreset] = useState<PresetKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const limit = 20;

  // Search hits the server, so wait for a pause rather than firing per keystroke.
  const search = useDebouncedValue(searchInput, 350);

  const applyPreset = useCallback((key: PresetKey) => {
    setPreset(key);
    if (key === "all") {
      setFrom("");
      setTo("");
    } else if (key === "today") {
      setFrom(isoDate(new Date()));
      setTo("");
    } else if (key === "7d") {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      setFrom(isoDate(d));
      setTo("");
    } else if (key === "30d") {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      setFrom(isoDate(d));
      setTo("");
    }
    setPage(1);
  }, []);

  const params = useMemo<AuditListParams>(
    () => ({
      page,
      limit,
      entityType: entityFilter || undefined,
      actorUserId: actorFilter || undefined,
      action: actionFilter || undefined,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [page, entityFilter, actorFilter, actionFilter, search, from, to],
  );

  const { data, isPending, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => auditApi.list(params),
    // Holds the current rows while the next page resolves - no empty flash.
    placeholderData: keepPreviousData,
    refetchInterval: live ? 30_000 : false,
  });

  const { data: options } = useQuery({
    queryKey: ["audit-log-options"],
    queryFn: () => auditApi.options(),
    staleTime: 5 * 60_000,
  });

  const summaryParams = useMemo<AuditListParams>(
    () => ({
      entityType: entityFilter || undefined,
      actorUserId: actorFilter || undefined,
      action: actionFilter || undefined,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [entityFilter, actorFilter, actionFilter, search, from, to],
  );

  const { data: summary } = useQuery({
    queryKey: ["audit-summary", summaryParams],
    queryFn: () => auditApi.summary(summaryParams),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: live ? 30_000 : false,
  });

  const logs = data?.data ?? [];
  const meta = data?.meta;
  const hasFilters = Boolean(entityFilter || actorFilter || actionFilter || search || from || to || preset !== "all");

  const stats = useMemo(() => {
    const counts: Record<Tone, number> = { danger: 0, success: 0, warning: 0, neutral: 0 };
    for (const { action, count } of summary?.byAction ?? []) counts[toneOf(action)] += count;
    return counts;
  }, [summary]);

  const resetFilters = useCallback(() => {
    setEntityFilter("");
    setActorFilter("");
    setActionFilter("");
    setSearchInput("");
    applyPreset("all");
    setPage(1);
  }, [applyPreset]);

  const clearOne = useCallback((setter: (v: string) => void) => {
    setter("");
    setPage(1);
  }, []);

  // Group the page's rows by local day so the feed reads as "Aujourd'hui", "Hier", ...
  const groups = useMemo(() => {
    const map = new Map<string, AuditLog[]>();
    for (const log of logs) {
      const key = isoDate(new Date(log.created_at));
      const bucket = map.get(key);
      if (bucket) bucket.push(log);
      else map.set(key, [log]);
    }
    return Array.from(map.entries());
  }, [logs]);

  const chartData = (summary?.series ?? []).map(({ day, count }) => ({
    label: day.slice(5).split("-").reverse().join("/"),
    value: count,
  }));

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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            aria-pressed={live}
            title="Recharger automatiquement toutes les 30 secondes"
            className={cn(
              "btn btn-secondary px-3 py-1.5 text-xs transition-colors",
              live && "border-primary/40 text-primary",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                live ? "animate-pulse bg-primary" : "bg-text-secondary/50",
              )}
              aria-hidden="true"
            />
            {live ? "En direct" : "Actualisation auto"}
          </button>
          {meta && (
            <span className="rounded-full bg-neutral-soft px-3 py-1 text-xs font-medium text-text-secondary dark:bg-white/10">
              {meta.total.toLocaleString("fr-FR")} {meta.total === 1 ? "entrée" : "entrées"}
            </span>
          )}
        </div>
      </div>

      {/* Overview: tone buckets + daily activity, always answering the current filters. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<History size={18} />} label="Entrées" value={summary?.total ?? meta?.total ?? 0} tone="neutral" />
        <StatTile icon={<ShieldAlert size={18} />} label="Échecs & suppressions" value={stats.danger} tone="danger" />
        <StatTile icon={<CheckCircle2 size={18} />} label="Créations & succès" value={stats.success} tone="success" />
        <StatTile icon={<Archive size={18} />} label="Archivages & alertes" value={stats.warning} tone="warning" />
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h3 className="text-sm font-semibold text-text-primary">Activité quotidienne</h3>
          <span className="text-xs text-text-secondary">30 derniers jours (selon les filtres)</span>
        </div>
        {summary ? (
          <div className="px-2 pb-3">
            <BarChartSvg
              data={chartData}
              height={130}
              formatValue={(v) => `${v} ${v === 1 ? "entrée" : "entrées"}`}
              formatTick={(v) => String(v)}
              ariaLabel="Nombre d'entrées d'audit par jour"
            />
          </div>
        ) : (
          <div className="flex h-[130px] items-end gap-1.5 px-4 pb-3" aria-hidden="true">
            {Array.from({ length: 30 }).map((_, i) => (
              <Shimmer key={i} className="flex-1 rounded-t" style={{ height: `${18 + ((i * 7) % 60)}%` }} />
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3 p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
          <div className="relative">
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
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            aria-label="Filtrer par action"
            className="input w-full text-sm"
          >
            <option value="">Toutes les actions</option>
            {(options?.actions ?? []).map((action) => (
              <option key={action} value={action}>{actionLabel(action)}</option>
            ))}
          </select>

          <select
            value={actorFilter}
            onChange={(e) => { setActorFilter(e.target.value); setPage(1); }}
            aria-label="Filtrer par administrateur"
            className="input w-full text-sm"
          >
            <option value="">Tous les administrateurs</option>
            {(options?.actors ?? []).map((actor) => (
              <option key={actor.id} value={actor.id}>{actor.full_name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {DATE_PRESETS.map((presetOption) => (
            <button
              key={presetOption.key}
              type="button"
              onClick={() => applyPreset(presetOption.key)}
              aria-pressed={preset === presetOption.key}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                preset === presetOption.key
                  ? "border-primary/40 bg-primary/10 font-semibold text-primary dark:bg-primary/15"
                  : "border-transparent text-text-secondary hover:bg-black/[0.04] hover:text-text-primary dark:hover:bg-white/[0.06]",
              )}
            >
              {presetOption.label}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            Du
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPreset("custom"); setPage(1); }}
              className="input w-auto py-1.5 text-sm"
              aria-label="Date de début"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            Au
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPreset("custom"); setPage(1); }}
              className="input w-auto py-1.5 text-sm"
              aria-label="Date de fin"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setEntityFilter(""); setPage(1); }}
            aria-pressed={!entityFilter}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              !entityFilter
                ? "bg-surface text-text-primary border-border shadow-dropdown font-semibold"
                : "border-transparent text-text-secondary hover:bg-black/[0.04] hover:text-text-primary dark:hover:bg-white/[0.06]",
            )}
          >
            {t("audit.all")}
          </button>
          {ENTITY_FILTERS.map((entity) => (
            <button
              key={entity}
              type="button"
              onClick={() => { setEntityFilter(entity); setPage(1); }}
              aria-pressed={entityFilter === entity}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                entityFilter === entity
                  ? "bg-surface text-text-primary border-border shadow-dropdown font-semibold"
                  : "border-transparent text-text-secondary hover:bg-black/[0.04] hover:text-text-primary dark:hover:bg-white/[0.06]",
              )}
            >
              {ENTITY_LABELS[entity] ?? entity}
            </button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          {hasFilters ? (
            <button type="button" onClick={resetFilters} className="btn btn-secondary px-3 py-1.5 text-xs">
              <X size={13} /> Tout effacer
            </button>
          ) : (
            <span className="text-xs text-text-secondary">Aucun filtre actif</span>
          )}
        </div>

        {hasFilters && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
            {entityFilter && (
              <FilterChip label={ENTITY_LABELS[entityFilter] ?? entityFilter} onClear={() => clearOne(setEntityFilter)} />
            )}
            {actionFilter && <FilterChip label={actionLabel(actionFilter)} onClear={() => clearOne(setActionFilter)} />}
            {actorFilter && (
              <FilterChip
                label={options?.actors.find((a) => a.id === actorFilter)?.full_name ?? "Acteur"}
                onClear={() => clearOne(setActorFilter)}
              />
            )}
            {search && <FilterChip label={`« ${search} »`} onClear={() => clearOne(setSearchInput)} />}
            {(from || to) && (
              <FilterChip
                label={from && to ? `Du ${from} au ${to}` : from ? `Depuis le ${from}` : `Jusqu'au ${to}`}
                onClear={() => { setFrom(""); setTo(""); setPreset("all"); setPage(1); }}
              />
            )}
          </div>
        )}
      </div>

      {isPending ? (
        <FeedSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} isRetrying={isFetching} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<History size={24} />}
          message={hasFilters ? "Aucune entrée ne correspond à ces filtres." : t("audit.noEntries")}
          actionLabel={hasFilters ? "Effacer les filtres" : undefined}
          onAction={hasFilters ? resetFilters : undefined}
        />
      ) : (
        <>
          {/* Dimmed while a filter/page change is in flight, instead of blanking. */}
          <div className={`card overflow-hidden transition-opacity ${isFetching ? "opacity-60" : "opacity-100"}`}>
            {groups.map(([day, items]) => (
              <Fragment key={day}>
                <div className="flex items-center gap-2 bg-background/70 px-4 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{dayLabel(day)}</span>
                  <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-[10px] font-medium text-text-secondary dark:bg-white/10">
                    {items.length}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {items.map((log) => {
                    const isOpen = expanded === log.id;
                    const tone = toneOf(log.action);
                    const Icon = actionIcon(log.action);
                    const hasDetail =
                      Boolean(log.prev_values) || Boolean(log.new_values) || Boolean(log.ip_address) || Boolean(log.meta);
                    const toggle = () => hasDetail && setExpanded(isOpen ? null : log.id);

                    return (
                      <Fragment key={log.id}>
                        <div
                          role={hasDetail ? "button" : undefined}
                          tabIndex={hasDetail ? 0 : undefined}
                          aria-expanded={hasDetail ? isOpen : undefined}
                          onClick={toggle}
                          onKeyDown={
                            hasDetail
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggle();
                                  }
                                }
                              : undefined
                          }
                          className={`px-4 py-3 transition-colors sm:px-6 ${hasDetail ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-200 hover:bg-background/60" : ""}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE_CLASSES[tone]}`}>
                              <Icon size={16} aria-hidden="true" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm leading-snug">
                                <span className="font-semibold text-text-primary">{actorName(log)}</span>
                                <span className="mx-1.5 text-text-secondary/60">·</span>
                                <span className="text-text-primary">{actionLabel(log.action)}</span>
                                {log.entity_label && (
                                  <>
                                    <span className="mx-1.5 text-text-secondary/60">·</span>
                                    <span className="font-medium text-text-primary" title={log.entity_label}>
                                      {log.entity_label}
                                    </span>
                                  </>
                                )}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                                <span className="rounded-full bg-neutral-soft px-2 py-0.5 font-medium text-text-secondary dark:bg-white/10">
                                  {ENTITY_LABELS[log.entity_type] ?? log.entity_type}
                                </span>
                                {log.meta && isCountRecord(log.meta.imported) && (
                                  <CountBreakdown counts={log.meta.imported} showTotal={false} />
                                )}
                                <time dateTime={log.created_at} title={exactDateTime(new Date(log.created_at))}>
                                  {relativeTime(new Date(log.created_at))}
                                </time>
                                {hasDetail && (
                                  <span className="font-medium text-primary">
                                    {isOpen ? "Masquer les détails" : "Voir les détails"}
                                  </span>
                                )}
                              </div>
                            </div>
                            {hasDetail && (
                              <ChevronDown
                                size={15}
                                aria-hidden="true"
                                className={cn(
                                  "mt-1 shrink-0 text-text-secondary transition-transform",
                                  isOpen && "rotate-180",
                                )}
                              />
                            )}
                          </div>
                        </div>
                        {isOpen && <EntryDetails log={log} />}
                      </Fragment>
                    );
                  })}
                </div>
              </Fragment>
            ))}
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-text-secondary">
                {t("audit.showing")
                  .replace("{start}", String((page - 1) * limit + 1))
                  .replace("{end}", String(Math.min(page * limit, meta.total)))
                  .replace("{total}", meta.total.toLocaleString("fr-FR"))}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || isFetching}
                  className="btn btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft size={14} /> {t("audit.previous")}
                </button>
                <span className="text-xs text-text-secondary">{t("audit.pageOf").replace("{page}", String(page)).replace("{totalPages}", String(meta.totalPages))}</span>
                <button
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={page >= meta.totalPages || isFetching}
                  className="btn btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("audit.next")} <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}