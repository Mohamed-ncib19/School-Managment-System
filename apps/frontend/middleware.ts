import { NextResponse, type NextRequest } from "next/server";

/**
 * The session cookie is set by the backend (`POST /api/auth/login`) with the
 * default host — cookies ignore ports, so the Next.js server on :3000 sees the
 * very same `iq_session` cookie the API set on :3001.
 */
const SESSION_COOKIE = "iq_session";

/**
 * Set by the client only after the backend validated the session (`/auth/me`
 * or login). Its absence means "the cookie may be stale" — the middleware
 * must not bounce /login back to /dashboard on a cookie a later `/auth/me`
 * would reject, or the browser is locked in the /dashboard <-> /login loop
 * with the login form unreachable. See use-auth-store.ts.
 */
const SESSION_OK_COOKIE = "iq_session_ok";

/**
 * Server-side route protection.
 *
 * Every dashboard route needs a session cookie, and /login must never be
 * shown to someone who already has one — that is what made the browser Back
 * button "log out" the user. The cookie is only a first gate: its JWT is
 * validated by the API on every request, and a stale cookie 401s there,
 * which the API client answers by clearing the session and returning to
 * /login.
 */
export function middleware(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionOk = request.cookies.get(SESSION_OK_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  const isLogin = pathname === "/login";
  const isRoot = pathname === "/";

  // Both cookies are required: the marker is only present when the session
  // was recently validated server-side. A bare `iq_session` (expired token,
  // backend restarted with new secrets) must land on the login form instead
  // of bouncing forever.
  if (session && sessionOk) {
    // Signed-in users belong on the dashboard; "Back" from /dashboard lands
    // here and must bounce straight forward.
    if (isLogin || isRoot) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (isLogin || isRoot) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // /api is proxied to the backend by next.config.js; the backend owns its own
  // auth, so the middleware must never intercept API requests.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon|.*\\.[a-z0-9]+$).*)"],
};
