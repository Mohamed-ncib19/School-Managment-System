"use client";

import { useMemo } from "react";
import { Excalidraw, restore } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import type { WhiteboardScene } from "@/types";

/** The live canvas snapshot reported by Excalidraw's `onChange`. */
export type CanvasSnapshot = {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};

interface ExcalidrawCanvasProps {
  /** The scene this canvas mounts with. Only read on mount — remount (key) to swap scenes. */
  initialScene: WhiteboardScene | null;
  theme: "light" | "dark";
  onReady: (api: ExcalidrawImperativeAPI) => void;
  onChange: (snapshot: CanvasSnapshot) => void;
}

/**
 * The Excalidraw editor, wrapped so the whiteboard workspace can import it
 * with `ssr: false` (Excalidraw touches `window`/`document` at import time and
 * must never run on the server).
 */
export default function ExcalidrawCanvas({ initialScene, theme, onReady, onChange }: ExcalidrawCanvasProps) {
  // `initialData` is only read on mount; `restore()` validates and backfills
  // the persisted scene exactly like the app's own file loader would. A
  // corrupted payload falls back to a blank canvas rather than crashing.
  const initialData = useMemo<ExcalidrawInitialDataState | null>(() => {
    if (!initialScene) return null;
    try {
      // `collaborators` is a live Map in Excalidraw 0.18; after a JSON round
      // trip through the API it comes back as a plain object and crashes the
      // canvas (`...collaborators.forEach is not a function`). It only holds
      // ephemeral live-collaboration cursors, so it is stripped on restore.
      const { collaborators: _collaborators, ...safeAppState } = initialScene.appState ?? {};
      return restore(
        {
          elements: (initialScene.elements ?? []) as ExcalidrawElement[],
          appState: safeAppState,
          files: (initialScene.files ?? {}) as BinaryFiles,
        },
        null,
        null,
      );
    } catch {
      return null;
    }
  }, [initialScene]);

  return (
    <div className="h-full w-full">
      <Excalidraw
        excalidrawAPI={onReady}
        initialData={initialData}
        theme={theme}
        onChange={(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) =>
          onChange({ elements, appState, files })
        }
      />
    </div>
  );
}