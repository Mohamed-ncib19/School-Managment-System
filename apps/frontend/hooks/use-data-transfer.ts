import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  dataTransferApi,
  FillValues,
  ImportPreview,
  ImportResult,
} from "@/lib/api/data-transfer.api";

export function useExportAll() {
  return useMutation({
    mutationFn: () => dataTransferApi.exportAll(),
  });
}

export function useImportPreview() {
  return useMutation({
    mutationFn: ({ file, phrase }: { file: File; phrase?: string }) => dataTransferApi.previewImport(file, phrase),
  });
}

export function useDataImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, fills, phrase }: { file: File; fills: FillValues; phrase?: string }) =>
      dataTransferApi.importData(file, fills, phrase),
    onSuccess: () => {
      // Nearly every collection may have changed; refetch the affected domains.
      queryClient.invalidateQueries();
    },
  });
}

export type { ImportPreview, ImportResult, FillValues };