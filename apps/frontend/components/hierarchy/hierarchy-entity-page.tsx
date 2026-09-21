"use client";

import { useState, useMemo, Fragment, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Printer,
  Layers,
  BookOpen,
  UserCheck,
  Users,
  DollarSign,
  Check,
  Search,
  X,
  Eye,
} from "lucide-react";
import { levelsApi } from "@/lib/api/levels.api";
import { fieldsApi } from "@/lib/api/fields.api";
import { professorsApi } from "@/lib/api/professors.api";
import { groupsApi } from "@/lib/api/groups.api";
import { studentsApi } from "@/lib/api/students.api";
import { schedulingApi, openStudentTimetable } from "@/lib/api/scheduling.api";
import { useGenerateInvoiceForStudent } from "@/hooks/use-financial";
import { useStudentPage } from "@/hooks/use-queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useHierarchyConfig, type HierarchyEntity } from "@/hooks/use-hierarchy-config";
import { useViewMode } from "@/hooks/use-view-mode";
import { useClassrooms } from "@/hooks/use-scheduling";
import type { Level, Field, Professor, Group, Student, StudentStatus, TileDto, ScheduleEntry } from "@/types";
import { PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewToggle } from "@/components/shared/view-toggle";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import DeletedEntities from "@/components/hierarchy/deleted-entities";
import HierarchyDeleteDialog from "@/components/hierarchy/hierarchy-delete-dialog";
import StudentDetailModal from "@/components/shared/student-detail-modal";
import { useTranslation } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils/format";
import { useToast } from "@/components/shared/toast";
import { normalizeTunisianPhone, stripTunisiaPrefix } from "@/lib/utils/phone";
import { PhoneInput } from "@/components/ui/phone-input";
import ColorPicker from "@/components/forms/color-picker";
import Tooltip from "@/components/shared/tooltip";
import { describeError } from "@/components/shared/error-state";
import AssignmentSlotsPicker, {
  emptyAssignmentSlot,
  type AssignmentSlot,
} from "@/components/hierarchy/assignment-slots-picker";
import { WeeklyScheduleBuilder } from "@/components/scheduling/weekly-schedule-builder";

const DAY_SHORT = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];

/** Rows per page for the server-paged student list. */
const PAGE_SIZE = 50;

const ENTITY_ICONS: Record<HierarchyEntity, any> = {
  level: Layers,
  field: BookOpen,
  professor: UserCheck,
  group: Users,
  student: Users,
};

/**
 * Parent layers each entity type must climb in the create modal when no
 * parent is pinned by the URL: the first layer is always a level, the last
 * one is the direct parent of the entity being created.
 */
const PARENT_LAYERS: Partial<Record<HierarchyEntity, HierarchyEntity[]>> = {
  field: ["level"],
  professor: ["level", "field"],
  group: ["level", "field", "professor"],
  student: ["level", "field", "professor", "group"],
};

interface HierarchyEntityPageProps {
  entityType: HierarchyEntity;
  /** Pre-parsed entity IDs from catch-all route (when used with [...params]) */
  parsedEntityIds?: Record<string, string>;
}

/**
 * The student's placement chain(s): level > field, with the professor (and
 * group) revealed on hover over the field. A student registered in several
 * groups gets one chain per enrollment (e.g. two fields of the same level),
 * each field tagged with its hierarchy color. Used wherever a mixed student
 * list makes the assignment impossible to guess (e.g. /hierarchy/student).
 */
