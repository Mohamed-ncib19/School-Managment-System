"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  X,
  Save,
  History,
  Plus,
  StickyNote,
  Loader2,
  AlertTriangle,
  PenLine,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils/format";
import { useToast } from "@/components/shared/toast";
import { useAppearance } from "@/hooks/use-appearance";
import { useWhiteboardStore } from "@/hooks/use-whiteboard-store";
import { useQueryClient } from "@tanstack/react-query";
import { useWhiteboard, whiteboardKeys } from "@/hooks/use-whiteboard";
import { whiteboardApi, type WhiteboardScenePayload } from "@/lib/api/whiteboard.api";
import type { WhiteboardScene } from "@/types";
import WhiteboardHistoryPanel from "./whiteboard-history-panel";
import type { CanvasSnapshot } from "./excalidraw-canvas";

/** Debounce between the last canvas change and an autosave round-trip. */
const AUTOSAVE_DELAY = 1500;
/** Debounce for writing the unsaved-new-board draft to sessionStorage. */
const DRAFT_DELAY = 800;
const DRAFT_KEY = "iq-whiteboard-draft";
const AUTOSAVE_PREF_KEY = "iq-whiteboard-autosave";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

type PendingAction = { kind: "close" } | { kind: "new" } | { kind: "open-board"; id: string };

interface Draft {
  title: string;
  scene: WhiteboardScene;
}

function messageOf(err: unknown): string {
  const anyErr = err as { response?: { data?: { error?: { message?: string } } } };
  return anyErr?.response?.data?.error?.message || "Une erreur est survenue";
}

/** The persisted document shape Excalidraw itself writes and reads back. */
function buildScene(snapshot: CanvasSnapshot): WhiteboardScenePayload {
  // `collaborators` is a live Map that JSON flattens to `{}` (crashing the
  // canvas on restore) and only tracks ephemeral live-collab cursors —
  // it is deliberately not persisted.
  const { collaborators: _collaborators, ...appState } = snapshot.appState;
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [...snapshot.elements] as unknown[],
    appState,
    files: snapshot.files ?? {},
  };
}

/**
 * Cheap content fingerprint. Excalidraw's `onChange` also fires for viewport
 * noise (zoom, pan, selection), which must not mark the board dirty: the
 * autosave tick compares this signature and skips the round-trip when only
 * the viewport moved.
 */
function sceneSignature(snapshot: {
  elements: unknown;
  files?: unknown;
  appState?: { viewBackgroundColor?: unknown; gridSize?: unknown; name?: unknown };
}): string {
  return JSON.stringify({
    elements: snapshot.elements,
    files: snapshot.files,
    viewBackgroundColor: snapshot.appState?.viewBackgroundColor,
    gridSize: snapshot.appState?.gridSize,
    name: snapshot.appState?.name,
  });
}

function signatureOfStoredScene(scene: WhiteboardScene | null): string | null {
  if (!scene) return null;
  try {
    return sceneSignature({
      elements: scene.elements ?? [],
      files: scene.files ?? {},
      appState: (scene.appState ?? {}) as Record<string, unknown>,
    });
  } catch {
    return null;
  }
}

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (!parsed || !Array.isArray(parsed.scene?.elements)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

const ExcalidrawCanvas = dynamic(() => import("./excalidraw-canvas"), {
  ssr: false,
  loading: () => <EditorLoader />,
});

function EditorLoader() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-text-secondary">
      <Loader2 size={22} className="animate-spin" aria-hidden="true" />
      <p className="text-xs">{t("common.loading", "Chargement…")}</p>
    </div>
  );
}

