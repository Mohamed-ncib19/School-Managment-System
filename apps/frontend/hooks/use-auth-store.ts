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
 * Companion to the httpOnly `iq_session` cookie. The browser cannot read or
 * clear the session cookie itself, so the middleware cannot tell a live
 * session from a stale one and must not bounce /login to /dashboard on a
 * cookie that a later `/auth/me` will reject — that bounce is the infinite
 * redirect loop. This marker is only ever set after the backend validated the
 * session, and cleared the moment the session dies; its presence is what the
 * middleware trusts.
 */
export const SESSION_OK_COOKIE = "iq_session_ok";

function setOkCookie() {
  try {
    document.cookie = `${SESSION_OK_COOKIE}=1; Path=/; SameSite=Lax`;
  } catch {
    /* storage unavailable */
  }
}

function clearOkCookie() {
  try {
    document.cookie = `${SESSION_OK_COOKIE}=; Path=/; Max-Age=0`;
  } catch {
    /* storage unavailable */
  }
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

export const useAuthStore = create<AuthState>()((set, get) => {
  const setSession = (user: AuthUser) => {
    set({ user, status: "authenticated" });
    setOkCookie();
  };
  const clearSession = () => {
    set({ user: null, status: "unauthenticated" });
    clearOkCookie();
  };
  return {
    user: null,
    status: "loading",
    hydrate: async () => {
      try {
        const user = await authApi.me();
        setSession(user);
      } catch {
        // A /auth/me that started before a login completed can 401 *after*
        // the login already established the session (it was sent with the
        // pre-login cookies). That stale failure must not tear the fresh
        // session down, or the login bounces straight back to /login.
        if (get().status !== "authenticated") clearSession();
      }
    },
    setSession,
    clearSession,
    logout: async () => {
      try {
        await authApi.logout();
      } catch {
        // The cookie is cleared server-side regardless; local state must not
        // depend on the network.
      }
      clearSession();
    },
  };
});
