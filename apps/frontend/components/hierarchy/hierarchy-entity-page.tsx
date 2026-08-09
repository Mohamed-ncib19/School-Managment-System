"use client";

import { useState, useMemo, Fragment, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
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
import { useGenerateInvoiceForStudent } from "@/hooks/use-financial";
import { useHierarchyConfig, type HierarchyEntity } from "@/hooks/use-hierarchy-config";
import { useViewMode } from "@/hooks/use-view-mode";
import type { Level, Field, Professor, Group, Student, StudentStatus } from "@/types";
import { PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewToggle } from "@/components/shared/view-toggle";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import DeletedEntities from "@/components/hierarchy/deleted-entities";
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

/**
 * Every chain (level > field > professor > group id) a student is enrolled in,
 * from the explicit assignment list or the legacy single-group relation.
 */
function studentChains(student: any): Array<{ levelId: string; fieldId: string; professorId: string; groupId: string }> {
  const placements: any[] = student?.assignments?.length
    ? student.assignments
    : student?.group
      ? [{ group: student.group }]
      : [];
  return placements.map((a: any) => ({
    levelId: a.group?.professor?.field?.level?.id ?? "",
    fieldId: a.group?.professor?.field?.id ?? "",
    professorId: a.group?.professor?.id ?? "",
    groupId: a.group?.id ?? a.group_id ?? "",
  }));
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

  const showError = (err: unknown) => {
    const { title, detail } = describeError(err);
    toast.error(title, detail);
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEntity, setEditingEntity] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
  const [formSchedule, setFormSchedule] = useState("");

  // Accent color + list controls
  const [formColor, setFormColor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "nameAsc" | "nameDesc" | "color">("newest");
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

  // Fetch data based on entity type
  const { data: entities, isLoading } = useQuery({
    queryKey: [entityType === "professor" ? "professors" : entityType + "s", parentId],
    queryFn: async () => {
      switch (entityType) {
        case "level": return levelsApi.list();
        case "field": return parentId ? fieldsApi.list(parentId) : fieldsApi.list();
        case "professor": return professorsApi.list(parentId);
        case "group": return groupsApi.list(parentId);
        case "student": return studentsApi.list(parentId);
        default: return [];
      }
    },
  });

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [entityType === "professor" ? "professors" : entityType + "s"] });
      setCreateOpen(false);
      setEditingId(null);
      resetForm();
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      switch (entityType) {
        case "level": return levelsApi.delete(id);
        case "field": return fieldsApi.remove(id);
        case "professor": return professorsApi.deactivate(id);
        case "group": return groupsApi.delete(id);
        case "student": return studentsApi.delete(id);
        default: throw new Error("Unknown entity type");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [entityType === "professor" ? "professors" : entityType + "s"] });
      setDeleteId(null);
    },
    onError: showError,
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
    setFormSchedule("");
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
      setFormSchedule(entity.schedule_notes ?? "");
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
      data.schedule_notes = formSchedule.trim() || undefined;
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

  /** Search + filters + sort applied to the current list, keeping the server order. */
  const items = useMemo(() => {
    const list = entities ?? [];
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
    if (entityType === "student" && filterHasActive) {
      filtered = filtered.filter((entity: any) =>
        studentChains(entity).some((c) =>
          (!filterLevel || c.levelId === filterLevel) &&
          (!filterField || c.fieldId === filterField) &&
          (!filterProf || c.professorId === filterProf) &&
          (!filterGroup || c.groupId === filterGroup),
        ),
      );
    }
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
  }, [entities, search, sortBy, entityType, filterLevel, filterField, filterProf, filterGroup, filterHasActive]);

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
                        onClick={(e) => { e.stopPropagation(); setDeleteId(entity.id); }}
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
                      onClick={() => entityType === "student" && setDetailStudentId(entity.id)}
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
                            onClick={(e) => { e.stopPropagation(); setDeleteId(entity.id); }}
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
                        <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.scheduleNotes")}</label>
                        <textarea
                          value={formSchedule}
                          onChange={(e) => setFormSchedule(e.target.value)}
                          className="input"
                          rows={2}
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
                  <FormButton type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
                    {editingId ? t("fieldsHierarchy.save", "Save") : t("fieldsHierarchy.create")}
                  </FormButton>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        entityName={getEntityLabel(entityType)}
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        message={entityType === "student" ? undefined : t("deleted.confirm", "It will be archived and can be restored later.")}
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
