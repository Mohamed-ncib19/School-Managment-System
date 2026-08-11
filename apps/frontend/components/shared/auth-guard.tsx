"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/hooks/use-auth-store";
import { PageLoader } from "@/components/shared/skeletons";

/**
 * Client-side backstop to the Next.js middleware.
 *
 * The middleware (`middleware.ts`) already bounces cookie-less requests to
 * /login at the edge; this component restores the user's identity through
 * `GET /auth/me` (the httpOnly cookie is sent automatically) and only renders
 * the shell once the session has been validated server-side. That also closes
 * the flash-of-empty-shell gap between a live cookie and a loaded user.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    // Only hydrate once per page load; on a hard reload the store starts empty.
    if (status === "loading") void hydrate();
  }, [mounted, status, hydrate]);

  useEffect(() => {
    if (!mounted || status === "loading") return;
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, mounted, router, pathname]);

  if (!mounted || status === "loading") return <PageLoader />;
  return <>{children}</>;
}