function formatSaveTime(date: Date): string {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * The whiteboard editor: a full-screen Excalidraw canvas with autosave, board
 * history, and unsaved-draft recovery.
 *
 * Rendered only by the /whiteboard route (app/(dashboard)/whiteboard) —
 * closing navigates back to the dashboard. Keeping Excalidraw out of the
 * dashboard shell's graph is what keeps every other route's dev compile fast
 * (it costs ~8s to compile).
 *
 * Editing state is local; which board is being edited lives in the store so
 * any screen can open or switch boards. The canvas is keyed per board so
 * Excalidraw remounts with the restored scene (its `initialData` is read on
 * mount only).
 */
export default function WhiteboardWorkspace() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const theme = useAppearance((s) => s.theme);
  const boardId = useWhiteboardStore((s) => s.boardId);

  const [title, setTitle] = useState("Nouveau tableau");
  const [initialScene, setInitialScene] = useState<WhiteboardScene | null>(null);
  const [, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [draftNotice, setDraftNotice] = useState<Draft | null>(null);
  const [nonce, setNonce] = useState(0);

  // Autosave preference: persisted locally, ON by default. When enabled, new
  // boards are also created automatically on the first edit instead of only
  // being kept as a session draft.
  const [autosaveEnabled, setAutosaveEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTOSAVE_PREF_KEY) !== "0";
    } catch {
      return true;
    }
  });

  // Mirror values that the debounced callbacks must read without going stale.
  const sceneRef = useRef<CanvasSnapshot | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const metaDirtyRef = useRef(false);
  // Set when the canvas is about to remount with a known scene (open, board
  // load, resume, reset). The first `onChange` after a remount reports the
  // restored scene itself — that becomes the saved baseline, not an edit.
  const baselinePendingRef = useRef(true);
  // Mirror of `autosaveEnabled` for the debounced callback (read at fire time).
  const autosaveEnabledRef = useRef(autosaveEnabled);
  const savingRef = useRef(false);
  const titleRef = useRef("");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: board, isFetching: boardLoading, isError: boardError } = useWhiteboard(boardId);

  // ------------------------------------------------------------------
  // Lifecycle: fresh editor on mount, restore scene when a board is loaded
  // ------------------------------------------------------------------
  useEffect(() => {
    titleRef.current = "";
    setTitle("Nouveau tableau");
    setInitialScene(null);
    dirtyRef.current = false;
    metaDirtyRef.current = false;
    setDirty(false);
    setSaveState("idle");
    setLastSavedAt(null);
    setHistoryOpen(false);
    setPendingAction(null);
    setDraftNotice(readDraft());
    baselinePendingRef.current = true;
    setNonce((n) => n + 1);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!boardId) return;
    if (boardLoading) return;
    if (boardError) {
      // The board no longer exists (deleted elsewhere, or a stale id): fall
      // back to a fresh board instead of keeping a zombie boardId that would
      // refetch a 404 on every invalidation.
      useWhiteboardStore.setState({ boardId: null });
      titleRef.current = "";
      setTitle("Nouveau tableau");
      setInitialScene(null);
      lastSavedSignatureRef.current = null;
      metaDirtyRef.current = false;
      dirtyRef.current = false;
      setDirty(false);
      setSaveState("idle");
      setLastSavedAt(null);
      setHistoryOpen(false);
      baselinePendingRef.current = true;
      setNonce((n) => n + 1);
      return;
    }
    if (!board) return;
    titleRef.current = board.title;
    setTitle(board.title);
    setInitialScene(board.scene ?? null);
    lastSavedSignatureRef.current = signatureOfStoredScene(board.scene ?? null);
    metaDirtyRef.current = false;
    dirtyRef.current = false;
    setDirty(false);
    setSaveState("saved");
    setLastSavedAt(new Date(board.updatedAt));
    setDraftNotice(null);
    setHistoryOpen(false);
    baselinePendingRef.current = true;
    setNonce((n) => n + 1);
  }, [boardId, board, boardLoading, boardError]);

