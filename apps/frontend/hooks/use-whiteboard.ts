import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { whiteboardApi, type CreateWhiteboardPayload, type UpdateWhiteboardPayload } from "@/lib/api/whiteboard.api";

export const whiteboardKeys = {
  all: ["whiteboards"] as const,
  list: ["whiteboards", "list"] as const,
  one: (id: string) => ["whiteboards", "one", id] as const,
};

export function useWhiteboards(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: whiteboardKeys.list,
    queryFn: () => whiteboardApi.list(),
    enabled: options?.enabled ?? true,
  });
}

/** One board with its full scene, for restoring an editor session. */
export function useWhiteboard(id: string | null | undefined) {
  return useQuery({
    queryKey: whiteboardKeys.one(id ?? ""),
    queryFn: () => whiteboardApi.get(id as string),
    enabled: !!id,
  });
}

export function useCreateWhiteboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWhiteboardPayload) => whiteboardApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: whiteboardKeys.all }),
  });
}

export function useUpdateWhiteboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWhiteboardPayload }) => whiteboardApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: whiteboardKeys.all }),
  });
}

export function useDeleteWhiteboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => whiteboardApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: whiteboardKeys.all }),
  });
}