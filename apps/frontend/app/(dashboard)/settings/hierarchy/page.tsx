"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronRight,
  GripVertical,
  Save,
  RotateCcw,
  Trash2,
  Plus,
  Layers,
  BookOpen,
  UserCheck,
  Users,
  AlertTriangle,
  Check,
  X,
} from "lucide-react";
import {
  hierarchyConfigApi,
  type HierarchyEntity,
  type HierarchyConfiguration,
  HIERARCHY_ENTITY_LABELS,
} from "@/lib/api/hierarchy-config.api";
import { useHierarchyConfig } from "@/hooks/use-hierarchy-config";
import { useTranslation } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { FormButton } from "@/components/forms/form-helpers";

const ENTITY_ICONS: Record<HierarchyEntity, any> = {
  level: Layers,
  field: BookOpen,
  professor: UserCheck,
  group: Users,
  student: Users,
};

const ALL_ENTITIES: HierarchyEntity[] = ["level", "field", "professor", "group", "student"];

function SortableEntityCard({
  entity,
  isLocked,
  index,
}: {
  entity: HierarchyEntity;
  isLocked: boolean;
  index: number;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entity, disabled: isLocked });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  const Icon = ENTITY_ICONS[entity];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-4 rounded-card border transition-all ${
        isDragging
          ? "border-primary shadow-modal bg-surface"
          : "border-border bg-surface hover:shadow-hover"
      } ${isLocked ? "opacity-75" : ""}`}
    >
      {!isLocked && (
        <button
          className="cursor-grab active:cursor-grabbing text-text-secondary hover:text-text-primary touch-none"
          {...attributes}
          {...listeners}
          aria-label={t("hierarchy.reorder", "Reorder")}
        >
          <GripVertical size={18} />
        </button>
      )}
      {isLocked && <div className="w-[18px]" />}

      <div className="flex h-10 w-10 items-center justify-center rounded-card bg-primary-50 dark:bg-primary/15 text-primary shrink-0">
        <Icon size={18} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-text-primary">
          {HIERARCHY_ENTITY_LABELS[entity]}
        </p>
        <p className="text-xs text-text-secondary">
          {t(`hierarchy.${entity}Desc`, `${entity.charAt(0).toUpperCase() + entity.slice(1)} entity`)}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-text-secondary bg-background px-2 py-1 rounded">
          #{index + 1}
        </span>
        {isLocked && (
          <span className="text-[10px] uppercase tracking-wider text-gold font-medium bg-gold/10 px-2 py-0.5 rounded">
            {t("hierarchy.locked", "Locked")}
          </span>
        )}
      </div>
    </div>
  );
}

export default function HierarchySettingsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { config: activeConfig, refetch: refetchConfig } = useHierarchyConfig();

  const { data: configs, isLoading } = useQuery({
    queryKey: ["hierarchy-configs"],
    queryFn: hierarchyConfigApi.list,
  });

  const [entities, setEntities] = useState<HierarchyEntity[]>(["level", "field", "professor", "group", "student"]);
  const [hasChanges, setHasChanges] = useState(false);
  const [configName, setConfigName] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (activeConfig?.entityOrder) {
      setEntities(activeConfig.entityOrder as HierarchyEntity[]);
      setConfigName(activeConfig.name);
    }
  }, [activeConfig]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setEntities((items) => {
      const oldIndex = items.indexOf(active.id as HierarchyEntity);
      const newIndex = items.indexOf(over.id as HierarchyEntity);
      const newOrder = arrayMove(items, oldIndex, newIndex);
      setHasChanges(true);
      return newOrder;
    });
  };

  const activateMutation = useMutation({
    mutationFn: (id: string) => hierarchyConfigApi.activate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hierarchy-config", "active"] });
      qc.invalidateQueries({ queryKey: ["hierarchy-configs"] });
      refetchConfig();
      toast.success(t("hierarchy.activated", "Hierarchy activated"), t("hierarchy.activatedDesc", "The new hierarchy is now active."));
    },
    onError: () => {
      toast.error(t("hierarchy.activateFailed", "Failed to activate hierarchy"));
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data: { name: string; entityOrder: HierarchyEntity[] }) =>
      activeConfig
        ? hierarchyConfigApi.update(activeConfig.id, data)
        : hierarchyConfigApi.create(data),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["hierarchy-configs"] });
      qc.invalidateQueries({ queryKey: ["hierarchy-config", "active"] });
      refetchConfig();
      setHasChanges(false);
      setShowSaveModal(false);
      toast.success(t("hierarchy.saved", "Hierarchy saved"), t("hierarchy.savedDesc", "Your hierarchy configuration has been saved."));
    },
    onError: () => {
      toast.error(t("hierarchy.saveFailed", "Failed to save hierarchy"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hierarchyConfigApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hierarchy-configs"] });
      setShowDeleteConfirm(null);
      toast.success(t("hierarchy.deleted", "Hierarchy deleted"));
    },
    onError: () => {
      toast.error(t("hierarchy.deleteFailed", "Failed to delete hierarchy"));
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => hierarchyConfigApi.resetToDefault(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hierarchy-configs"] });
      qc.invalidateQueries({ queryKey: ["hierarchy-config", "active"] });
      refetchConfig();
      toast.success(t("hierarchy.reset", "Reset to default"), t("hierarchy.resetDesc", "Hierarchy has been reset to the default configuration."));
    },
    onError: () => {
      toast.error(t("hierarchy.resetFailed", "Failed to reset hierarchy"));
    },
  });

  const handleSave = () => {
    if (!configName.trim()) {
      toast.error(t("hierarchy.nameRequired", "Please enter a name for the hierarchy configuration"));
      return;
    }
    saveMutation.mutate({ name: configName.trim(), entityOrder: entities });
  };

  const handleReorder = (newOrder: HierarchyEntity[]) => {
    setEntities(newOrder);
    setHasChanges(true);
  };

  const isDefault = activeConfig?.isDefault ?? false;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/settings" className="hover:text-primary">{t("settings.title")}</Link>
        <ChevronRight size={14} />
        <span className="text-text-primary font-medium">{t("hierarchy.title", "Navigation Hierarchy")}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h4 font-bold text-text-primary">{t("hierarchy.title", "Navigation Hierarchy")}</h2>
          <p className="text-xs text-text-secondary">{t("hierarchy.subtitle", "Configure the order in which hierarchy entities are navigated throughout the application.")}</p>
        </div>
        <div className="flex items-center gap-3">
          {hasChanges && (
            <button
              onClick={() => {
                if (activeConfig?.entityOrder) {
                  setEntities(activeConfig.entityOrder as HierarchyEntity[]);
                }
                setHasChanges(false);
              }}
              className="btn btn-secondary text-xs"
            >
              <X size={14} /> {t("hierarchy.discard", "Discard")}
            </button>
          )}
          <button
            onClick={() => setShowSaveModal(true)}
            disabled={!hasChanges}
            className="btn btn-primary text-xs"
          >
            <Save size={14} /> {t("hierarchy.saveConfig", "Save Configuration")}
          </button>
        </div>
      </div>

      {/* Builder */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Drag & Drop List */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-h4 font-bold text-text-primary">{t("hierarchy.builder", "Hierarchy Builder")}</h3>
              <span className="text-xs text-text-secondary">
                {t("hierarchy.dragHint", "Drag to reorder")}
              </span>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={entities} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {entities.map((entity, index) => (
                    <SortableEntityCard
                      key={entity}
                      entity={entity}
                      isLocked={entity === "student"}
                      index={index}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Visual connectors */}
            <div className="mt-4 flex items-center justify-center gap-2 text-text-secondary">
              {entities.map((entity, idx) => (
                <div key={entity} className="flex items-center gap-2">
                  <span className="text-xs font-medium">{HIERARCHY_ENTITY_LABELS[entity]}</span>
                  {idx < entities.length - 1 && (
                    <span className="text-primary">→</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Active Config Info */}
          <div className="card">
            <h3 className="text-h4 font-bold text-text-primary mb-4">{t("hierarchy.activeConfig", "Active Configuration")}</h3>
            {activeConfig ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-text-secondary">{t("hierarchy.name", "Name")}</p>
                  <p className="font-medium text-text-primary">{activeConfig.name}</p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">{t("hierarchy.order", "Order")}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(activeConfig.entityOrder as HierarchyEntity[]).map((e, i) => (
                      <span key={e} className="text-xs bg-primary-50 dark:bg-primary/15 text-primary px-2 py-0.5 rounded">
                        {i + 1}. {HIERARCHY_ENTITY_LABELS[e]}
                      </span>
                    ))}
                  </div>
                </div>
                {isDefault && (
                  <span className="text-[10px] uppercase tracking-wider text-success-strong font-medium bg-success-soft px-2 py-0.5 rounded">
                    {t("hierarchy.default", "Default")}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">{t("hierarchy.noActive", "No active configuration")}</p>
            )}
          </div>

          {/* Saved Configurations */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-h4 font-bold text-text-primary">{t("hierarchy.savedConfigs", "Saved Configurations")}</h3>
            </div>
            {isLoading ? (
              <p className="text-sm text-text-secondary">{t("common.loading", "Loading...")}</p>
            ) : configs && configs.length > 0 ? (
              <div className="space-y-2">
                {configs.map((config) => (
                  <div
                    key={config.id}
                    className={`p-3 rounded-card border transition-colors ${
                      config.isActive
                        ? "border-primary bg-primary-50/50 dark:bg-primary/5"
                        : "border-border hover:bg-background/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary truncate">{config.name}</p>
                        <p className="text-xs text-text-secondary">
                          {(config.entityOrder as HierarchyEntity[]).map((e) => HIERARCHY_ENTITY_LABELS[e]).join(" → ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        {config.isActive ? (
                          <span className="text-[10px] uppercase tracking-wider text-primary font-medium bg-primary-50 dark:bg-primary/15 px-2 py-0.5 rounded">
                            {t("hierarchy.active", "Active")}
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={() => activateMutation.mutate(config.id)}
                              className="h-7 w-7 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                              aria-label={t("hierarchy.activate", "Activate")}
                              title={t("hierarchy.activate", "Activate")}
                            >
                              <Check size={14} />
                            </button>
                            {!config.isDefault && (
                              <button
                                onClick={() => setShowDeleteConfirm(config.id)}
                                className="h-7 w-7 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                                aria-label={t("hierarchy.delete", "Delete")}
                                title={t("hierarchy.delete", "Delete")}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">{t("hierarchy.noSaved", "No saved configurations")}</p>
            )}
          </div>

          {/* Reset */}
          {!isDefault && (
            <button
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="btn btn-secondary w-full text-xs"
            >
              <RotateCcw size={14} /> {t("hierarchy.resetToDefault", "Reset to Default")}
            </button>
          )}
        </div>
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSaveModal(false)}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{t("hierarchy.saveConfig", "Save Configuration")}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("hierarchy.name", "Name")} *</label>
                <input
                  value={configName}
                  onChange={(e) => setConfigName(e.target.value)}
                  className="input"
                  placeholder={t("hierarchy.namePlaceholder", "e.g. Custom Hierarchy")}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("hierarchy.preview", "Preview")}</label>
                <div className="flex flex-wrap gap-1">
                  {entities.map((e, i) => (
                    <span key={e} className="text-xs bg-primary-50 dark:bg-primary/15 text-primary px-2 py-0.5 rounded">
                      {i + 1}. {HIERARCHY_ENTITY_LABELS[e]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button className="btn btn-secondary" onClick={() => setShowSaveModal(false)}>
                  {t("fields.cancel")}
                </button>
                <FormButton onClick={handleSave} isLoading={saveMutation.isPending}>
                  {t("hierarchy.save", "Save")}
                </FormButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-danger-soft flex items-center justify-center text-danger">
                <AlertTriangle size={20} />
              </div>
              <h3 className="text-h4 font-bold">{t("hierarchy.confirmDelete", "Delete Configuration?")}</h3>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              {t("hierarchy.deleteDesc", "This action cannot be undone. The hierarchy configuration will be permanently deleted.")}
            </p>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(null)}>
                {t("fields.cancel")}
              </button>
              <button
                onClick={() => showDeleteConfirm && deleteMutation.mutate(showDeleteConfirm)}
                disabled={deleteMutation.isPending}
                className="btn btn-danger"
              >
                {deleteMutation.isPending ? t("common.loading", "Loading...") : t("hierarchy.delete", "Delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
