import { create } from "zustand";
import { authApi } from "@/lib/api/auth.api";

type UserRole = "super_admin";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
}

/**
 * In-memory session state — deliberately NOT persisted anywhere.
 *
 * The session itself lives in httpOnly cookies set by the backend (`iq_session`
 * / `iq_refresh`): the browser sends them automatically, the server validates
 * them, and no script on this page can ever read or forge them. Reloading the
 * app therefore re-hydrates from `GET /auth/me`, not from storage, so the
 * source of truth stays server-side.
 */
interface AuthState {
  user: AuthUser | null;
  /** `loading` until the first `/auth/me` settles; gates the dashboard shell. */
  status: "loading" | "authenticated" | "unauthenticated";
  /** Restores the session on boot; 401s leave the user signed out. */
  hydrate: () => Promise<void>;
  /** Adopts the user returned by login / refresh / change-password. */
  setSession: (user: AuthUser) => void;
  clearSession: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  status: "loading",
  hydrate: async () => {
    try {
      const user = await authApi.me();
      set({ user, status: "authenticated" });
    } catch {
      set({ user: null, status: "unauthenticated" });
    }
  },
  setSession: (user: AuthUser) => set({ user, status: "authenticated" }),
  clearSession: () => set({ user: null, status: "unauthenticated" }),
  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // The cookie is cleared server-side regardless; local state must not
      // depend on the network.
    }
    set({ user: null, status: "unauthenticated" });
  },
}));
