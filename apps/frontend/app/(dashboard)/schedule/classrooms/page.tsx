"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, DoorOpen, Users, Layers, Hash } from "lucide-react";
import { schedulingApi } from "@/lib/api/scheduling.api";
import type { Classroom } from "@/types";
import { PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import ColorPicker from "@/components/forms/color-picker";
import { useTranslation } from "@/lib/i18n/context";

/**
 * Rooms as cards rather than a four-column table.
 *
 * A room is not a row of text: its identity is a name, a number, how many
 * people fit and — now that the field works — a colour, and a card can carry
 * all four at a glance where the table showed name/room/capacity and dropped
 * the rest. The colour is the point of the redesign: it was stored, shipped by
 * the API and rendered nowhere, so setting it appeared to do nothing.
 */
export default function ClassroomsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // `true`: archived rooms no longer exist as a concept — deleting a room
  // deletes it — so there is nothing to toggle between.
  const { data: classrooms, isLoading } = useQuery({
    queryKey: ["scheduling", "classrooms"],
    queryFn: () => schedulingApi.classrooms.list(true),
  });

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState<Classroom | null>(null);
  const [name, setName] = useState("");
  const [floor, setFloor] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [capacity, setCapacity] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Classroom | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filteredClassrooms = useMemo(() => {
    if (!classrooms) return [];
    const q = search.trim().toLowerCase();
    if (!q) return classrooms;
    return classrooms.filter((c) =>
      `${c.name} ${c.room_number ?? ""} ${c.floor ?? ""}`.toLowerCase().includes(q),
    );
  }, [classrooms, search]);

  const resetForm = () => {
    setName("");
    setFloor("");
    setRoomNumber("");
    setCapacity("");
    setColor(null);
    setFormError(null);
    setEditingClassroom(null);
  };

  const apiMessage = (err: any, fallback: string) =>
    err?.response?.data?.error?.message || err?.response?.data?.message || fallback;

  const createMutation = useMutation({
    mutationFn: (data: any) => schedulingApi.classrooms.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: any) => setFormError(apiMessage(err, t("scheduling.saveFailed", "Enregistrement impossible"))),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => schedulingApi.classrooms.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: any) => setFormError(apiMessage(err, t("scheduling.saveFailed", "Enregistrement impossible"))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulingApi.classrooms.remove(id),
    onSuccess: () => {
      // Rooms appear in every session picker, so the whole scheduling tree is
      // refreshed rather than just this list.
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setDeleteTarget(null);
      setDeleteError(null);
    },
    // A room still on the timetable is refused by the API; the reason names the
    // groups in the way, so it is shown in the dialog instead of a toast that
    // disappears before it can be read.
    onError: (err: any) =>
      setDeleteError(
        apiMessage(err, t("scheduling.deleteFailed", "Cette salle n'a pas pu être supprimée.")),
      ),
  });

  const openEdit = (room: Classroom) => {
    setEditingClassroom(room);
    setName(room.name);
    setFloor(room.floor ?? "");
    setRoomNumber(room.room_number ?? "");
    setCapacity(room.capacity?.toString() ?? "");
    setColor(room.color ?? null);
    setFormError(null);
    setCreateOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const closeForm = () => {
    setCreateOpen(false);
    resetForm();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setFormError(null);
    const data = {
      name: name.trim(),
      floor: floor.trim() || undefined,
      room_number: roomNumber.trim() || undefined,
      capacity: capacity ? parseInt(capacity, 10) : undefined,
      // `null` rather than `undefined` when cleared: the update DTO treats
      // undefined as "leave alone", so only an explicit null removes a colour.
      color: editingClassroom ? color : color ?? undefined,
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-h4 font-bold text-text-primary">{t("nav.classrooms", "Salles")}</h2>
            <p className="text-xs text-text-secondary mt-1">
              {t("scheduling.classroomsSubtitle", "Gérer les salles et les bâtiments")}
            </p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> {t("scheduling.addClassroom", "Ajouter une salle")}
          </button>
        </div>

        <div className="card">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                aria-hidden="true"
              />
              <input
                type="text"
                placeholder={t("scheduling.searchClassroom", "Rechercher une salle…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-9 w-full text-xs"
              />
            </div>
            {classrooms && classrooms.length > 0 && (
              <span className="text-xs text-text-secondary tabular-nums whitespace-nowrap">
                {filteredClassrooms.length}
                {filteredClassrooms.length !== classrooms.length ? ` / ${classrooms.length}` : ""}{" "}
                {t("scheduling.roomsCount", "salle(s)")}
              </span>
            )}
          </div>
        </div>

        {isLoading ? (
          <PageLoader text={t("common.loading", "Chargement…")} />
        ) : !filteredClassrooms.length ? (
          <EmptyState
            message={
              search
                ? t("scheduling.noClassroomMatch", "Aucune salle ne correspond à cette recherche.")
                : t("scheduling.noClassrooms", "Aucune salle pour le moment")
            }
            actionLabel={search ? undefined : t("scheduling.addClassroom", "Ajouter une salle")}
            onAction={search ? undefined : openCreate}
          />
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredClassrooms.map((room) => (
              <ClassroomCard
                key={room.id}
                room={room}
                onEdit={() => openEdit(room)}
                onDelete={() => {
                  setDeleteError(null);
                  setDeleteTarget(room);
                }}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={closeForm}
        >
          <div
            className="bg-surface rounded-modal shadow-modal p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-h4 font-bold mb-4 text-text-primary">
              {editingClassroom
                ? t("scheduling.editClassroom", "Modifier la salle")
                : t("scheduling.newClassroom", "Nouvelle salle")}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="room-name" className="block text-sm font-medium mb-1">
                  {t("scheduling.name", "Nom")} *
                </label>
                <input
                  id="room-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input w-full"
                  required
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="room-number" className="block text-sm font-medium mb-1">
                    {t("scheduling.roomNumber", "Numéro")}
                  </label>
                  <input
                    id="room-number"
                    value={roomNumber}
                    onChange={(e) => setRoomNumber(e.target.value)}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label htmlFor="room-floor" className="block text-sm font-medium mb-1">
                    {t("scheduling.floor", "Étage")}
                  </label>
                  <input
                    id="room-floor"
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    className="input w-full"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="room-capacity" className="block text-sm font-medium mb-1">
                  {t("scheduling.capacity", "Capacité")}
                </label>
                <input
                  id="room-capacity"
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="input w-full"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{t("common.color", "Couleur")}</label>
                {/*
                  The shared swatch picker, not a raw `<input type="color">`.
                  That input cannot represent "no colour": the browser coerces an
                  empty value to #000000, so the field showed black while the
                  form state stayed empty and saved nothing unless the operator
                  happened to open the picker and choose. This one round-trips
                  null honestly and offers the same palette as the hierarchy.
                */}
                <ColorPicker value={color} onChange={setColor} />
              </div>

              {formError && (
                <p role="alert" className="text-xs text-danger">
                  {formError}
                </p>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={closeForm}>
                  {t("common.cancel", "Annuler")}
                </button>
                <FormButton type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
                  {editingClassroom ? t("common.save", "Enregistrer") : t("common.create", "Créer")}
                </FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        entityName={
          deleteTarget ? `« ${deleteTarget.name} »` : t("scheduling.classroom", "cette salle")
        }
        isOpen={!!deleteTarget}
        isDeleting={deleteMutation.isPending}
        error={deleteError ?? undefined}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        message={t(
          "scheduling.deleteClassroomConfirm",
          "Cette salle sera définitivement supprimée. Cette action est irréversible.",
        )}
      />
    </>
  );
}

/** One room, with its colour as the card's accent. */
function ClassroomCard({
  room,
  onEdit,
  onDelete,
  t,
}: {
  room: Classroom;
  onEdit: () => void;
  onDelete: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  const accent = room.color ?? undefined;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card transition-shadow hover:shadow-hover">
      {/* The accent bar is how a colour reads at a glance in a grid. A room
          without one gets the neutral border, not a black bar. */}
      <span
        aria-hidden="true"
        className="h-1.5 w-full shrink-0"
        style={{ backgroundColor: accent ?? "var(--color-border)" }}
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-btn"
            style={
              accent
                ? { backgroundColor: `${accent}1A`, color: accent }
                : undefined
            }
          >
            <DoorOpen size={17} className={accent ? "" : "text-text-secondary"} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-text-primary" title={room.name}>
              {room.name}
            </h3>
            {room.room_number ? (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-text-secondary tabular-nums">
                <Hash size={11} aria-hidden="true" />
                {room.room_number}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-text-secondary/70 italic">
                {t("scheduling.noRoomNumber", "Sans numéro")}
              </p>
            )}
          </div>
        </div>

        <dl className="flex flex-wrap gap-1.5">
          <MetaChip
            icon={<Users size={11} aria-hidden="true" />}
            label={t("scheduling.capacity", "Capacité")}
            value={room.capacity != null ? String(room.capacity) : "—"}
          />
          {room.floor && (
            <MetaChip
              icon={<Layers size={11} aria-hidden="true" />}
              label={t("scheduling.floor", "Étage")}
              value={room.floor}
            />
          )}
        </dl>

        {/* Actions sit at the bottom so cards of differing content still line
            their buttons up across a row. */}
        <div className="mt-auto flex items-center justify-end gap-1 border-t border-border pt-3">
          <button
            onClick={onEdit}
            className="inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-primary-50 hover:text-primary"
            aria-label={`${t("common.edit", "Modifier")} ${room.name}`}
          >
            <Pencil size={13} aria-hidden="true" />
            {t("common.edit", "Modifier")}
          </button>
          <button
            onClick={onDelete}
            className="inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-danger-soft hover:text-danger"
            aria-label={`${t("common.delete", "Supprimer")} ${room.name}`}
          >
            <Trash2 size={13} aria-hidden="true" />
            {t("common.delete", "Supprimer")}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-text-secondary">
      {icon}
      <dt className="sr-only">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
