"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Compass, Home } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";

/**
 * The 404 body, shared by the standalone root page and the in-shell
 * dashboard variant. A huge muted "404" carries the visual weight while the
 * heading and description stay meaningful to screen readers.
 */
export default function NotFoundContent() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-card bg-primary-50 text-primary dark:bg-primary/15">
        <Compass size={28} />
      </div>
      <p className="text-[5rem] leading-none font-bold text-primary/20 select-none dark:text-primary/15" aria-hidden="true">
        404
      </p>
      <h1 className="text-h2 mt-2 font-bold text-text-primary">{t("notFound.title")}</h1>
      <p className="mt-2 max-w-md text-sm text-text-secondary">{t("notFound.description")}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => router.back()} className="btn btn-secondary">
          <ArrowLeft size={16} /> {t("notFound.goBack")}
        </button>
        <Link href="/dashboard" className="btn btn-primary">
          <Home size={16} /> {t("notFound.backToDashboard")}
        </Link>
      </div>
    </div>
  );
}
