"use client";

import { useEffect, useRef } from "react";
import { useForm, type DefaultValues, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";

export function useFormWithZod<T extends FieldValues>(
  schema: z.ZodSchema<T>,
  defaults?: DefaultValues<T>,
) {
  return useForm<T>({ resolver: zodResolver(schema), defaultValues: defaults });
}

/**
 * Submit button that disables itself while the request is in flight, so a
 * double-click cannot create the same record twice.
 *
 * `disabled` is combined with `isLoading` rather than spread over it: with
 * `{...props}` applied after `disabled={isLoading}`, passing any `disabled`
 * value silently cancelled the in-flight guard.
 */
export function FormButton({
  isLoading,
  children,
  disabled,
  className,
  ...props
}: { isLoading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={isLoading || disabled}
      aria-busy={isLoading || undefined}
      className={`btn btn-primary disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ""}`}
    >
      {isLoading ? (
        <>
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Saving...
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function ConfirmDeleteDialog({
  entityName,
  onConfirm,
  isOpen,
  onClose,
  error,
  isDeleting,
  message,
}: {
  entityName: string;
  onConfirm: () => void;
  isOpen: boolean;
  onClose: () => void;
  /** Server-side refusal to show in place — e.g. a student with settled payments. */
  error?: string;
  isDeleting?: boolean;
  /** Custom body text; defaults to "cannot be undone" when omitted. */
  message?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus starts on the safe action rather than Delete.
  useEffect(() => {
    if (!isOpen) return;
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isDeleting) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      aria-describedby="confirm-delete-body"
      onClick={() => !isDeleting && onClose()}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-modal bg-surface p-6 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-delete-title" className="mb-2 text-h4 font-bold text-text-primary">
          Delete {entityName}
        </h3>
        {error ? (
          <p id="confirm-delete-body" role="alert" className="mb-6 text-sm text-danger">{error}</p>
        ) : (
          <p id="confirm-delete-body" className="mb-6 text-sm text-text-secondary">
            {message ?? "Are you sure? This action cannot be undone."}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button ref={cancelRef} className="btn btn-secondary text-sm" onClick={onClose} disabled={isDeleting}>
            {error ? "Close" : "Cancel"}
          </button>
          {!error && (
            <button
              className="btn btn-danger text-sm disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onConfirm}
              disabled={isDeleting}
              aria-busy={isDeleting || undefined}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
