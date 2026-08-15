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
    mutationFn: (file: File) => dataTransferApi.previewImport(file),
  });
}

export function useDataImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, fills }: { file: File; fills: FillValues }) =>
      dataTransferApi.importData(file, fills),
    onSuccess: () => {
      // Nearly every collection may have changed; refetch the affected domains.
      queryClient.invalidateQueries();
    },
  });
}

export type { ImportPreview, ImportResult, FillValues };