"use client";

import { cn } from "@/lib/utils/format";
import type { DriverDefinition } from "@/lib/api/cloud-backup.api";

/**
 * One destination in the picker.
 *
 * The free-tier badge is the point: a school administrator's first question
 * about any of these is "what does it cost", and answering it on the card is
 * the difference between choosing and stalling.
 */
export default function DriverCard({
  driver,
  selected,
  onSelect,
}: {
  driver: DriverDefinition;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "rounded-btn border p-4 text-left transition-colors",
        selected
          ? "border-primary bg-primary-50 dark:bg-primary/10 ring-1 ring-primary"
          : "border-border bg-background hover:border-primary/50",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-sm font-semibold text-text-primary">{driver.displayName}</p>
        {driver.freeTier && (
          <span className="shrink-0 rounded-full bg-success-soft dark:bg-success-dark-soft px-2 py-0.5 text-[10px] font-medium text-success-strong dark:text-success-dark-strong">
            {driver.freeTier}
          </span>
        )}
      </div>
      <p className="text-xs text-text-secondary">{driver.description}</p>
    </button>
  );
}
