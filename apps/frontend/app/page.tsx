import { redirect } from "next/navigation";

/**
 * `(auth)` and `(dashboard)` are route groups, so neither claims `/` and the
 * home page would otherwise 404. The app starts at the dashboard; its
 * AuthGuard sends signed-out visitors on to /login.
 */
export default function RootPage() {
  redirect("/dashboard");
}
