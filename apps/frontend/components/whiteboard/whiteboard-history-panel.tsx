"use client";

import { useState } from "react";
import { X, Trash2, StickyNote, Loader2, History } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { useWhiteboards, useDeleteWhiteboard } from "@/hooks/use-whiteboard";
import type { Whiteboard } from "@/types";

/** "Aujourd'hui 14:20" / "Hier 09:05" / "12 mars 2026" */
function formatEditedAt(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay(date, now)) return `Aujourd'hui ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Hier ${time}`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function createdLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

interface WhiteboardHistoryPanelProps {
  onOpenBoard: (id: string) => void;
  onClose: () => void;
}

/**
 * Saved boards for the current user: title, linked session, last edit and
 * quick actions. Deleting asks inline for confirmation; opening hands the id
 * to the workspace, which replaces the canvas with that board's scene.
 */
export default function WhiteboardHistoryPanel({ onOpenBoard, onClose }: WhiteboardHistoryPanelProps) {
  const { t } = useTranslation();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: boards, isLoading } = useWhiteboards();

  const deleteMutation = useDeleteWhiteboard();

  const handleDelete = (board: Whiteboard) => {
    deleteMutation.mutate(board.id, {
      onSuccess: () => setDeleteId(null),
    });
  };

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t("whiteboard.history", "Historique des tableaux")}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-h4 font-bold text-text-primary">
          <History size={16} className="text-primary" aria-hidden="true" />
          {t("whiteboard.history", "Historique")}
        </h3>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-btn text-text-secondary transition-colors hover:bg-neutral-soft hover:text-text-primary"
          aria-label={t("common.close", "Fermer")}
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-secondary">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {t("common.loading", "Chargement…")}
          </div>
        ) : !boards || boards.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <StickyNote size={22} className="text-text-secondary" aria-hidden="true" />
            <p className="text-xs text-text-secondary">
              {t("whiteboard.noBoards", "Aucun tableau enregistré pour le moment.")}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {boards.map((board) => {
              const confirming = deleteId === board.id;
              return (
                <li
                  key={board.id}
                  className={`rounded-card border p-3 transition-colors ${
                    confirming ? "border-danger/40 bg-danger-soft dark:bg-danger/10" : "border-border bg-background"
                  }`}
                >
                  {confirming ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 text-xs text-text-secondary">
                        {t("whiteboard.confirmDelete", "Supprimer ce tableau ?")}
                      </p>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => handleDelete(board)}
                          disabled={deleteMutation.isPending}
                          className="btn btn-danger px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("common.delete", "Supprimer")}
                        </button>
                        <button
                          onClick={() => setDeleteId(null)}
                          className="btn btn-secondary px-2 py-1 text-[11px]"
                        >
                          {t("common.cancel", "Annuler")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOpenBoard(board.id)}
                        className="min-w-0 flex-1 text-left"
                        title={t("whiteboard.open", "Ouvrir")}
                      >
                        <p className="truncate text-sm font-medium text-text-primary">{board.title}</p>
                        <p className="mt-1 text-[11px] text-text-secondary">
                          {t("whiteboard.edited", "Modifié")} {formatEditedAt(board.updatedAt)}
                          <span className="mx-1 text-border">·</span>
                          {t("whiteboard.created", "Créé")} {createdLabel(board.createdAt)}
                        </p>
                      </button>
                      <button
                        onClick={() => setDeleteId(board.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn text-text-secondary transition-colors hover:bg-red-50 hover:text-danger dark:hover:bg-danger/10"
                        aria-label={t("common.delete", "Supprimer")}
                        title={t("common.delete", "Supprimer")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}