useEffect(() => {
    autosaveEnabledRef.current = autosaveEnabled;
    try {
      localStorage.setItem(AUTOSAVE_PREF_KEY, autosaveEnabled ? "1" : "0");
    } catch {
      /* storage unavailable — the preference simply won't persist */
    }
  }, [autosaveEnabled]);

  // ------------------------------------------------------------------
  // Autosave
  // ------------------------------------------------------------------
  const scheduleAutosave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => void runAutosave(), AUTOSAVE_DELAY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAutosave = useCallback(async () => {
    if (savingRef.current) return;
    const currentBoardId = useWhiteboardStore.getState().boardId;
    if (!sceneRef.current) return;
    // Autosave OFF: a board that was never saved stays a local draft only.
    if (!currentBoardId && !autosaveEnabledRef.current) return;
    const scene = buildScene(sceneRef.current);
    const signature = sceneSignature(scene);
    if (signature === lastSavedSignatureRef.current && !metaDirtyRef.current) {
      dirtyRef.current = false;
      setDirty(false);
      setSaveState("saved");
      return;
    }
    savingRef.current = true;
    setSaveState("saving");
    try {
      if (currentBoardId) {
        await whiteboardApi.update(currentBoardId, {
          scene,
          title: titleRef.current.trim() || undefined,
        });
      } else {
        // Autosave ON + a board that never existed: create it on the first
        // edit, so nothing is ever lost.
        const created = await whiteboardApi.create({
          title: titleRef.current.trim() || undefined,
          scene,
        });
        useWhiteboardStore.setState({ boardId: created.id });
        clearDraft();
      }
      lastSavedSignatureRef.current = signature;
      metaDirtyRef.current = false;
      dirtyRef.current = false;
      setDirty(false);
      setSaveState("saved");
      setLastSavedAt(new Date());
      void queryClient.invalidateQueries({ queryKey: whiteboardKeys.all });
    } catch (err) {
      setSaveState("error");
      toast.error(t("whiteboard.saveFailed", "Enregistrement impossible"), messageOf(err));
    } finally {
      savingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Explicit save: creates the row for a new board, otherwise updates. */
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return true;
    const currentBoardId = useWhiteboardStore.getState().boardId;
    const snapshot: CanvasSnapshot =
      sceneRef.current ?? {
        elements: [],
        // `AppState` has no all-optional form; Excalidraw itself will fill the
        // rest the moment the canvas renders, this fallback only covers an
        // explicit save of a still-empty board.
        appState: { viewBackgroundColor: useAppearance.getState().theme === "dark" ? "#141417" : "#ffffff" } as unknown as CanvasSnapshot["appState"],
        files: {},
      };
    const scene = buildScene(snapshot);
    savingRef.current = true;
    setSaveState("saving");
    try {
      if (currentBoardId) {
        await whiteboardApi.update(currentBoardId, {
          scene,
          title: titleRef.current.trim() || undefined,
        });
      } else {
        const created = await whiteboardApi.create({
          title: titleRef.current.trim() || undefined,
          scene,
        });
        useWhiteboardStore.setState({ boardId: created.id });
        clearDraft();
        toast.success(t("whiteboard.saved", "Tableau enregistré"));
      }
      lastSavedSignatureRef.current = sceneSignature(scene);
      metaDirtyRef.current = false;
      dirtyRef.current = false;
      setDirty(false);
      setSaveState("saved");
      setLastSavedAt(new Date());
      void queryClient.invalidateQueries({ queryKey: whiteboardKeys.all });
      return true;
    } catch (err) {
      setSaveState("error");
      toast.error(t("whiteboard.saveFailed", "Enregistrement impossible"), messageOf(err));
      return false;
    } finally {
      savingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Draft recovery (unsaved new boards, e.g. after a refresh)
  // ------------------------------------------------------------------
  const scheduleDraftWrite = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (useWhiteboardStore.getState().boardId || !sceneRef.current) return;
      try {
        sessionStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            title: titleRef.current.trim() || "Nouveau tableau",
            scene: buildScene(sceneRef.current),
          } satisfies Draft),
        );
      } catch {
        /* storage full or unavailable — the draft is best-effort */
      }
    }, DRAFT_DELAY);
  }, []);

  const resumeDraft = () => {
    const draft = draftNotice;
    if (!draft) return;
    titleRef.current = draft.title;
    setTitle(draft.title);
    setInitialScene(draft.scene);
    lastSavedSignatureRef.current = null;
    metaDirtyRef.current = false;
    dirtyRef.current = true;
    setDirty(true);
    setSaveState("dirty");
    setDraftNotice(null);
    // The draft is now loaded into the editor: drop it from storage so it
    // does not keep reappearing on every workspace open.
    clearDraft();
    baselinePendingRef.current = true;
    setNonce((n) => n + 1);
  };

  const dismissDraft = () => {
    clearDraft();
    setDraftNotice(null);
  };

  // ------------------------------------------------------------------
  // Canvas wiring
  // ------------------------------------------------------------------
  const handleCanvasChange = useCallback(
    (snapshot: CanvasSnapshot) => {
      sceneRef.current = snapshot;
      if (baselinePendingRef.current) {
        // First report after a remount: this is the restored scene itself
        // (from the DB or a resumed draft), not an edit. Absorb it as the
        // saved baseline so the chip does not flip to "Non enregistré".
        baselinePendingRef.current = false;
        lastSavedSignatureRef.current = sceneSignature(snapshot);
        return;
      }
      if (dirtyRef.current) {
        // Already unsaved — keep the debounced autosave rolling.
        scheduleAutosave();
        scheduleDraftWrite();
        return;
      }
      // Excalidraw fires `onChange` for viewport noise too (hover, pan,
      // selection) and once after a restore/remount. Only treat the board as
      // dirty when the content actually differs from the last saved state,
      // otherwise the status chip would flip back to "Non enregistré" right
      // after a successful save.
      const unchanged =
        !!lastSavedSignatureRef.current &&
        sceneSignature(snapshot) === lastSavedSignatureRef.current &&
        !metaDirtyRef.current;
      if (!unchanged) {
        dirtyRef.current = true;
        setDirty(true);
        setSaveState("dirty");
        scheduleAutosave();
        scheduleDraftWrite();
      }
    },
    [scheduleAutosave, scheduleDraftWrite],
  );

  const markMetaDirty = (nextTitle: string) => {
    titleRef.current = nextTitle;
    metaDirtyRef.current = true;
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setDirty(true);
      setSaveState("dirty");
    }
    scheduleAutosave();
  };

  // ------------------------------------------------------------------
  // Open / close / switch
  // ------------------------------------------------------------------
  const doClose = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (!useWhiteboardStore.getState().boardId) clearDraft();
    useWhiteboardStore.setState({ boardId: null });
    router.push("/dashboard");
  }, [router]);

  const requestClose = useCallback(() => {
    if (dirtyRef.current || savingRef.current) setPendingAction({ kind: "close" });
    else doClose();
  }, [doClose]);

  const startNewBoard = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    clearDraft();
    useWhiteboardStore.setState({ boardId: null });
    titleRef.current = "";
    setTitle("Nouveau tableau");
    setInitialScene(null);
    lastSavedSignatureRef.current = null;
    dirtyRef.current = false;
    metaDirtyRef.current = false;
    setDirty(false);
    setSaveState("idle");
    setLastSavedAt(null);
    setDraftNotice(null);
    baselinePendingRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  const requestNew = useCallback(() => {
    if (dirtyRef.current || savingRef.current) setPendingAction({ kind: "new" });
    else startNewBoard();
  }, [startNewBoard]);

  const openBoard = useCallback((id: string) => {
    setHistoryOpen(false);
    if (dirtyRef.current || savingRef.current) {
      setPendingAction({ kind: "open-board", id });
    } else {
      useWhiteboardStore.setState({ boardId: id });
    }
  }, []);

  const finishPending = (action: PendingAction) => {
    setPendingAction(null);
    if (action.kind === "close") doClose();
    else if (action.kind === "new") startNewBoard();
    else useWhiteboardStore.setState({ boardId: action.id });
  };

  const confirmPending = async () => {
    if (!pendingAction) return;
    const ok = await handleSave();
    if (!ok) return;
    if (pendingAction.kind === "new") {
      // The drawing was saved (or already existed): keep it open. Finishing
      // the "new" action here would drop the freshly created boardId and make
      // every following save spawn another duplicate board.
      setPendingAction(null);
      return;
    }
    finishPending(pendingAction);
  };

  const discardPending = () => {
    if (!pendingAction) return;
    finishPending(pendingAction);
  };

  // Escape: close the history panel first, then the workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingAction) {
        setPendingAction(null);
        return;
      }
      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingAction, historyOpen, requestClose]);

  // Lock body scroll while the workspace covers the app.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={t("whiteboard.open", "Notes / Tableau blanc")}
    >
      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 sm:px-4">
        <button
          onClick={requestClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn text-text-secondary transition-colors hover:bg-neutral-soft hover:text-text-primary"
          aria-label={t("common.close", "Fermer")}
          title={`${t("common.close", "Fermer")} (Échap)`}
        >
          <X size={18} />
        </button>
        <kbd className="hidden h-9 shrink-0 items-center rounded-btn border border-border bg-background/60 px-2 text-[11px] text-text-secondary lg:flex">
          Échap
        </kbd>

        <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-primary-50 text-primary dark:bg-primary/15 sm:flex">
          <PenLine size={16} aria-hidden="true" />
        </div>

        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            markMetaDirty(e.target.value);
          }}
          className="input h-9 min-w-0 flex-1 px-3 text-sm font-medium"
          aria-label={t("whiteboard.title", "Titre du tableau")}
          placeholder={t("whiteboard.titlePlaceholder", "Titre du tableau…")}
        />

        {/* autosave toggle */}
        <label
          className="flex h-9 items-center gap-2 text-[11px] font-medium text-text-secondary select-none"
          title={t("whiteboard.autosaveHint", "Enregistre automatiquement vos modifications (création automatique pour un nouveau tableau)")}
        >
          <button
            type="button"
            role="switch"
            aria-checked={autosaveEnabled}
            aria-label={t("whiteboard.autosaveAria", "Activer l'enregistrement automatique")}
            onClick={() => setAutosaveEnabled((v) => !v)}
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              autosaveEnabled ? "bg-primary" : "bg-neutral-soft border border-border",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
                autosaveEnabled && "translate-x-4",
              )}
            />
          </button>
          <span className="hidden lg:inline">{t("whiteboard.autosave", "Auto-enregistrement")}</span>
        </label>

        {/* save status */}
        <div className="flex h-9 items-center gap-1.5 text-[11px] font-medium">
          {saveState === "saving" && (
            <span className="flex items-center gap-1.5 text-text-secondary">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              {t("whiteboard.saving", "Enregistrement…")}
            </span>
          )}
          {saveState === "dirty" && (
            <span className="flex items-center gap-1.5 text-gold-700 dark:text-gold-300">
              <AlertTriangle size={12} aria-hidden="true" />
              {t("whiteboard.unsaved", "Non enregistré")}
            </span>
          )}
          {saveState === "saved" && (
            <span className="flex items-center gap-1.5 text-success-strong dark:text-success-dark-strong">
              <CheckCircle2 size={12} aria-hidden="true" />
              {lastSavedAt
                ? `${t("whiteboard.savedAt", "Enregistré à")} ${formatSaveTime(lastSavedAt)}`
                : t("whiteboard.saved", "Enregistré")}
            </span>
          )}
          {saveState === "error" && (
            <span className="flex items-center gap-1.5 text-danger">
              <AlertTriangle size={12} aria-hidden="true" />
              {t("whiteboard.saveFailed", "Échec de l'enregistrement")}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setHistoryOpen(true)}
            className="btn btn-secondary h-9 gap-1.5 px-3 text-xs"
            aria-label={t("whiteboard.history", "Historique des tableaux")}
            title={t("whiteboard.history", "Historique des tableaux")}
          >
            <History size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{t("whiteboard.history", "Historique")}</span>
          </button>
          <button
            onClick={requestNew}
            className="btn btn-secondary h-9 gap-1.5 px-3 text-xs"
            aria-label={t("whiteboard.new", "Nouveau tableau")}
            title={t("whiteboard.new", "Nouveau tableau")}
          >
            <Plus size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{t("whiteboard.new", "Nouveau")}</span>
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={savingRef.current}
            className="btn btn-primary h-9 gap-1.5 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            aria-busy={savingRef.current || undefined}
          >
            {savingRef.current ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Save size={14} aria-hidden="true" />
            )}
            {t("whiteboard.save", "Enregistrer")}
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------ editor */}
      <div className="relative min-h-0 flex-1">
        {boardId && boardLoading ? (
          <EditorLoader />
        ) : (
          <ExcalidrawCanvas
            key={`${boardId ?? "new"}-${nonce}`}
            initialScene={initialScene}
            theme={theme}
            onReady={() => undefined}
            onChange={handleCanvasChange}
          />
        )}

        {/* draft recovery banner */}
        {draftNotice && (
          <div className="absolute bottom-4 left-1/2 z-10 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-card border border-gold/40 bg-surface p-3 shadow-modal">
            <div className="flex flex-wrap items-center gap-2">
              <StickyNote size={15} className="shrink-0 text-gold-600 dark:text-gold-300" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-xs text-text-primary">
                {t("whiteboard.draftFound", "Un tableau non enregistré a été retrouvé.")}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={resumeDraft} className="btn btn-primary px-2.5 py-1 text-[11px]">
                  {t("whiteboard.resume", "Reprendre")}
                </button>
                <button onClick={dismissDraft} className="btn btn-secondary px-2.5 py-1 text-[11px]">
                  {t("whiteboard.discard", "Ignorer")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* history */}
        {historyOpen && (
          <WhiteboardHistoryPanel onOpenBoard={openBoard} onClose={() => setHistoryOpen(false)} />
        )}
      </div>

      {/* ------------------------------------------------- unsaved-changes */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="whiteboard-unsaved-title"
          aria-describedby="whiteboard-unsaved-body"
          onClick={() => setPendingAction(null)}
        >
          <div
            className="mx-4 w-full max-w-xl rounded-modal bg-surface p-6 shadow-modal sm:p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold-500/15">
                <AlertTriangle size={20} className="text-gold-600 dark:text-gold-300" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3
                  id="whiteboard-unsaved-title"
                  className="text-h4 font-bold text-text-primary"
                >
                  {t("whiteboard.unsavedTitle", "Modifications non enregistrées")}
                </h3>
                <p id="whiteboard-unsaved-body" className="mt-1 text-sm text-text-secondary">
                  {t(
                    "whiteboard.unsavedBody",
                    "Ce tableau contient des modifications qui ne sont pas encore enregistrées.",
                  )}{" "}
                  {pendingAction.kind === "close"
                    ? t("whiteboard.unsavedBodyClose", "Si vous fermez maintenant, vos dernières modifications seront perdues.")
                    : pendingAction.kind === "new"
                      ? t("whiteboard.unsavedBodyNew", "Si vous créez un nouveau tableau, vos modifications actuelles seront perdues.")
                      : t("whiteboard.unsavedBodyOpen", "Si vous ouvrez un autre tableau, vos modifications actuelles seront perdues.")}
                </p>
              </div>
            </div>

            <div className="mb-6 space-y-2.5 rounded-modal border border-border bg-background/60 p-4 text-sm">
              <div className="flex items-center gap-2.5">
                <StickyNote size={15} className="shrink-0 text-text-secondary" aria-hidden="true" />
                <span className="truncate font-medium text-text-primary">
                  {title || t("whiteboard.titlePlaceholder", "Titre du tableau…")}
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-text-secondary">
                <Clock size={15} className="shrink-0" aria-hidden="true" />
                {lastSavedAt ? (
                  <>
                    {t("whiteboard.lastSavedAt", "Dernier enregistrement")}&nbsp;:&nbsp;
                    <span className="tabular-nums">{formatSaveTime(lastSavedAt)}</span>
                  </>
                ) : (
                  t("whiteboard.neverSaved", "Jamais enregistré")
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
              <button onClick={() => setPendingAction(null)} className="btn btn-secondary text-sm" autoFocus>
                {t("common.cancel", "Annuler")}
              </button>
              <button onClick={discardPending} className="btn btn-danger text-sm">
                {pendingAction.kind === "close"
                  ? t("whiteboard.discardAndClose", "Fermer sans enregistrer")
                  : t("whiteboard.discardChanges", "Abandonner les modifications")}
              </button>
              <button
                onClick={() => void confirmPending()}
                className="btn btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saveState === "saving"}
                aria-busy={saveState === "saving" || undefined}
              >
                {saveState === "saving" ? (
                  <>
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
{t("whiteboard.saving", "Enregistrement…")}
                  </>
                ) : (
                  t("whiteboard.saveAndContinue", "Enregistrer")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}