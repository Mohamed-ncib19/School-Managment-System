import { AlertTriangle, RefreshCcw } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";

interface ErrorStateProps {
  title?: string;
  hint?: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "financial.error.title",
  hint = "financial.error.hint",
  retryLabel = "financial.error.retry",
  onRetry,
  className = "",
}: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-red-300/60 bg-red-50/40 px-6 py-10 text-center dark:border-red-500/30 dark:bg-red-500/5 ${className}`}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-red-100 text-lg text-red-500 dark:bg-red-500/15 dark:text-red-400">
        <AlertTriangle />
      </span>
      <div>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t(title, title)}</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t(hint, hint)}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20 dark:bg-red-400/10 dark:text-red-400 dark:hover:bg-red-400/20"
        >
          <RefreshCcw />
          {t(retryLabel, retryLabel)}
        </button>
      )}
    </div>
  );
}