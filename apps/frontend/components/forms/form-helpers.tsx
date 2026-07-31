"use client";

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

export function FormButton({ isLoading, children, ...props }: { isLoading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button disabled={isLoading} className="btn btn-primary" {...props}>
      {isLoading ? <><Loader2 size={16} className="animate-spin" /> Loading...</> : children}
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
}: {
  entityName: string;
  onConfirm: () => void;
  isOpen: boolean;
  onClose: () => void;
  /** Server-side refusal to show in place — e.g. a student with settled payments. */
  error?: string;
  isDeleting?: boolean;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label={`Delete ${entityName}`}>
      <div className="bg-surface rounded-modal p-6 shadow-hover w-full max-w-sm mx-4">
        <h3 className="text-h4 font-bold text-text-primary mb-2">Delete {entityName}</h3>
        {error ? (
          <p role="alert" className="text-sm text-danger mb-6">{error}</p>
        ) : (
          <p className="text-sm text-text-secondary mb-6">
            Are you sure? This action cannot be undone.
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <button className="btn btn-secondary text-sm" onClick={onClose}>
            {error ? "Close" : "Cancel"}
          </button>
          {!error && (
            <button className="btn btn-danger text-sm" onClick={onConfirm} disabled={isDeleting}>
              {isDeleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
