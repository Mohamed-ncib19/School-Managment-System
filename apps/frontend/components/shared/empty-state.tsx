"use client";

import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="h-14 w-14 rounded-full bg-neutral-soft dark:bg-white/10 flex items-center justify-center mb-4 text-text-secondary">
        {icon ?? <Inbox size={24} />}
      </div>
      <p className="text-sm text-text-secondary mb-3">{message}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="btn btn-primary text-xs"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
