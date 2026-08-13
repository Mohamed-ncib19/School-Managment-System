"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, GripVertical } from "lucide-react";
import { schedulingApi } from "@/lib/api/scheduling.api";
import type { TimeSlot } from "@/types";
import { TableSkeleton, PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { useTranslation } from "@/lib/i18n/context";

const DAY_NAMES = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

export default function TimeSlotsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: timeSlots, isLoading } = useQuery({
    queryKey: ["scheduling", "time-slots"],
    queryFn: () => schedulingApi.timeSlots.list(),
  });

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimeSlot | null>(null);
  const [label, setLabel] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:30");
  const [sortOrder, setSortOrder] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filteredSlots = useMemo(() => {
    if (!timeSlots) return [];
    const q = search.toLowerCase();
    return timeSlots.filter((s) => {
      const day = DAY_NAMES[s.day_of_week] ?? `Day ${s.day_of_week}`;
      return `${day} ${s.label} ${s.start_time} ${s.end_time}`.toLowerCase().includes(q);
    });
  }, [timeSlots, search]);

  const resetForm = () => {
    setLabel("");
    setDayOfWeek(0);
    setStartTime("09:00");
    setEndTime("10:30");
    setSortOrder("");
    setEditingSlot(null);
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => schedulingApi.timeSlots.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => schedulingApi.timeSlots.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulingApi.timeSlots.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setDeleteId(null);
    },
  });

  const openEdit = (slot: TimeSlot) => {
    setEditingSlot(slot);
    setLabel(slot.label);
    setDayOfWeek(slot.day_of_week);
    setStartTime(slot.start_time);
    setEndTime(slot.end_time);
    setSortOrder(slot.sort_order?.toString() ?? "");
    setCreateOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !startTime || !endTime) return;
    const data = {
      label: label.trim(),
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      sort_order: sortOrder ? parseInt(sortOrder) : undefined,
    };
    if (editingSlot) {
      updateMutation.mutate({ id: editingSlot.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h4 font-bold text-text-primary">{t("nav.timeSlots", "Working Hours")}</h2>
            <p className="text-xs text-text-secondary mt-1">{t("scheduling.timeSlotsSubtitle", "Manage daily time slots")}</p>
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
          </div>
        </div>

        {isLoading ? (
          <PageLoader text={t("common.loading", "Loading...")} />
        ) : !filteredSlots.length ? (
          <EmptyState message={t("scheduling.noTimeSlots", "No time slots yet")} actionLabel={t("scheduling.addTimeSlot", "Add time slot")} onAction={openCreate} />
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase w-8"></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.day", "Day")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.label", "Label")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.startTime", "Start")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.endTime", "End")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.sortOrder", "Sort")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("common.actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredSlots.map((slot) => (
                  <tr key={slot.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-4 py-3 text-text-secondary"><GripVertical size={14} /></td>
                    <td className="px-4 py-3 text-text-secondary">{DAY_NAMES[slot.day_of_week] ?? `Day ${slot.day_of_week}`}</td>
                    <td className="px-4 py-3 font-medium text-primary">{slot.label}</td>
                    <td className="px-4 py-3 text-text-secondary">{slot.start_time}</td>
                    <td className="px-4 py-3 text-text-secondary">{slot.end_time}</td>
                    <td className="px-4 py-3 text-text-secondary">{slot.sort_order ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(slot)} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors" aria-label={t("common.edit", "Edit")}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleteId(slot.id)} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors" aria-label={t("common.delete", "Delete")}>
                          <Trash2 size={14} />
                        </button>
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
            <h3 className="text-h4 font-bold mb-4">{editingSlot ? t("scheduling.editTimeSlot", "Edit Time Slot") : t("scheduling.newTimeSlot", "New Time Slot")}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.label", "Label")} *</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} className="input" required autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.day", "Day")} *</label>
                <select value={dayOfWeek} onChange={(e) => setDayOfWeek(parseInt(e.target.value))} className="input">
                  {DAY_NAMES.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">{t("scheduling.startTime", "Start time")} *</label>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input" required />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">{t("scheduling.endTime", "End time")} *</label>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.sortOrder", "Sort order")}</label>
                <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="input" />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => { setCreateOpen(false); resetForm(); }}>{t("common.cancel", "Cancel")}</button>
                <FormButton type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>{editingSlot ? t("common.save", "Save") : t("common.create", "Create")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        entityName={t("scheduling.timeSlot", "Time slot")}
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        message={t("deleted.confirm", "It will be archived and can be restored later.")}
      />
    </>
  );
}
