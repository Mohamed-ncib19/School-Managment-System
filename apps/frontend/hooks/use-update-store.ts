import { create } from "zustand";
import { updatesApi, UpdateStatus, UpdateProgress } from "@/lib/api/updates.api";

/**
 * Shared update state. The poller (UpdateNotifier) writes status here; the
 * navbar indicator and the Settings section read it, and any "check now" /
 * "update now" click from anywhere goes through the same store, so every
 * surface stays in sync about the same GitHub release branch.
 */
interface UpdateState {
  status: UpdateStatus | null;
  /** True while the dialog is actually on screen. */
  open: boolean;
  checking: boolean;
  applying: boolean;
  failed: boolean;
  /** Live step/state of the update engine once "update now" is running. */
  progress: UpdateProgress | null;
  refresh: (force?: boolean) => Promise<UpdateStatus | null>;
  refreshProgress: () => Promise<UpdateProgress | null>;
  openDialog: () => void;
  closeDialog: () => void;
  setChecking: (v: boolean) => void;
  setApplying: (v: boolean) => void;
  setFailed: (v: boolean) => void;
  setProgress: (p: UpdateProgress | null) => void;
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  status: null,
  open: false,
  checking: false,
  applying: false,
  failed: false,
  progress: null,

  refresh: async (force = false) => {
    set({ checking: true, failed: false });
    try {
      const status = await updatesApi.check(force);
      set({ status, checking: false });
      return status;
    } catch {
      set({ checking: false });
      return null;
    }
  },

  refreshProgress: async () => {
    try {
      const progress = await updatesApi.progress();
      set({ progress });
      return progress;
    } catch {
      return null;
    }
  },

  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
  setChecking: (checking) => set({ checking }),
  setApplying: (applying) => set({ applying }),
  setFailed: (failed) => set({ failed }),
  setProgress: (progress) => set({ progress }),
}));