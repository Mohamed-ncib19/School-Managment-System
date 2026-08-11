import { NextResponse, type NextRequest } from "next/server";

/**
 * The session cookie is set by the backend (`POST /api/auth/login`) with the
 * default host — cookies ignore ports, so the Next.js server on :3000 sees the
 * very same `iq_session` cookie the API set on :3001.
 */
const SESSION_COOKIE = "iq_session";

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
  const { pathname } = request.nextUrl;

  const isLogin = pathname === "/login";
  const isRoot = pathname === "/";

  if (session) {
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|.*\\.[a-z0-9]+$).*)"],
};
