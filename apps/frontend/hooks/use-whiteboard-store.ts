"use client";

import { create } from "zustand";

interface WhiteboardWorkspaceState {
  /**
   * The board being edited, or null for a fresh canvas.
   *
   * Lives in the store so the /whiteboard route's editor remounts when a
   * different board is selected (from the history panel or board switching).
   */
  boardId: string | null;
}

export const useWhiteboardStore = create<WhiteboardWorkspaceState>(() => ({
  boardId: null,
}));