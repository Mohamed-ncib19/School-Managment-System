"use client";

import { cn } from "@/lib/utils/format";

interface PhoneInputProps {
  /** The bare 8 digits — the country code is rendered, never stored. */
  value: string;
  /** Called with the bare 8 digits (digits only, max 8). */
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

/** 22123456 → "22 123 456" — readable groups, applied only to the display. */
function formatDigits(digits: string): string {
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 8)].filter(Boolean).join(" ");
}

/**
 * Tunisian phone input: a fixed "+216" prefix the user cannot remove, and an
 * 8-digit field that only accepts digits. The stored value is the bare 8
 * digits; the rest of the app normalises to "+216" + digits on submit.
 */
export function PhoneInput({
  value,
  onChange,
  id,
  placeholder = "22 123 456",
  required,
  disabled,
  className,
}: PhoneInputProps) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const display = formatDigits(digits);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-input border border-border bg-surface px-4 text-sm text-text-primary transition-all duration-150",
        "focus-within:border-primary focus-within:outline-none focus-within:ring-2 focus-within:ring-primary-200",
        disabled && "opacity-50 bg-neutral-soft",
        className,
      )}
    >
      <span className="select-none font-medium text-text-secondary" aria-hidden="true">
        +216
      </span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={10}
        value={display}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
        className="min-w-0 flex-1 bg-transparent py-2.5 outline-none placeholder:text-text-secondary disabled:opacity-50"
      />
    </div>
  );
}
