"use client";

import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";

/**
 * Floating access to the whiteboard: opens the /whiteboard route from anywhere
 * in the app. The route (not this button) owns the workspace's close affordance.
 */
export default function WhiteboardFab() {
  const { t } = useTranslation();
  const router = useRouter();
  const label = t("whiteboard.open");

  return (
    <button
      type="button"
      onClick={() => router.push("/whiteboard")}
      aria-label={label}
      title={label}
      className="fixed bottom-4 right-4 z-[95] flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-hover transition-all duration-200 hover:scale-105 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:bottom-6 sm:right-6"
    >
      <StickyNote size={22} aria-hidden="true" />
    </button>
  );
}