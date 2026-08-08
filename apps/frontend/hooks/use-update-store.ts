import { create } from "zustand";
import { updatesApi, UpdateStatus } from "@/lib/api/updates.api";

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
  refresh: (force?: boolean) => Promise<UpdateStatus | null>;
  openDialog: () => void;
  closeDialog: () => void;
  setChecking: (v: boolean) => void;
  setApplying: (v: boolean) => void;
  setFailed: (v: boolean) => void;
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  status: null,
  open: false,
  checking: false,
  applying: false,
  failed: false,

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

  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
  setChecking: (checking) => set({ checking }),
  setApplying: (applying) => set({ applying }),
  setFailed: (failed) => set({ failed }),
}));