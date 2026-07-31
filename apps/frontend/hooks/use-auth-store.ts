import { create } from "zustand";
import { persist } from "zustand/middleware";
import { authApi } from "@/lib/api/auth.api";

type UserRole = "super_admin";

interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  hydrated: boolean;
  isAuthenticated: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  setHydrated: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      hydrated: false,
      isAuthenticated: false,
      setAuth: (token: string, user: AuthUser) => set({ token, user, isAuthenticated: true, hydrated: true }),
      setHydrated: () => set((s) => ({ hydrated: true, isAuthenticated: Boolean(s.token) })),
      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          // ignore logout errors — we're clearing local state regardless
        }
        set({ token: null, user: null, isAuthenticated: false, hydrated: true });
      },
    }),
    {
      name: "iq-auth",
      partialize: (s) => ({ token: s.token, user: s.user }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
