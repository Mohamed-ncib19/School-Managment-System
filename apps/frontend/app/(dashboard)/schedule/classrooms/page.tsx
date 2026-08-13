"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, RotateCcw } from "lucide-react";
import { schedulingApi } from "@/lib/api/scheduling.api";
import type { Classroom } from "@/types";
import { TableSkeleton, PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { useTranslation } from "@/lib/i18n/context";

export default function ClassroomsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [showArchived, setShowArchived] = useState(false);

  const { data: classrooms, isLoading } = useQuery({
    queryKey: ["scheduling", "classrooms", showArchived],
    queryFn: () => schedulingApi.classrooms.list(showArchived ? undefined : true),
  });

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState<Classroom | null>(null);
  const [name, setName] = useState("");
  const [floor, setFloor] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [capacity, setCapacity] = useState("");
  const [color, setColor] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filteredClassrooms = useMemo(() => {
    if (!classrooms) return [];
    const q = search.toLowerCase();
    return classrooms.filter((c) => {
      const label = `${c.name} ${c.room_number ?? ""}`.toLowerCase();
      return label.includes(q);
    });
  }, [classrooms, search]);

  const resetForm = () => {
    setName("");
    setFloor("");
    setRoomNumber("");
    setCapacity("");
    setColor("");
    setEditingClassroom(null);
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => schedulingApi.classrooms.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => schedulingApi.classrooms.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulingApi.classrooms.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setDeleteId(null);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => schedulingApi.classrooms.update(id, { is_active: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
    },
  });

  const openEdit = (room: Classroom) => {
    setEditingClassroom(room);
    setName(room.name);
    setFloor(room.floor ?? "");
    setRoomNumber(room.room_number ?? "");
    setCapacity(room.capacity?.toString() ?? "");
    setColor(room.color ?? "");
    setCreateOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const data = {
      name: name.trim(),
      floor: floor || undefined,
      room_number: roomNumber || undefined,
      capacity: capacity ? parseInt(capacity) : undefined,
      color: color || undefined,
    };
    if (editingClassroom) {
      updateMutation.mutate({ id: editingClassroom.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h4 font-bold text-text-primary">{t("nav.classrooms", "Classrooms")}</h2>
            <p className="text-xs text-text-secondary mt-1">{t("scheduling.classroomsSubtitle", "Manage rooms and buildings")}</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> {t("common.add", "Add")}
          </button>
        </div>

        <div className="card">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
              <input
                type="text"
                placeholder={t("common.search", "Search...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-9 w-full text-xs"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none whitespace-nowrap">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-primary" />
              {t("scheduling.showArchived", "Show archived")}
            </label>
          </div>
        </div>

        {isLoading ? (
          <PageLoader text={t("common.loading", "Loading...")} />
        ) : !filteredClassrooms.length ? (
          <EmptyState message={t("scheduling.noClassrooms", "No classrooms yet")} actionLabel={t("scheduling.addClassroom", "Add classroom")} onAction={openCreate} />
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.name", "Name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.roomNumber", "Room")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.capacity", "Capacity")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("common.actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredClassrooms.map((room) => (
                  <tr key={room.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-primary">
                      <span className="inline-flex items-center gap-2">
                        <span className={room.is_active ? "" : "line-through text-text-secondary"}>{room.name}</span>
                        {!room.is_active && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">{t("scheduling.archived", "Archived")}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{room.room_number ?? "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{room.capacity ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!room.is_active ? (
                          <button onClick={() => restoreMutation.mutate(room.id)} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors" aria-label={t("scheduling.restore", "Restore")} title={t("scheduling.restore", "Restore")}>
                            <RotateCcw size={14} />
                          </button>
                        ) : (
                          <>
                            <button onClick={() => openEdit(room)} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors" aria-label={t("common.edit", "Edit")}>
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => setDeleteId(room.id)} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors" aria-label={t("common.delete", "Delete")}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setCreateOpen(false); resetForm(); }}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{editingClassroom ? t("scheduling.editClassroom", "Edit Classroom") : t("scheduling.newClassroom", "New Classroom")}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.name", "Name")} *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" required autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.floor", "Floor")}</label>
                <input value={floor} onChange={(e) => setFloor(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.roomNumber", "Room number")}</label>
                <input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.capacity", "Capacity")}</label>
                <input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="input" min="0" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("common.color", "Color")}</label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="input h-10 w-full" />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => { setCreateOpen(false); resetForm(); }}>{t("common.cancel", "Cancel")}</button>
                <FormButton type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>{editingClassroom ? t("common.save", "Save") : t("common.create", "Create")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        entityName={t("scheduling.classroom", "Classroom")}
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        message={t("deleted.confirm", "It will be archived and can be restored later.")}
      />
    </>
  );
}
