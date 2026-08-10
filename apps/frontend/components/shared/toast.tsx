"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  /** A retry or undo affordance shown inside the toast. */
  action?: { label: string; onClick: () => void };
  duration: number;
}

interface ToastContextValue {
  show: (toast: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string, action?: Toast["action"]) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Errors stay longer - they usually need reading, and sometimes acting on. */
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3500,
  info: 4000,
  warning: 5000,
  error: 7000,
};

const MAX_VISIBLE = 4;

const VARIANT_STYLE: Record<ToastVariant, { icon: ReactNode; accent: string; ring: string }> = {
  success: {
    icon: <CheckCircle2 size={18} />,
    accent: "text-success-strong dark:text-success-dark-strong",
    ring: "border-l-4 border-l-success",
  },
  error: {
    icon: <AlertCircle size={18} />,
    accent: "text-danger-strong dark:text-danger-dark-strong",
    ring: "border-l-4 border-l-danger",
  },
  warning: {
    icon: <AlertTriangle size={18} />,
    accent: "text-warning-strong dark:text-warning-dark-strong",
    ring: "border-l-4 border-l-warning",
  },
  info: {
    icon: <Info size={18} />,
    accent: "text-info-strong dark:text-info-dark-strong",
    ring: "border-l-4 border-l-info",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setMounted(true);
    // Clearing on unmount stops a dismissed toast's timer from firing later.
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback<ToastContextValue["show"]>(
    ({ variant, title, description, action, duration }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const resolved = duration ?? DEFAULT_DURATION[variant];

      setToasts((current) => [...current, { id, variant, title, description, action, duration: resolved }].slice(-MAX_VISIBLE));

      if (resolved > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), resolved),
        );
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      dismiss,
      success: (title, description) => show({ variant: "success", title, description }),
      error: (title, description, action) => show({ variant: "error", title, description, action }),
      warning: (title, description) => show({ variant: "warning", title, description }),
      info: (title, description) => show({ variant: "info", title, description }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            // Assertive so an error interrupts a screen reader rather than
            // queueing behind whatever else is being announced.
            role="region"
            aria-label="Notifications"
            className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
          >
            <AnimatePresence initial={false}>
              {toasts.map((toast) => (
                <motion.div
                  key={toast.id}
                  layout
                  initial={{ opacity: 0, y: 16, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 24, scale: 0.97 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className={`pointer-events-auto flex items-start gap-3 rounded-card bg-surface p-4 shadow-modal ${VARIANT_STYLE[toast.variant].ring}`}
                  role={toast.variant === "error" ? "alert" : "status"}
                  aria-live={toast.variant === "error" ? "assertive" : "polite"}
                >
                  <span className={`mt-0.5 shrink-0 ${VARIANT_STYLE[toast.variant].accent}`}>
                    {VARIANT_STYLE[toast.variant].icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">{toast.title}</p>
                    {toast.description && (
                      <p className="mt-0.5 break-words text-xs text-text-secondary">{toast.description}</p>
                    )}
                    {toast.action && (
                      <button
                        type="button"
                        onClick={() => {
                          toast.action?.onClick();
                          dismiss(toast.id);
                        }}
                        className="mt-2 rounded-btn text-xs font-medium text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
                      >
                        {toast.action.label}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    aria-label="Fermer la notification"
                    className="shrink-0 rounded-btn p-1 text-text-secondary transition-colors hover:bg-neutral-soft hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 dark:hover:bg-white/10"
                  >
                    <X size={14} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

/**
 * Returns a no-op shim when no provider is mounted, so a component that emits a
 * toast can still be rendered in isolation (tests, storybook) without throwing.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  const fallback = useMemo<ToastContextValue>(
    () => ({
      show: () => "",
      success: () => "",
      error: () => "",
      warning: () => "",
      info: () => "",
      dismiss: () => {},
    }),
    [],
  );
  return ctx ?? fallback;
}
