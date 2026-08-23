import { create } from "zustand";
import { cloudBackupApi, CloudBackupStatus } from "@/lib/api/cloud-backup.api";

/**
 * Shared cloud safe save status. The poller (CloudSyncNotifier) writes the
 * backend status here; the navbar indicator and the Settings section read it,
 * so every surface agrees about the same sync state without hammering the API
 * with parallel polls.
 */
interface CloudSyncState {
  status: CloudBackupStatus | null;
  checking: boolean;
  refresh: () => Promise<CloudBackupStatus | null>;
}

export const useCloudSyncStore = create<CloudSyncState>()((set) => ({
  status: null,
  checking: false,

  refresh: async () => {
    set({ checking: true });
    try {
      const status = await cloudBackupApi.status();
      set({ status, checking: false });
      return status;
    } catch {
      set({ checking: false });
      return null;
    }
  },
}));