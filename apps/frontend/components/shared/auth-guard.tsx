"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/hooks/use-auth-store";

const PUBLIC_ROUTES = ["/login"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuthStore((s) => s.token);
  // The store reads localStorage synchronously, so it is already rehydrated by
  // the time this mounts. Gating on mount (rather than on the store's own flag)
  // keeps the first client render identical to the server's empty one.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r));
    if (!token && !isPublic) {
      router.push("/login");
    }
  }, [token, mounted, pathname, router]);

  if (!mounted) return null;
  return <>{children}</>;
}