function StudentChain({ student }: { student: any }) {
  const { t } = useTranslation();

  const chainOf = (placement: any) => {
    const field = placement?.group?.professor?.field;
    return {
      levelName: field?.level?.name,
      fieldName: field?.name,
      fieldColor: field?.color ?? null,
      professor: placement?.group?.professor?.full_name,
      group: placement?.group?.name,
    };
  };

  // Prefer the explicit enrollment list; fall back to the primary group for
  // payloads that predate the join table.
  const placements: any[] = student?.assignments?.length
    ? student.assignments
    : student?.group
      ? [student]
      : [];
  const chains = placements.map(chainOf);
  const visible = chains.filter((c) => c.levelName || c.fieldName);
  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-1 text-xs text-text-secondary flex-wrap">
      <Layers size={12} className="shrink-0" />
      {chains.map((chain, i) => {
        if (!chain.levelName && !chain.fieldName) return null;
        const tooltip = [
          chain.professor ? `${t("studentDetail.professor", "Professor")}: ${chain.professor}` : null,
          chain.group ? `${t("studentDetail.group", "Group")}: ${chain.group}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Fragment key={i}>
            {i > 0 && <span className="text-text-tertiary">+</span>}
            <span className="flex items-center gap-1">
              {chain.fieldColor && (
                <span
                  className="inline-block size-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: chain.fieldColor }}
                  title={t("hierarchy.color", "Color")}
                />
              )}
              {chain.levelName && <span className="font-medium text-text-primary">{chain.levelName}</span>}
              {chain.levelName && chain.fieldName && <ChevronRight size={12} className="shrink-0" />}
              {chain.fieldName &&
                (tooltip ? (
                  <Tooltip text={tooltip}>
                    <span className="cursor-help underline decoration-dotted underline-offset-2 hover:text-primary transition-colors">
                      {chain.fieldName}
                    </span>
                  </Tooltip>
                ) : (
                  <span>{chain.fieldName}</span>
                ))}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * The direct children of a hierarchy entity, shown like the assignment chips
 * on a student card: a group lists its students, a professor his groups, a
 * field its professors. Capped at `limit` chips so a full roster stays compact.
 */
function ChildChips({ items, limit = 5 }: { items: string[]; limit?: number }) {
  if (!items.length) return null;
  const visible = items.slice(0, limit);
  const rest = items.length - visible.length;
  return (
    <div className="flex items-center gap-1 text-xs text-text-secondary flex-wrap">
      {visible.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-2 py-0.5"
        >
          {name}
        </span>
      ))}
      {rest > 0 && <span className="text-text-tertiary">+{rest}</span>}
    </div>
  );
}

export default function HierarchyEntityPage({ entityType: entityTypeProp, parsedEntityIds }: HierarchyEntityPageProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { entityOrder, getEntityLabel, getNextEntity } = useHierarchyConfig();
  const { viewMode, setViewMode } = useViewMode("cards");
  const generatePayment = useGenerateInvoiceForStudent();
  const entityType = entityTypeProp;

  /**
   * Timetable clashes get their own dialog rather than a toast: the user has to
   * be able to read which class is in the way, and — when it is only a
   * professor or student overlap — decide to go ahead anyway.
   */
  /** Opens the student's weekly timetable, whichever groups they belong to. */
  const printTimetable = (studentId: string) => {
    openStudentTimetable(studentId).catch((err) => {
      if ((err as Error)?.message === "popup-blocked") {
        toast.error(
          t("common.popupBlockedTitle", "Fenêtre bloquée"),
          t("common.popupBlocked", "Autorisez les fenêtres contextuelles pour imprimer."),
        );
        return;
      }
      const { title, detail } = describeError(err);
      toast.error(title, detail);
    });
  };

  const showError = (err: unknown) => {
    const body = (err as any)?.response?.data?.error ?? (err as any)?.response?.data;
    const code = body?.code;
    if (code === "CLASSROOM_UNAVAILABLE" || code === "SCHEDULE_CONFLICT") {
      setScheduleClash({
        blocking: code === "CLASSROOM_UNAVAILABLE",
        conflicts: body?.conflicts ?? [],
      });
      return;
    }
    const { title, detail } = describeError(err);
    toast.error(title, detail);
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEntity, setEditingEntity] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: HierarchyEntity; id: string; name: string } | null>(null);
  /** A server refusal shown inside the delete dialog rather than as a toast. */
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /**
   * A save the server refused because of a timetable clash.
   *
   * `blocking` is a double-booked classroom, which cannot be overridden — only
   * one class can be in a room. Anything else is a professor or student overlap,
   * which the user may knowingly accept.
   */
  const [scheduleClash, setScheduleClash] = useState<
    { blocking: boolean; conflicts: { type: string; entityName: string; timeSlotLabel: string }[] } | null
  >(null);
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false);
  /** Layers confirmed so far in the create cascade: [{type, id, name}]. */
  const [parentPath, setParentPath] = useState<Array<{ type: HierarchyEntity; id: string; name: string }>>([]);

  /**
   * Student enrollments: one chain (level > field > professor > group) per
   * slot; slot 0 is the primary (billing) group.
   */
  const [assignmentSlots, setAssignmentSlots] = useState<AssignmentSlot[]>([emptyAssignmentSlot()]);

  // Common form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");

  // Student-specific form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState(new Date().toISOString().split("T")[0]);
  const [formStatus, setFormStatus] = useState<StudentStatus>("active");
  // Group-specific form state

  const [formCapacity, setFormCapacity] = useState("");

  const [formTiles, setFormTiles] = useState<TileDto[]>([]);
  /**
   * Whether the schedule builder has been touched this session.
   *
   * Needed to tell "the user cleared every session" from "the user never
   * opened the schedule section" — both leave `formTiles` empty, but only the
   * first should wipe the group's saved times.
   */
  const [tilesTouched, setTilesTouched] = useState(false);
  /** Raised by the schedule builder when a tile breaks a rule the API refuses. */
  const [scheduleBlocked, setScheduleBlocked] = useState(false);
  /** Professor/student clashes the user has been shown and chosen to accept. */
  const [acceptedConflicts, setAcceptedConflicts] = useState(false);

  /**
   * The sessions a group already has, mapped back into builder tiles.
   *
   * Without this the edit form opened empty and every save appended a second
   * copy of the timetable — the group's real times were never in the form to
   * begin with.
   */
  const editingGroupTiles = useQuery({
    queryKey: ["scheduling", "entries", "group-edit", editingId],
    enabled: entityType === "group" && !!editingId && createOpen,
    queryFn: async (): Promise<TileDto[]> => {
      const entries = await schedulingApi.entries.list({ groupId: editingId!, active: true });
      return (entries ?? [])
        .filter((entry: ScheduleEntry) => entry.time_slot)
        .map((entry: ScheduleEntry) => ({
          day_of_week: entry.time_slot.day_of_week,
          start_time: entry.time_slot.start_time.slice(0, 5),
          end_time: entry.time_slot.end_time.slice(0, 5),
          classroom_id: entry.classroom_id ?? null,
        }));
    },
  });


  const { data: classrooms } = useClassrooms();
  // Accent color + list controls
  const [formColor, setFormColor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "nameAsc" | "nameDesc" | "color">("newest");
  const [page, setPage] = useState(1);
  // Only the paged list sends the term to the server; the client-side lists
  // read `search` directly, so debouncing costs them nothing.
  const debouncedSearch = useDebouncedValue(search, 300);
  // Student list filters: level > field > professor > group cascade, matching
  // the assignment picker. A student matches when at least one of his chains
  // satisfies every selected filter.
  const [filterLevel, setFilterLevel] = useState("");
  const [filterField, setFilterField] = useState("");
  const [filterProf, setFilterProf] = useState("");
  const [filterGroup, setFilterGroup] = useState("");

  const filterHasActive = !!(filterLevel || filterField || filterProf || filterGroup);

  const filterLevelOptions = useQuery({
    queryKey: ["levels"],
    queryFn: () => levelsApi.list(),
  });
  const filterFieldOptions = useQuery({
    queryKey: ["filter-fields", filterLevel],
    queryFn: () => fieldsApi.list(filterLevel),
    enabled: !!filterLevel,
  });
  const filterProfOptions = useQuery({
    queryKey: ["filter-professors", filterField],
    queryFn: () => professorsApi.list(filterField),
    enabled: !!filterField,
  });
  const filterGroupOptions = useQuery({
    queryKey: ["filter-groups", filterProf],
    queryFn: () => groupsApi.list(filterProf),
    enabled: !!filterProf,
  });

  const changeFilterLevel = (v: string) => {
    setFilterLevel(v);
    setFilterField("");
    setFilterProf("");
    setFilterGroup("");
  };
  const changeFilterField = (v: string) => {
    setFilterField(v);
    setFilterProf("");
    setFilterGroup("");
  };
  const changeFilterProf = (v: string) => {
    setFilterProf(v);
    setFilterGroup("");
  };

  // Extract entity IDs from URL params
  const entityIds = useMemo(() => {
    // If pre-parsed IDs are provided (from catch-all route), use those
    if (parsedEntityIds) return parsedEntityIds;
    
    // Otherwise fall back to named params (from legacy individual routes)
    const ids: Record<string, string> = {};
    if (params.levelId) ids.levelId = params.levelId as string;
    if (params.fieldId) ids.fieldId = params.fieldId as string;
    if (params.profId) ids.profId = params.profId as string;
    if (params.groupId) ids.groupId = params.groupId as string;
    if (params.studentId) ids.studentId = params.studentId as string;
    return ids;
  }, [params, parsedEntityIds]);

  // Get parent entity ID for filtering
  const parentId = useMemo(() => {
    switch (entityType) {
      case "field": return entityIds.levelId;
      case "professor": return entityIds.fieldId;
      case "group": return entityIds.profId;
      case "student": return entityIds.groupId;
      default: return undefined;
    }
  }, [entityType, entityIds]);

  /**
   * Creation always needs the parent: level > field > professor > group >
   * student. When the URL carries the parent (e.g. /hierarchy/level/abc/field)
   * it is fixed and just displayed; otherwise the modal asks for it, layer
   * by layer, and the last confirmed layer becomes the parent id.
   */
  const parentLayers = entityType !== "level" ? (PARENT_LAYERS[entityType] ?? []) : [];
  const nextParentLayer: HierarchyEntity | undefined = parentLayers[parentPath.length];
  const parentComplete = parentLayers.length > 0 && parentPath.length === parentLayers.length;
  const effectiveParentId = parentId
    ?? (parentComplete ? parentPath[parentPath.length - 1].id : undefined);

  /** Options for the next unresolved layer, scoped by the layers above it. */
  const parentLayerOptions = useQuery({
    queryKey: ["hierarchy-parent-layer-options", nextParentLayer, parentPath],
    enabled: !!createOpen && !editingId && !parentId && !!nextParentLayer,
    queryFn: async (): Promise<any[]> => {
      switch (nextParentLayer) {
        case "level":
          return levelsApi.list();
        case "field": {
          const level = parentPath.find((p) => p.type === "level");
          return level ? fieldsApi.list(level.id) : [];
        }
        case "professor": {
          const field = parentPath.find((p) => p.type === "field");
          return field ? professorsApi.list(field.id) : [];
        }
        case "group": {
          const prof = parentPath.find((p) => p.type === "professor");
          return prof ? groupsApi.list(prof.id) : [];
        }
        default:
          return [];
      }
    },
  });

  const pickParentLayer = (layer: HierarchyEntity, id: string, name: string) => {
    setParentPath((path) => {
      const idx = parentLayers.indexOf(layer);
      if (idx < 0) return path;
      return [...path.slice(0, idx), { type: layer, id, name }];
    });
  };

  const revertParentLayer = (index: number) => {
    setParentPath((path) => path.slice(0, index));
  };

  /**
   * Parent entity of a new record (create mode on a nested page). The `get`
   * endpoints return the whole chain (level -> field -> professor -> group),
   * so one request is enough to display every ancestor.
   */
  const createParent = useQuery({
    queryKey: ["hierarchy-create-parent", entityType, parentId],
    enabled: !!createOpen && !editingId && !!parentId,
    queryFn: async (): Promise<any> => {
      switch (entityType) {
        case "field": return levelsApi.get(parentId!);
        case "professor": return fieldsApi.get(parentId!);
        case "group": return professorsApi.get(parentId!);
        case "student": return groupsApi.get(parentId!);
        default: return null;
      }
    },
  });

  /**
   * On a nested page (parent pinned in the URL), seed the first enrollment
   * slot with that group once the parent chain arrives.
   */
  useEffect(() => {
    if (entityType !== "student" || !createOpen || editingId) return;
    const parent = createParent.data as any;
    if (!parent) return;
    setAssignmentSlots((slots) => {
      if (slots[0]?.groupId) return slots;
      return [
        {
          levelId: parent.professor?.field?.level?.id ?? "",
          fieldId: parent.professor?.field?.id ?? "",
          professorId: parent.professor?.id ?? "",
          groupId: parent.id ?? "",
          fee: "",
        },
      ];
    });
  }, [entityType, createOpen, editingId, createParent.data]);

  /**
   * Builds the display chain from a parent object. Works for both a fetched
   * parent (create) and the parent relation already present on a listed
   * entity (edit) — the shapes are identical.
   */
  const buildParentChain = (parent: any): Array<{ key: HierarchyEntity; name: string }> => {
    if (!parent) return [];
    switch (entityType) {
      case "field":
        return [{ key: "level", name: parent.name ?? "" }];
      case "professor":
        return [
          { key: "level", name: parent.level?.name ?? "" },
          { key: "field", name: parent.name ?? "" },
        ];
      case "group":
        return [
          { key: "level", name: parent.field?.level?.name ?? "" },
          { key: "field", name: parent.field?.name ?? "" },
          { key: "professor", name: parent.full_name ?? "" },
        ];
      case "student":
        return [
          { key: "level", name: parent.professor?.field?.level?.name ?? "" },
          { key: "field", name: parent.professor?.field?.name ?? "" },
          { key: "professor", name: parent.professor?.full_name ?? "" },
          { key: "group", name: parent.name ?? "" },
        ];
      default:
        return [];
    }
  };

  /**
   * Parent of the entity being edited, taken from the relation already
   * returned by the list query — no extra request, no "unknown" state.
   */
  const editingParent = useMemo(() => {
    if (!editingEntity) return null;
    switch (entityType) {
      case "field": return editingEntity.level ?? null;
      case "professor": return editingEntity.field ?? null;
      case "group": return editingEntity.professor ?? null;
      case "student": return editingEntity.group ?? null;
      default: return null;
    }
  }, [editingEntity, entityType]);

  const parentChain = editingId ? buildParentChain(editingParent) : buildParentChain(createParent.data);

  /**
   * Students are the one list that grows without bound, so they are filtered,
   * sorted, counted and paged in the database. The four structural layers
   * above them are bounded by how the school is organised — a few dozen rows —
   * and stay client-side, where filtering is instant and needs no round trip.
   */
  const isPagedEntity = entityType === "student";

  const studentQuery = useMemo(
    () => ({
      groupId: parentId ?? filterGroup ?? undefined,
      profId: filterProf || undefined,
      fieldId: filterField || undefined,
      levelId: filterLevel || undefined,
      search: debouncedSearch || undefined,
      sort: sortBy,
      page,
      limit: PAGE_SIZE,
    }),
    [parentId, filterGroup, filterProf, filterField, filterLevel, debouncedSearch, sortBy, page],
  );

  const studentPage = useStudentPage(studentQuery, { enabled: isPagedEntity });

  const { data: structuralEntities, isLoading: structuralLoading } = useQuery({
    queryKey: [entityType === "professor" ? "professors" : entityType + "s", parentId],
    enabled: !isPagedEntity,
    queryFn: async () => {
      switch (entityType) {
        case "level": return levelsApi.list();
        case "field": return parentId ? fieldsApi.list(parentId) : fieldsApi.list();
        case "professor": return professorsApi.list(parentId);
        case "group": return groupsApi.list(parentId);
        default: return [];
      }
    },
  });

  const entities = isPagedEntity ? studentPage.data?.data : structuralEntities;
  const isLoading = isPagedEntity ? studentPage.isLoading : structuralLoading;
  const pageMeta = isPagedEntity ? studentPage.data?.meta : undefined;

  // Fetch schedule entries for groups (to show schedule/classroom columns)
  const { data: allScheduleEntries } = useQuery({
    queryKey: ["scheduling", "entries", "hierarchy-groups"],
    queryFn: () => schedulingApi.entries.list({ active: true }),
    enabled: entityType === "group",
  });

  const entriesByGroup = useMemo(() => {
    if (entityType !== "group") return new Map<string, ScheduleEntry[]>();
    const map = new Map<string, ScheduleEntry[]>();
    (allScheduleEntries ?? []).forEach((entry) => {
      const list = map.get(entry.group_id) ?? [];
      list.push(entry);
      map.set(entry.group_id, list);
    });
    return map;
  }, [allScheduleEntries, entityType]);

  const getGroupScheduleLabel = (groupId: string): string => {
    const entries = entriesByGroup.get(groupId);
    if (!entries?.length) return "";
    const uniqueSlots = new Map<string, string>();
    entries.forEach((entry) => {
      if (!entry.time_slot) return;
      const key = `${entry.time_slot.day_of_week}-${entry.time_slot.start_time}-${entry.time_slot.end_time}`;
      const label = `${DAY_SHORT[entry.time_slot.day_of_week]} ${entry.time_slot.start_time}→${entry.time_slot.end_time}`;
      if (!uniqueSlots.has(key)) uniqueSlots.set(key, label);
    });
    return Array.from(uniqueSlots.values()).join(" / ");
  };

  const getGroupSessionsPerWeek = (groupId: string): number => {
    const entries = entriesByGroup.get(groupId);
    if (!entries?.length) return 0;
    const uniqueSlots = new Set<string>();
    entries.forEach((entry) => {
      if (!entry.time_slot) return;
      uniqueSlots.add(`${entry.time_slot.day_of_week}-${entry.time_slot.start_time}-${entry.time_slot.end_time}`);
    });
    return uniqueSlots.size;
  };

  const getGroupClassroomLabel = (groupId: string): string => {
    const entries = entriesByGroup.get(groupId);
    if (!entries?.length) return "";
    const names = new Set<string>();
    entries.forEach((entry) => {
      if (entry.classroom?.name) names.add(entry.classroom.name);
    });
    return Array.from(names).join(", ");
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      switch (entityType) {
        case "level": return levelsApi.create(data);
        case "field": return fieldsApi.create({ ...data, level_id: effectiveParentId });
        case "professor": return professorsApi.create({ ...data, field_id: effectiveParentId });
        case "group": return groupsApi.create({ ...data, prof_id: effectiveParentId });
        case "student": return studentsApi.create(data);
        default: throw new Error("Unknown entity type");
      }
    },
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: [entityType === "professor" ? "professors" : entityType + "s"] });
      qc.invalidateQueries({ queryKey: ["hierarchy-summary"] });
      // A group save also rewrites its sessions, and those live under their own
      // query keys — the edit form's tiles and the list's Schedule column would
      // otherwise keep serving the pre-save cache and look like nothing saved.
      if (entityType === "group") qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
      if (entityType === "student" && result?.id) {
        generatePayment.mutate({ studentId: result.id, months: 0 }, {
          onSettled: () => router.push(`/students/${result.id}/payments`),
        });
      }
    },
    onError: showError,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      switch (entityType) {
        case "level": return levelsApi.update(id, data);
        case "field": return fieldsApi.update(id, data);
        case "professor": return professorsApi.update(id, data);
        case "group": return groupsApi.update(id, data);
        case "student": return studentsApi.update(id, data);
        default: throw new Error("Unknown entity type");
      }
    },
    onSuccess: (_result, variables) => {
      // A new group assignment on a student ("nouvelle affectation") generates
      // this month's invoice for that group only (never backdated from the
      // enrolment date) and opens their payment page with the group
      // preselected, so the new invoice is the first thing seen.
      let newGroupId: string | null = null;
      if (entityType === "student" && Array.isArray(variables?.data?.assignments)) {
        const previousGroupIds = new Set<string>();
        const prev = editingEntity as any;
        for (const a of prev?.assignments ?? []) {
          if (a?.group?.id) previousGroupIds.add(a.group.id);
          else if (a?.group_id) previousGroupIds.add(a.group_id);
        }
        if (prev?.group?.id) previousGroupIds.add(prev.group.id);
        else if (prev?.group_id) previousGroupIds.add(prev.group_id);
        newGroupId =
          variables.data.assignments
            .map((a: any) => a.group_id)
            .find((groupId: string) => !previousGroupIds.has(groupId)) ?? null;
      }
      qc.invalidateQueries({ queryKey: [entityType === "professor" ? "professors" : entityType + "s"] });
      qc.invalidateQueries({ queryKey: ["hierarchy-summary"] });
      // A group save also rewrites its sessions, and those live under their own
      // query keys — the edit form's tiles and the list's Schedule column would
      // otherwise keep serving the pre-save cache and look like nothing saved.
      if (entityType === "group") qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      setEditingId(null);
      resetForm();
      if (newGroupId) {
        generatePayment.mutate({ studentId: variables.id, months: 0, groupId: newGroupId }, {
          onSettled: () => router.push(`/students/${variables.id}/payments?groupId=${newGroupId}`),
        });
      }
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) return;
      switch (deleteTarget.type) {
        case "level": return levelsApi.delete(deleteTarget.id);
        case "field": return fieldsApi.remove(deleteTarget.id);
        case "professor": return professorsApi.deactivate(deleteTarget.id);
        case "group": return groupsApi.delete(deleteTarget.id);
        case "student": return studentsApi.delete(deleteTarget.id);
        default: throw new Error("Unknown entity type");
      }
    },
    onSuccess: () => {
      // Scoped rather than a bare invalidateQueries(): deleting one entity must
      // not refetch every screen in the app. A delete cascades down the
      // hierarchy (and moves children onto a sentinel), so every entity list
      // plus the roll-up summary is invalidated — but nothing beyond that.
      for (const key of ["levels", "fields", "professors", "groups", "students", "hierarchy-summary"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      setDeleteError(null);
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      // The API refuses to delete a student who has recorded payments and says
      // to withdraw them instead. That is an instruction, not a notification —
      // it stays in the dialog rather than vanishing with a toast.
      const body = (err as any)?.response?.data?.error ?? (err as any)?.response?.data;
      const message = body?.message;
      if (deleteTarget?.type === "student" && typeof message === "string" && message) {
        setDeleteError(message);
        return;
      }
      showError(err);
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormPhone("");
    setFormEmail("");
    setFirstName("");
    setLastName("");
    setParentPhone("");
    setEnrollmentDate(new Date().toISOString().split("T")[0]);
    setFormStatus("active");
    setFormCapacity("");
    setFormTiles([]);
    setTilesTouched(false);
    setAcceptedConflicts(false);
    setFormColor(null);
    setParentPath([]);
    setAssignmentSlots([emptyAssignmentSlot()]);
    setEditingId(null);
    setEditingEntity(null);
  };

  const openEdit = (entity: any) => {
    setEditingId(entity.id);
    setEditingEntity(entity);
    setFormColor(entity.color ?? null);
    if (entityType === "student") {
      setFirstName(entity.first_name);
      setLastName(entity.last_name);
      setFormPhone(stripTunisiaPrefix(entity.phone ?? ""));
      setParentPhone(stripTunisiaPrefix(entity.parent_phone ?? ""));
      setFormEmail(entity.email ?? "");
      setEnrollmentDate(entity.enrollment_date?.split("T")[0] ?? new Date().toISOString().split("T")[0]);
      setFormStatus(entity.status ?? "active");
      // Seed one slot per enrollment (primary first); fall back to the legacy
      // single group relation for payloads that predate the join table.
      const enrollments = entity.assignments?.length
        ? entity.assignments
        : entity.group
          ? [{ group_id: entity.group_id, group: entity.group }]
          : [];
      setAssignmentSlots(
        enrollments.length
          ? enrollments.map((a: any) => ({
              levelId: a.group?.professor?.field?.level?.id ?? "",
              fieldId: a.group?.professor?.field?.id ?? "",
              professorId: a.group?.professor?.id ?? "",
              groupId: a.group_id ?? a.group?.id ?? "",
              fee: a.fee !== undefined ? String(a.fee) : String(entity.monthly_fee ?? ""),
            }))
          : [emptyAssignmentSlot()],
      );
    } else if (entityType === "professor") {
      setFormName(entity.full_name);
      setFormPhone(stripTunisiaPrefix(entity.phone ?? ""));
      setFormEmail(entity.email ?? "");
    } else if (entityType === "group") {
      setFormName(entity.name ?? "");
      setFormCapacity(entity.capacity?.toString() ?? "");
      // Left empty on purpose: the group's real sessions arrive from
      // `editingGroupTiles` and are handed to the builder as `initialTiles`,
      // which also flips `initialTilesLoaded` so the draft is not clobbered
      // mid-load. Seeding them here would race that query.
      setFormTiles([]);
      setTilesTouched(false);
      setAcceptedConflicts(false);
    } else {
      setFormName(entity.name ?? "");
      setFormDescription(entity.description ?? "");
    }
    setCreateOpen(true);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (entityType === "student") {
      if (!firstName.trim() || !lastName.trim() || !formPhone.trim()) return;
      const phone = normalizeTunisianPhone(formPhone);
      if (!phone) {
        toast.error(t("students.phoneInvalidTitle", "Invalid phone number"), t("students.phoneInvalid", "Phone must be 8 digits, e.g. +216 22 123 456"));
        return;
      }
      const parentPhoneValue = parentPhone.trim() ? normalizeTunisianPhone(parentPhone) : null;
      if (parentPhone.trim() && !parentPhoneValue) {
        toast.error(t("students.phoneInvalidTitle", "Invalid phone number"), t("students.parentPhoneInvalid", "Parent phone must be 8 digits, e.g. +216 22 123 456"));
        return;
      }
      const complete = assignmentSlots.filter(
        (s) => s.levelId && s.fieldId && s.professorId && s.groupId,
      );
      const partial = assignmentSlots.some(
        (s) => (s.levelId || s.fieldId || s.professorId) && !(s.levelId && s.fieldId && s.professorId && s.groupId),
      );
      if (complete.length === 0 || partial) {
        toast.error(
          t("students.assignmentInvalidTitle", "Incomplete assignment"),
          t("students.assignmentInvalid", "Finish each assignment: level, field, professor and group."),
        );
        return;
      }
      const missingFee = complete.some((s) => !(parseFloat(s.fee) > 0));
      if (missingFee) {
        toast.error(
          t("students.assignmentFeeInvalidTitle", "Missing fee"),
          t("students.assignmentFeeInvalid", "Every assignment needs a monthly fee."),
        );
        return;
      }
      const data = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone,
        parent_phone: parentPhoneValue ?? undefined,
        email: formEmail.trim() || undefined,
        color: formColor ?? undefined,
        enrollment_date: enrollmentDate,
        // The legacy single fee follows the primary enrollment for roll-ups;
        // billing itself reads the per-assignment fee.
        monthly_fee: parseFloat(complete[0].fee),
        status: formStatus,
        assignments: complete.map((s) => ({ group_id: s.groupId, fee: parseFloat(s.fee) })),
      };
      if (editingId) {
        updateMutation.mutate({ id: editingId, data });
      } else {
        createMutation.mutate(data);
      }
      return;
    }

    if (entityType === "professor") {
      if (!formName.trim()) return;
      const phone = formPhone.trim() ? normalizeTunisianPhone(formPhone) : null;
      if (formPhone.trim() && !phone) {
        toast.error(t("students.phoneInvalidTitle", "Invalid phone number"), t("students.phoneInvalid", "Phone must be 8 digits, e.g. +216 22 123 456"));
        return;
      }
      const data = { full_name: formName.trim(), phone: phone ?? undefined, email: formEmail || undefined, color: formColor ?? undefined };
      if (editingId) {
        updateMutation.mutate({ id: editingId, data });
      } else {
        createMutation.mutate(data);
      }
      return;
    }

    const data: any = { color: formColor ?? undefined };
    if (entityType === "level") data.name = formName.trim();
    if (entityType === "field") { data.name = formName.trim(); data.description = formDescription || undefined; }
    if (entityType === "group") {
      data.name = formName.trim();
      data.capacity = formCapacity ? parseInt(formCapacity) : undefined;
      // Sent whenever the builder was touched, empty array included — that is
      // how a schedule gets cleared. Omitted entirely when it was not, so an
      // edit to the group's name leaves its sessions alone.
      if (tilesTouched) {
        data.scheduleTiles = formTiles;
        if (acceptedConflicts) data.allowConflicts = true;
      }
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getEntityName = (entity: any): string => {
    if (entityType === "professor") return entity.full_name;
    if (entityType === "student") return `${entity.first_name} ${entity.last_name}`;
    return entity.name;
  };

  const getChildCount = (entity: any): number => {
    const c = entity?._count;
    if (!c) return 0;
    switch (entityType) {
      case "level": return c.fields ?? 0;
      case "field": return c.professors ?? 0;
      case "professor": return c.groups ?? 0;
      case "group": return c.students ?? 0;
      default: return 0;
    }
  };

  /** Children names for the assignment-style chips: group -> students, professor -> groups, field -> professors. */
const getChildrenNames = (entity: any): string[] => {
  switch (entityType) {
    case "group":
      // Show the professor name for groups instead of students
      return entity.professor ? [entity.professor.full_name] : [];
    case "professor":
      return entity.groups?.map((g: any) => g.name).filter(Boolean) ?? [];
    case "field":
      return entity.professors?.map((p: any) => p.full_name).filter(Boolean) ?? [];
    default:
      return [];
  }
};

  const showsChildrenChips = entityType === "group" || entityType === "professor" || entityType === "field";
const childrenLabel =
  entityType === "group" ? t("students.professor", "Professor")
    : entityType === "professor" ? t("nav.groups", "Groups")
      : entityType === "field" ? t("nav.professors", "Professors")
        : "";

  /**
   * Search + filters + sort for the client-side lists.
   *
   * The paged list is returned already filtered, ordered and sliced, so it is
   * passed straight through: re-filtering here would apply the term to the
   * fifty rows on screen and report "no matches" for a student three pages
   * down who does match.
   */
  const items = useMemo(() => {
    const list = entities ?? [];
    if (isPagedEntity) return list;

    const q = search.trim().toLowerCase();
    let filtered = q
      ? list.filter((entity: any) => {
          const haystack = [
            getEntityName(entity),
            entity.phone,
            entity.email,
            entity.description,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        })
      : list;
    // The level/field/professor/group cascade is only offered on the student
    // list, which is resolved server-side above — so there is nothing left to
    // narrow here.
    return [...filtered].sort((a: any, b: any) => {
      switch (sortBy) {
        case "nameAsc": return getEntityName(a).localeCompare(getEntityName(b));
        case "nameDesc": return getEntityName(b).localeCompare(getEntityName(a));
        case "color": {
          const ca = (a.color ?? "").toLowerCase();
          const cb = (b.color ?? "").toLowerCase();
          if (ca && !cb) return -1;
          if (!ca && cb) return 1;
          if (!ca && !cb) return getEntityName(a).localeCompare(getEntityName(b));
          return ca.localeCompare(cb);
        }
        default: return 0;
      }
    });
  }, [entities, isPagedEntity, search, sortBy, entityType]);

  /**
   * Any change of scope invalidates the current page number: staying on page 4
   * after narrowing to a filter with two pages shows an empty list, which reads
   * as "no results" rather than "you are past the end".
   */
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sortBy, filterLevel, filterField, filterProf, filterGroup, parentId]);

  const getNextEntityHref = (entity: any): string | null => {
    const nextEntity = getNextEntity(entityType);
    if (!nextEntity) return null;

    const basePath = "/hierarchy";
    const segments: string[] = [];

    // Build path based on hierarchy config order
    // Walk through entityOrder up to and including current entity type
    const currentIdx = entityOrder.indexOf(entityType);
    for (let i = 0; i <= currentIdx; i++) {
      const eType = entityOrder[i];
      let eId: string | undefined;
      switch (eType) {
        case "level": eId = entityIds.levelId; break;
        case "field": eId = entityIds.fieldId; break;
        case "professor": eId = entityIds.profId; break;
        case "group": eId = entityIds.groupId; break;
        default: eId = undefined;
      }
      if (eId) segments.push(eType, eId);
    }

    // Add current entity (the one being clicked)
    segments.push(entityType, entity.id);

    return `${basePath}/${segments.join("/")}`;
  };

  /**
   * Attendance sheet link for a group. The page resolves the whole chain
   * (professor -> field -> level) from the group payload itself.
   */
  const getAttendanceHref = (entity: any): string | null => {
    if (entityType !== "group") return null;
    return `/attendance-sheet/${entity.id}`;
  };

  /**
   * Parent entity labels for the create modal: instead of the generic
   * "Parent", the field is labelled with the hierarchy layer the new entity
   * hangs from (a field is created under a Niveau, a professor under a
   * Filière, a group under a Professeur, a student under a Groupe).
   */
  const PARENT_LABEL_KEYS: Partial<Record<HierarchyEntity, string>> = {
    level: "hierarchy.parentLevel",
    field: "hierarchy.parentField",
    professor: "hierarchy.parentProfessor",
    group: "hierarchy.parentGroup",
  };
  const directParentType = parentLayers.length > 0 ? parentLayers[parentLayers.length - 1] : undefined;
  const directParentName =
    parentChain.length > 0
      ? parentChain[parentChain.length - 1].name
      : parentPath.length > 0
        ? parentPath[parentPath.length - 1].name
        : "";
  const parentLabelKey = directParentType ? PARENT_LABEL_KEYS[directParentType] : undefined;
  const parentInputLabel = parentLabelKey
    ? t(parentLabelKey)
    : t("hierarchy.parent", "Parent");
  const parentInputLabelFull = directParentName
    ? `${parentInputLabel} : ${directParentName}`
    : parentInputLabel;

  return (
    <>
      <div className="space-y-6">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 text-sm text-text-secondary flex-wrap">
          <Link href="/dashboard" className="hover:text-primary">{t("nav.dashboard")}</Link>
          <ChevronRight size={14} />
          <Link href="/hierarchy" className="hover:text-primary">{getEntityLabel(entityOrder[0])}</Link>
          {entityOrder.map((eType, idx) => {
            if (idx >= entityOrder.indexOf(entityType)) return null;
            let eId: string | undefined;
            switch (eType) {
              case "level": eId = entityIds.levelId; break;
              case "field": eId = entityIds.fieldId; break;
              case "professor": eId = entityIds.profId; break;
              case "group": eId = entityIds.groupId; break;
              default: eId = undefined;
            }
            if (!eId) return null;
            // Build href for this breadcrumb: the ancestors above it with
            // their ids, then this entity type WITHOUT its id — so it links
            // to the list it belongs to (e.g. /hierarchy/level/x/field shows
            // the fields under that level, not the professors below a field).
            const hrefSegments: string[] = [];
            for (let i = 0; i < idx; i++) {
              const segType = entityOrder[i];
              let segId: string | undefined;
              switch (segType) {
                case "level": segId = entityIds.levelId; break;
                case "field": segId = entityIds.fieldId; break;
                case "professor": segId = entityIds.profId; break;
                case "group": segId = entityIds.groupId; break;
                default: segId = undefined;
              }
              if (segId) hrefSegments.push(segType, segId);
            }
            hrefSegments.push(eType);
            const Icon = ENTITY_ICONS[eType];
            return (
              <span key={eType} className="flex items-center gap-1">
                <ChevronRight size={14} />
                <Link href={`/hierarchy/${hrefSegments.join("/")}`} className="hover:text-primary flex items-center gap-1">
                  <Icon size={12} />
                  {getEntityLabel(eType)}
                </Link>
              </span>
            );
          })}
          <ChevronRight size={14} />
          <span className="text-text-primary font-medium flex items-center gap-1">
            {(() => { const Icon = ENTITY_ICONS[entityType]; return <Icon size={12} />; })()}
            {getEntityLabel(entityType)}
          </span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h4 font-bold text-text-primary">
              {getEntityLabel(entityType)}
            </h2>
            <p className="text-xs text-text-secondary">
              {t(`hierarchy.manage${entityType.charAt(0).toUpperCase() + entityType.slice(1)}s`, `Manage ${getEntityLabel(entityType)}`)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            {entityType !== "student" && (
              <button
                className="btn btn-secondary"
                onClick={() => setDeletedOpen(true)}
                title={t("deleted.title", "Deleted")}
              >
                <Trash2 size={16} /> {t("deleted.title", "Deleted")}
              </button>
            )}
            {entityType === "student" && parentId && (
              <Link
                href={`/attendance-sheet/${parentId}`}
                className="btn btn-secondary"
                title={t("fieldsHierarchy.attendanceSheet", "Attendance sheet")}
              >
                <Printer size={16} /> {t("fieldsHierarchy.attendanceSheet", "Attendance sheet")}
              </Link>
            )}
            <button className="btn btn-primary" onClick={() => { resetForm(); setCreateOpen(true); }}>
              <Plus size={16} /> {t("hierarchy.create", "Create")}
            </button>
          </div>
        </div>

        {/* Search + sort toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("hierarchy.searchPlaceholder", "Search by name or phone…")}
              className="input pl-9"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="input w-auto"
            aria-label={t("hierarchy.sortBy", "Sort by")}
          >
            <option value="newest">{t("hierarchy.sortNewest", "Newest first")}</option>
            <option value="nameAsc">{t("hierarchy.sortNameAsc", "Name A–Z")}</option>
            <option value="nameDesc">{t("hierarchy.sortNameDesc", "Name Z–A")}</option>
            <option value="color">{t("hierarchy.sortColor", "By color")}</option>
          </select>
        </div>

        {/* Student filters: level > field > professor > group cascade */}
        {entityType === "student" && (
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={filterLevel}
              onChange={(e) => changeFilterLevel(e.target.value)}
              className="input w-auto"
              aria-label={t("students.allLevels", "All levels")}
            >
              <option value="">{t("students.allLevels", "All levels")}</option>
              {(filterLevelOptions.data ?? []).map((o: any) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <select
              value={filterField}
              onChange={(e) => changeFilterField(e.target.value)}
              className="input w-auto"
              aria-label={t("students.allFields", "All fields")}
              disabled={!filterLevel}
            >
              <option value="">{t("students.allFields", "All fields")}</option>
              {(filterFieldOptions.data ?? []).map((o: any) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <select
              value={filterProf}
              onChange={(e) => changeFilterProf(e.target.value)}
              className="input w-auto"
              aria-label={t("students.allProfessors", "All professors")}
              disabled={!filterField}
            >
              <option value="">{t("students.allProfessors", "All professors")}</option>
              {(filterProfOptions.data ?? []).map((o: any) => (
                <option key={o.id} value={o.id}>{o.full_name}</option>
              ))}
            </select>
            <select
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="input w-auto"
              aria-label={t("students.allGroups", "All groups")}
              disabled={!filterProf}
            >
              <option value="">{t("students.allGroups", "All groups")}</option>
              {(filterGroupOptions.data ?? []).map((o: any) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            {filterHasActive && (
              <button
                onClick={() => {
                  setFilterLevel("");
                  setFilterField("");
                  setFilterProf("");
                  setFilterGroup("");
                }}
                className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-danger/40 hover:text-danger hover:bg-danger/5 transition-colors"
              >
                <X size={12} />
                {t("hierarchy.clearFilters", "Clear filters")}
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-background border border-border px-1 text-[10px] font-semibold tabular-nums">
                  {[filterLevel, filterField, filterProf, filterGroup].filter(Boolean).length}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <PageLoader text={t("common.loading", "Loading…")} />
        ) : !items.length ? (
          search || filterHasActive ? (
            <p className="py-8 text-center text-sm text-text-secondary">
              {t("hierarchy.noSearchResults", "No matches for that search.")}
            </p>
          ) : (
            <EmptyState
              message={t("hierarchy.noEntities", `No ${getEntityLabel(entityType).toLowerCase()} found.`)}
              actionLabel={t("hierarchy.create", "Create")}
              onAction={() => { resetForm(); setCreateOpen(true); }}
            />
          )
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((entity: any) => {
              const Icon = ENTITY_ICONS[entityType];
              const nextHref = getNextEntityHref(entity);
              const attendanceHref = getAttendanceHref(entity);
              const paymentsHref = entityType === "student" ? `/students/${entity.id}/payments` : null;
              const primaryHref = nextHref ?? attendanceHref ?? paymentsHref;
              const childCount = getChildCount(entity);
              const nextLabel = getNextEntity(entityType);
              return (
                <div
                  key={entity.id}
                  className="card group cursor-pointer hover:shadow-hover transition-shadow relative overflow-hidden"
                  onClick={() => {
                    if (entityType === "student") {
                      setDetailStudentId(entity.id);
                    } else if (primaryHref) {
                      router.push(primaryHref);
                    }
                  }}
                >
                  {entity.color && (
                    <>
                      <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: entity.color, opacity: 0.20              }} aria-hidden="true" />
                      <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: entity.color }} />
                    </> 
                  )}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-card bg-primary-50 text-primary dark:bg-primary/15">
                        <Icon size={18} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-text-primary transition-colors group-hover:text-primary flex items-center gap-1.5">
                          {entity.color && <span className="h-2.5 w-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: entity.color }} />}
                          {getEntityName(entity)}
                        </h3>
                        {entity.description && <p className="text-xs text-text-secondary">{entity.description}</p>}
                        {entity.phone && <p className="text-xs text-text-secondary">{entity.phone}</p>}
                        {entityType === "student" && entity.parent_phone && (
                          <p className="text-xs text-text-secondary">
                            {t("studentDetail.parentPhone", "Parent")}: {entity.parent_phone}
                          </p>
                        )}
                        {entityType === "student" && entity.email && (
                          <p className="text-xs text-text-secondary">{entity.email}</p>
                        )}
                        {entityType === "student" && entity.enrollment_date && (
                          <p className="text-xs text-text-secondary">
                            {t("students.enrollmentDate", "Enrollment")}: {formatDate(entity.enrollment_date)}
                          </p>
                        )}
                        {entityType === "student" && entity.status && (
                          <StatusBadge status={entity.status} />
                        )}
                        {entityType !== "student" && nextLabel && childCount > 0 && (
                          <p className="mt-1 text-xs text-text-secondary">
                            <span className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-2 py-0.5">
                              {childCount} {getEntityLabel(nextLabel)}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: entityType, id: entity.id, name: getEntityName(entity) }); }}
                        className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                        aria-label={`${t("hierarchy.delete", "Delete")} ${getEntityName(entity)}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {entityType === "student" && (
                    <div className="mt-2">
                      <StudentChain student={entity} />
                    </div>
                  )}
                  {showsChildrenChips && (
                    <div className="mt-2">
                      <ChildChips items={getChildrenNames(entity)} />
                    </div>
                  )}
                  {entityType === "group" && (
                    <div className="mt-2 space-y-1 text-xs text-text-secondary">
                      {getGroupScheduleLabel(entity.id) && (
                        <p className="truncate">{getGroupScheduleLabel(entity.id)}</p>
                      )}
                      {getGroupSessionsPerWeek(entity.id) > 0 && (
                        <p>{getGroupSessionsPerWeek(entity.id)} {t("scheduling.scheduleEntry", "seances")}/sem</p>
                      )}
                      {getGroupClassroomLabel(entity.id) && (
                        <p className="truncate">{getGroupClassroomLabel(entity.id)}</p>
                      )}
                    </div>
                  )}
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(entity); }}
                      className="btn btn-secondary text-xs flex-1"
                    >
                      {t("hierarchy.edit", "Edit")}
                    </button>
                    {entityType === "group" && attendanceHref && (
                      <Link
                        href={attendanceHref}
                        onClick={(e) => e.stopPropagation()}
                        className="btn btn-primary text-xs px-2"
                        title={t("fieldsHierarchy.attendanceSheet", "Attendance")}
                      >
                        <Printer size={14} />
                      </Link>
                    )}
                    {entityType === "student" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); printTimetable(entity.id); }}
                        className="btn btn-secondary text-xs px-2"
                        title={t("scheduling.printTimetable", "Imprimer l'emploi du temps")}
                        aria-label={t("scheduling.printTimetable", "Imprimer l'emploi du temps")}
                      >
                        <Printer size={14} />
                      </button>
                    )}
                    {nextHref ? (
                      <Link href={nextHref} onClick={(e) => e.stopPropagation()} className="btn btn-primary text-xs flex-1 text-center">
                        {t("hierarchy.viewChildren", "View")} {getEntityLabel(getNextEntity(entityType)!)}
                      </Link>
                    ) : entityType === "student" ? (
                      <Link href={paymentsHref!} onClick={(e) => e.stopPropagation()} className="btn btn-primary text-xs flex-1 text-center">
                        {t("students.payments", "Payments")}
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.name")}</th>
                  {entityType === "student" && (
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.status")}</th>
                  )}
                  {entityType === "student" && (
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.assignment", "Assignment")}</th>
                  )}
                  {showsChildrenChips && (
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{childrenLabel}</th>
                  )}
                  {entityType === "group" && (
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.schedule")}</th>
                  )}
                  {entityType === "group" && (
                    <th className="px-4 py-3 text-center text-xs font-semibold text-text-secondary uppercase">{t("scheduling.scheduleEntry", "Seances/Week")}</th>
                  )}
                  {entityType === "group" && (
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("nav.classrooms", "Classroom")}</th>
                  )}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((entity: any) => {
                  const nextHref = getNextEntityHref(entity);
                  const attendanceHref = getAttendanceHref(entity);
                  const childCount = getChildCount(entity);
                  const nextLabel = getNextEntity(entityType);
                  return (
                    <tr
                      key={entity.id}
                      className="hover:bg-background/50 cursor-pointer transition-colors"
                      onClick={() => {
                        if (entityType === "student") {
                          setDetailStudentId(entity.id);
                        } else {
                          const href = nextHref ?? attendanceHref;
                          if (href) router.push(href);
                        }
                      }}
                    >
                      <td className="px-4 py-3 font-medium text-primary">
                        <div className="flex items-center gap-2">
                          {entity.color && <span className="h-2.5 w-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: entity.color }} />}
                          {nextHref ? (
                            <Link href={nextHref}>{getEntityName(entity)}</Link>
                          ) : (
                            getEntityName(entity)
                          )}
                          {entityType !== "student" && nextLabel && childCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-2 py-0.5 text-xs text-text-secondary">
                              {childCount} {getEntityLabel(nextLabel)}
                            </span>
                          )}
                        </div>
                      </td>
                      {entityType === "student" && (
                        <td className="px-4 py-3"><StatusBadge status={entity.status} /></td>
                      )}
                      {entityType === "student" && (
                        <td className="px-4 py-3 text-text-secondary"><StudentChain student={entity} /></td>
                      )}
                      {showsChildrenChips && (
                        <td className="px-4 py-3 text-text-secondary"><ChildChips items={getChildrenNames(entity)} limit={8} /></td>
                      )}
                      {entityType === "group" && (
                        <td className="px-4 py-3 text-xs text-text-secondary">{getGroupScheduleLabel(entity.id) || "—"}</td>
                      )}
                      {entityType === "group" && (
                        <td className="px-4 py-3 text-xs text-text-secondary text-center">{getGroupSessionsPerWeek(entity.id) || "—"}</td>
                      )}
                      {entityType === "group" && (
                        <td className="px-4 py-3 text-xs text-text-secondary">{getGroupClassroomLabel(entity.id) || "—"}</td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {attendanceHref && (
                            <Link
                              href={attendanceHref}
                              onClick={(e) => e.stopPropagation()}
                              className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                              title={t("fieldsHierarchy.attendanceSheet", "Attendance")}
                            >
                              <Printer size={14} />
                            </Link>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(entity); }}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: entityType, id: entity.id, name: getEntityName(entity) }); }}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                          {nextHref && (
                            <Link href={nextHref} onClick={(e) => e.stopPropagation()} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors">
                              <ChevronRight size={14} />
                            </Link>
                          )}
                          {entityType === "student" && !nextHref && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDetailStudentId(entity.id); }}
                              className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                              title={t("studentDetail.personalInfo", "Details")}
                            >
                              <Eye size={14} />
                            </button>
                          )}
                          {entityType === "student" && !nextHref && (
                            <button
                              onClick={(e) => { e.stopPropagation(); printTimetable(entity.id); }}
                              className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                              title={t("scheduling.printTimetable", "Imprimer l'emploi du temps")}
                              aria-label={t("scheduling.printTimetable", "Imprimer l'emploi du temps")}
                            >
                              <Printer size={14} />
                            </button>
                          )}
                          {entityType === "student" && !nextHref && (
                            <Link
                              href={`/students/${entity.id}/payments`}
                              onClick={(e) => e.stopPropagation()}
                              className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-gold hover:bg-gold-50 transition-colors"
                            >
                              <DollarSign size={14} />
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paging — server-side, so the count spans the whole filtered set. */}
        {pageMeta && pageMeta.totalPages > 1 && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-xs text-text-secondary tabular-nums">
              {t("common.pageOf", "Page {page} of {total}")
                .replace("{page}", String(pageMeta.page))
                .replace("{total}", String(pageMeta.totalPages))}
              {" · "}
              {pageMeta.total} {getEntityLabel(entityType).toLowerCase()}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary text-xs px-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pageMeta.page <= 1}
                aria-label={t("common.previous", "Previous")}
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-secondary text-xs px-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setPage((p) => p + 1)}
                disabled={pageMeta.page >= pageMeta.totalPages}
                aria-label={t("common.next", "Next")}
              >
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setCreateOpen(false); resetForm(); }}>
          <div className="bg-surface rounded-modal shadow-hover w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {(() => { const Icon = ENTITY_ICONS[entityType]; return (
                  <div className="h-10 w-10 rounded-btn bg-primary-50 flex items-center justify-center text-primary shrink-0">
                    <Icon size={18} />
                  </div>
                ); })()}
                <div>
                  <h3 className="text-h4 font-bold leading-tight">
                    {editingId ? t("hierarchy.edit", "Edit") : t("hierarchy.create", "Create")} {getEntityLabel(entityType)}
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5">{t("hierarchy.formSubtitle")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setCreateOpen(false); resetForm(); }}
                aria-label={t("fieldsHierarchy.cancel")}
                className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors shrink-0"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="space-y-5 p-6">
              {entityType !== "level" && entityType !== "student" && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {parentInputLabelFull} {!editingId && "*"}
                  </label>
                  {parentId || editingId ? (
                    <div
                      className="flex flex-wrap items-center gap-1.5 rounded-btn border border-border bg-surface px-3 py-2.5"
                      title={t("hierarchy.parent", "Parent")}
                    >
                      {parentChain.length === 0 ? (
                        <span className="text-xs text-text-secondary">
                          {editingId || createParent.isFetching ? "…" : t("hierarchy.selectParent", "Select parent")}
                        </span>
                      ) : (
                        parentChain.map((c, i) => {
                          const Icon = ENTITY_ICONS[c.key];
                          const last = i === parentChain.length - 1;
                          return (
                            <span key={c.key} className="flex items-center gap-1.5">
                              {i > 0 && <ChevronRight size={12} className="text-text-secondary" />}
                              <span
                                className={`flex items-center gap-1 rounded-btn px-2 py-1 text-xs font-medium ${
                                  last
                                    ? "bg-primary text-white"
                                    : "border border-border bg-surface-2 text-text-secondary"
                                }`}
                              >
                                <Icon size={11} />
                                {c.name || "—"}
                              </span>
                            </span>
                          );
                        })
                      )}
                    </div>
                  ) : (
                    <div
                      className="flex flex-wrap items-center gap-1.5 rounded-btn border border-border bg-surface px-3 py-2.5"
                      title={t("hierarchy.parent", "Parent")}
                    >
                      {parentPath.map((step, i) => {
                        const Icon = ENTITY_ICONS[step.type];
                        return (
                          <span key={step.type} className="flex items-center gap-1.5">
                            {i > 0 && <ChevronRight size={12} className="text-text-secondary" />}
                            <button
                              type="button"
                              onClick={() => revertParentLayer(i)}
                              title={t("hierarchy.changeParent", "Change")}
                              className={`flex items-center gap-1 rounded-btn px-2 py-1 text-xs font-medium transition-colors hover:opacity-80 ${
                                i === parentPath.length - 1
                                  ? "bg-primary text-white"
                                  : "border border-border bg-surface-2 text-text-secondary"
                              }`}
                            >
                              <Icon size={11} />
                              {step.name}
                            </button>
                          </span>
                        );
                      })}
                      {parentComplete ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-success-strong">
                          <Check size={11} />
                          {t("hierarchy.parentSet", "Parent set")}
                        </span>
                      ) : nextParentLayer ? (
                        <>
                          {parentPath.length > 0 && (
                            <ChevronRight size={12} className="text-text-secondary" />
                          )}
                          <select
                            value=""
                            onChange={(e) => {
                              const opt = (parentLayerOptions.data ?? []).find(
                                (o: any) => o.id === e.target.value,
                              );
                              if (opt && nextParentLayer) {
                                pickParentLayer(nextParentLayer, opt.id, opt.full_name ?? opt.name);
                              }
                            }}
                            className="input py-1 px-2 text-xs min-w-[150px]"
                            required={!editingId}
                          >
                            <option value="">
                              {t(`students.select${nextParentLayer.charAt(0).toUpperCase() + nextParentLayer.slice(1)}`)}
                            </option>
                            {(parentLayerOptions.data ?? []).map((p: any) => (
                              <option key={p.id} value={p.id}>
                                {p.full_name ?? p.name}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <span className="text-xs text-text-secondary">
                          {t("hierarchy.noParentLayers", "Nothing to select")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {entityType === "student" ? (
                <>
                  <ModalSection title={t("studentDetail.personalInfo", "Personal information")}>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("students.firstName")} *</label>
                        <input
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          className="input"
                          autoFocus
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("students.lastName")} *</label>
                        <input
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          className="input"
                          required
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("students.phone")} *</label>
                        <PhoneInput value={formPhone} onChange={setFormPhone} required />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.parentPhoneOptional")}</label>
                        <PhoneInput value={parentPhone} onChange={setParentPhone} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.emailOptional2")}</label>
                      <input
                        type="email"
                        value={formEmail}
                        onChange={(e) => setFormEmail(e.target.value)}
                        className="input"
                      />
                    </div>
                  </ModalSection>
                  <ModalSection title={t("studentDetail.enrollmentStatus", "Enrollment")}>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("students.enrollmentDate")} *</label>
                        <input
                          type="date"
                          value={enrollmentDate}
                          onChange={(e) => setEnrollmentDate(e.target.value)}
                          className="input"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("students.status")} *</label>
                        <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as StudentStatus)} className="input">
                          <option value="active">{t("students.active", "Active")}</option>
                          <option value="paused">{t("students.paused", "Paused")}</option>
                          <option value="withdrawn">{t("students.withdrawn", "Withdrawn")}</option>
                        </select>
                      </div>
                    </div>
                  </ModalSection>
                  <ModalSection title={t("students.assignment", "Assignments")}>
                    <AssignmentSlotsPicker slots={assignmentSlots} onChange={setAssignmentSlots} />
                  </ModalSection>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {entityType === "professor" ? t("fieldsHierarchy.fullName") : t("fieldsHierarchy.name")}
                    </label>
                    <input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="input"
                      autoFocus
                      required
                    />
                  </div>
                  {entityType === "field" && (
                    <div>
                      <label className="block text-sm font-medium mb-1">{t("fields.description")}</label>
                      <textarea
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        className="input"
                        rows={2}
                      />
                    </div>
                  )}
                  {entityType === "professor" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.phone")}</label>
                        <PhoneInput value={formPhone} onChange={setFormPhone} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.emailOptional")}</label>
                        <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="input" />
                      </div>
                    </>
                  )}
                  {entityType === "group" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.capacity")}</label>
                        <input
                          type="number"
                          value={formCapacity}
                          onChange={(e) => setFormCapacity(e.target.value)}
                          className="input"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">{t("scheduling.schedule", "Schedule")}</label>
                        <WeeklyScheduleBuilder
                          groupId={editingId || undefined}
                          // On edit the professor comes from the group itself.
                          // Reading it from `parentPath` — which is only filled
                          // in while walking the create cascade — left it null,
                          // and the builder silently disabled every conflict
                          // check on exactly the screen that needed them.
                          profId={
                            editingEntity?.prof_id
                            ?? parentPath.find((p) => p.type === "professor")?.id
                            ?? (entityType === "group" ? parentId : undefined)
                            ?? null
                          }
                          initialTiles={editingId ? (editingGroupTiles.data ?? []) : []}
                          initialTilesLoaded={!editingId || editingGroupTiles.isSuccess}
                          onChange={(tiles) => {
                            setFormTiles(tiles);
                            setTilesTouched(true);
                          }}
                          onValidityChange={setScheduleBlocked}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">{t("hierarchy.color", "Color")}</label>
                <ColorPicker value={formColor} onChange={setFormColor} />
              </div>
              <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
                <span className="text-xs text-text-secondary">* {t("hierarchy.required")}</span>
                <div className="flex gap-3">
                  <button type="button" className="btn btn-secondary" onClick={() => { setCreateOpen(false); resetForm(); }}>
                    {t("fieldsHierarchy.cancel")}
                  </button>
                  {/* Held back while the builder reports a tile the API would
                      refuse — out of opening hours, or a room already taken. */}
                  <FormButton
                    type="submit"
                    isLoading={createMutation.isPending || updateMutation.isPending}
                    disabled={scheduleBlocked}
                    title={scheduleBlocked ? t("scheduling.fixBlockingFirst", "Corrigez les créneaux signalés pour enregistrer.") : undefined}
                  >
                    {editingId ? t("fieldsHierarchy.save", "Save") : t("fieldsHierarchy.create")}
                  </FormButton>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {scheduleClash && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="alertdialog"
          aria-modal="true"
          onClick={() => setScheduleClash(null)}
        >
          <div className="bg-surface rounded-modal shadow-modal w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div
                className={`h-10 w-10 rounded-btn flex items-center justify-center shrink-0 ${
                  scheduleClash.blocking ? "bg-danger-soft text-danger" : "bg-gold-50 text-gold-500"
                }`}
              >
                <AlertTriangle size={18} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-h4 font-bold text-text-primary">
                  {scheduleClash.blocking
                    ? t("scheduling.roomTakenTitle", "Cette salle est déjà occupée")
                    : t("scheduling.clashTitle", "Ce créneau en chevauche un autre")}
                </h3>
                <p className="text-sm text-text-secondary mt-1">
                  {scheduleClash.blocking
                    ? t("scheduling.roomTakenBody", "Deux cours ne peuvent pas partager la même salle. Changez la salle ou l'horaire pour enregistrer.")
                    : t("scheduling.clashBody", "Vous pouvez enregistrer malgré tout — le chevauchement sera consigné.")}
                </p>
              </div>
            </div>

            <ul className="space-y-1.5 mb-5 max-h-48 overflow-y-auto">
              {scheduleClash.conflicts.map((conflict, i) => (
                <li key={i} className="flex items-center gap-2 rounded-btn border border-border bg-background px-3 py-2 text-xs">
                  <span className="font-medium text-text-primary truncate">{conflict.entityName}</span>
                  <span className="text-text-tertiary">·</span>
                  <span className="text-text-secondary truncate">{conflict.timeSlotLabel}</span>
                </li>
              ))}
            </ul>

            <div className="flex justify-end gap-3">
              <button className="btn btn-secondary" onClick={() => setScheduleClash(null)}>
                {scheduleClash.blocking ? t("common.close", "Fermer") : t("common.cancel", "Annuler")}
              </button>
              {!scheduleClash.blocking && (
                <FormButton
                  className="btn btn-primary"
                  isLoading={createMutation.isPending || updateMutation.isPending}
                  onClick={() => {
                    // Re-submitting with the override set is what records the
                    // decision: the clash is saved *and* audited, rather than
                    // being silently permitted on every save.
                    setAcceptedConflicts(true);
                    setScheduleClash(null);
                    const data: any = {
                      name: formName.trim(),
                      capacity: formCapacity ? parseInt(formCapacity) : undefined,
                      color: formColor ?? undefined,
                      scheduleTiles: formTiles,
                      allowConflicts: true,
                    };
                    if (editingId) updateMutation.mutate({ id: editingId, data });
                    else createMutation.mutate(data);
                  }}
                >
                  {t("scheduling.saveAnyway", "Enregistrer quand même")}
                </FormButton>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && deleteTarget.type !== "student" && (
        <HierarchyDeleteDialog
          entityType={deleteTarget.type}
          entityId={deleteTarget.id}
          entityName={deleteTarget.name}
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: [entityType === "professor" ? "professors" : entityType + "s"], refetchType: "all" });
            qc.invalidateQueries({ queryKey: ["deleted-entities"], refetchType: "all" });
            qc.invalidateQueries({ queryKey: ["hierarchy-summary"] });
          }}
        />
      )}

      {/*
        Students get the plain confirmation, not the hierarchy dialog.
        `HierarchyDeleteDialog` offers archive / cascade / re-parent, which are
        choices about an entity's *children* — a student is a leaf and has
        none, which is why it was excluded above. But nothing was rendered in
        its place: the Delete action set `deleteTarget`, the dialog above
        skipped it, and `deleteMutation` — which already handles the student
        case — was never called by anything. The button did nothing at all.
      */}
      <ConfirmDeleteDialog
        entityName={deleteTarget?.type === "student" ? deleteTarget.name : ""}
        isOpen={deleteTarget?.type === "student"}
        isDeleting={deleteMutation.isPending}
        error={deleteError ?? undefined}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => deleteMutation.mutate()}
        message={t("studentDetail.deleteConfirm")}
      />

      <StudentDetailModal
        studentId={detailStudentId ?? ""}
        isOpen={!!detailStudentId}
        onClose={() => setDetailStudentId(null)}
      />

      <DeletedEntities
        entityType={entityType}
        parentId={parentId}
        isOpen={deletedOpen}
        onClose={() => setDeletedOpen(false)}
      />
    </>
  );
}

/** A titled block inside the create/edit modal, so long student forms read in sections. */
function ModalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-btn border border-border p-4">
      <h4 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
        {title}
      </h4>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
