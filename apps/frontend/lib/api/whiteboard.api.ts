import { ApiClient } from "./client";
import type { Whiteboard, WhiteboardScene } from "@/types";

/** Scene payload accepted by create/update — the serialized Excalidraw document. */
export type WhiteboardScenePayload = {
  type: string;
  version: number;
  source: string;
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

export type CreateWhiteboardPayload = {
  title?: string;
  scene: WhiteboardScenePayload;
};

export type UpdateWhiteboardPayload = {
  title?: string;
  scene?: WhiteboardScenePayload;
};

export const whiteboardApi = {
  /** History: metadata only (no scene), newest edit first. */
  list: () => ApiClient.get<Whiteboard[]>("/whiteboards"),
  /** One board with its full scene, ready to restore. */
  get: (id: string) => ApiClient.get<Whiteboard>(`/whiteboards/${id}`),
  create: (data: CreateWhiteboardPayload) => ApiClient.post<Whiteboard>("/whiteboards", data),
  update: (id: string, data: UpdateWhiteboardPayload) => ApiClient.put<Whiteboard>(`/whiteboards/${id}`, data),
  remove: (id: string) => ApiClient.del(`/whiteboards/${id}`),
};

export type { Whiteboard, WhiteboardScene };