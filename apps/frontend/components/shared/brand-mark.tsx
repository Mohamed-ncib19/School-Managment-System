"use client";

import { cn } from "@/lib/utils/format";
import { schoolInitials } from "@/lib/brand";

/**
 * The school monogram tile: the first two letters of the school name on a
 * white rounded tile — used in the sidebar when no logo image is uploaded.
 */
export default function BrandMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-btn bg-white text-primary font-bold select-none shrink-0 shadow-sm",
        className,
      )}
      aria-hidden="true"
    >
      {schoolInitials(name)}
    </span>
  );
}