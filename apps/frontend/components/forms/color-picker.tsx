"use client";

import { Check, X } from "lucide-react";
import { HIERARCHY_COLOR_PALETTE } from "@/lib/utils/colors";
import { useTranslation } from "@/lib/i18n/context";

interface ColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
}

/** Swatch row for the hierarchy create/edit modal. Click a preset to select it,
 *  click the selected one (or the clear chip) to remove the color. */
export default function ColorPicker({ value, onChange }: ColorPickerProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {HIERARCHY_COLOR_PALETTE.map((color) => {
        const selected = value?.toLowerCase() === color.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            aria-label={color}
            onClick={() => onChange(selected ? null : color)}
            className={`h-7 w-7 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary ${
              selected ? "ring-2 ring-offset-1 ring-text-primary scale-110" : ""
            }`}
            style={{ backgroundColor: color }}
          >
            {selected && (
              <span className="flex h-full w-full items-center justify-center text-white">
                <Check size={14} strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="h-7 inline-flex items-center gap-1 rounded-full border border-border px-2 text-xs text-text-secondary hover:text-danger hover:border-danger/40 transition-colors"
          title={t("hierarchy.clearColor", "Remove color")}
        >
          <X size={12} />
          {t("hierarchy.clearColor", "Remove color")}
        </button>
      )}
    </div>
  );
}
