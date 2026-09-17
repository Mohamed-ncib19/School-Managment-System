"use client";

import Link from "next/link";
import { useEffect } from "react";
import { WifiOff, RefreshCw, LayoutDashboard } from "lucide-react";
import { SafeText } from "@/components/shared/error-boundary";

/**
 * Catches render/network errors on any page under the root layout and replaces
 * the default Next.js error screen with an in-product recovery page. The
 * session survives (it lives in httpOnly cookies), so reloading or returning
 * to the dashboard brings the app back where it was.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest lands in the server logs; it is the only cross-reload trace.
    console.error("Unhandled page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-soft dark:bg-white/10">
          <WifiOff size={28} className="text-text-secondary" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-text-primary">
          <SafeText k="errors.pageTitle" fallback="Quelque chose s'est mal passé" />
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          <SafeText
            k="errors.pageDesc"
            fallback="La page n'a pas pu être affichée. Vos données sont en sécurité — rechargez la page pour réessayer."
          />
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={reset}
            className="btn btn-primary w-full"
          >
            <RefreshCw size={16} aria-hidden="true" />
            <SafeText k="errors.retryPage" fallback="Recharger la page" />
          </button>
          <Link href="/dashboard" className="btn btn-secondary w-full">
            <LayoutDashboard size={16} aria-hidden="true" />
            <SafeText k="errors.backToDashboard" fallback="Retour au tableau de bord" />
          </Link>
        </div>
      </div>
    </div>
  );
}
