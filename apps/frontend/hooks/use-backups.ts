import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { backupApi, BackupResult, RestoreResult } from "@/lib/api/backup.api";

export function useBackups() {
  return useQuery({
    queryKey: ["backups"],
    queryFn: () => backupApi.list(),
    refetchOnMount: true,
  });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version?: string) => backupApi.create(version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (backupId: string) => backupApi.restore(backupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}
