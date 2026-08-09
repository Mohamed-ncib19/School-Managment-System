"use client";

import { Check, Copy, Plus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { levelsApi } from "@/lib/api/levels.api";
import { fieldsApi } from "@/lib/api/fields.api";
import { professorsApi } from "@/lib/api/professors.api";
import { groupsApi } from "@/lib/api/groups.api";
import { formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

/** One enrollment slot: a full level > field > professor > group chain, plus the fee that chain bills monthly. */
export interface AssignmentSlot {
  levelId: string;
  fieldId: string;
  professorId: string;
  groupId: string;
  fee: string;
}

export const emptyAssignmentSlot = (defaultFee = ""): AssignmentSlot => ({
  levelId: "",
  fieldId: "",
  professorId: "",
  groupId: "",
  fee: defaultFee,
});

const isComplete = (slot: AssignmentSlot) =>
  !!(slot.levelId && slot.fieldId && slot.professorId && slot.groupId);

interface SlotProps {
  slot: AssignmentSlot;
  index: number;
  removable: boolean;
  onChange: (patch: Partial<AssignmentSlot>) => void;
  onRemove: () => void;
}

function SlotChain({ slot, index, removable, onChange, onRemove }: SlotProps) {
  const { t } = useTranslation();
  const { data: levelOptions } = useQuery({
    queryKey: ["levels"],
    queryFn: () => levelsApi.list(),
  });
  const { data: fieldOptions } = useQuery({
    queryKey: ["fields", slot.levelId],
    queryFn: () => fieldsApi.list(slot.levelId),
    enabled: !!slot.levelId,
  });
  const { data: professorOptions } = useQuery({
    queryKey: ["professors", slot.fieldId],
    queryFn: () => professorsApi.list(slot.fieldId),
    enabled: !!slot.fieldId,
  });
  const { data: groupOptions } = useQuery({
    queryKey: ["groups", slot.professorId],
    queryFn: () => groupsApi.list(slot.professorId),
    enabled: !!slot.professorId,
  });

  const steps: Array<{
    key: keyof AssignmentSlot;
    label: string;
    options: any[];
    value: string;
    parentKey?: keyof AssignmentSlot;
  }> = [
    { key: "levelId", label: t("students.selectLevel", "Level"), options: levelOptions ?? [], value: slot.levelId },
    { key: "fieldId", label: t("students.selectField", "Field"), options: fieldOptions ?? [], value: slot.fieldId, parentKey: "levelId" },
    { key: "professorId", label: t("students.selectProfessor", "Professor"), options: professorOptions ?? [], value: slot.professorId, parentKey: "fieldId" },
    { key: "groupId", label: t("students.selectGroup", "Group"), options: groupOptions ?? [], value: slot.groupId, parentKey: "professorId" },
  ];

  const complete = isComplete(slot);
  const levelName = levelOptions?.find((o: any) => o.id === slot.levelId)?.name ?? "";
  const fieldName = fieldOptions?.find((o: any) => o.id === slot.fieldId)?.name ?? "";
  const professorName = professorOptions?.find((o: any) => o.id === slot.professorId)?.full_name ?? "";
  const groupName = groupOptions?.find((o: any) => o.id === slot.groupId)?.name ?? "";

  return (
    <div className="rounded-btn border border-border bg-surface-2/50 p-3 space-y-2 relative">
      <div className="flex items-center justify-between gap-2">
        {index === 0 && (
          <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            {t("students.assignmentPrimary", "Primary")} #1
          </span>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="flex items-center gap-1 rounded-btn border border-border bg-surface px-2 py-1">
            <input
              type="number"
              min="0"
              step="0.01"
              value={slot.fee}
              onChange={(e) => onChange({ fee: e.target.value })}
              placeholder={t("students.feePlaceholder", "0.00")}
              className="w-16 bg-transparent text-xs tabular-nums outline-none"
              title={t("students.monthlyFee", "Monthly fee")}
              required
            />
            <span className="text-[10px] font-medium text-text-secondary">TND</span>
          </div>
          {removable && (
            <button
              type="button"
              onClick={onRemove}
              className="p-1 rounded-btn text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
              title={t("students.assignmentRemove", "Remove this assignment")}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {steps.map((step) => {
          const parentSelected = step.parentKey ? !!slot[step.parentKey] : true;
          return (
            <div key={step.key}>
              <label className="block text-[10px] uppercase tracking-wide text-text-secondary mb-0.5">
                {step.label}
              </label>
              <select
                value={step.value}
                disabled={!parentSelected}
                onChange={(e) => onChange({ [step.key]: e.target.value } as Partial<AssignmentSlot>)}
                className="input py-1.5 px-2 text-xs w-full disabled:opacity-50"
              >
                <option value="">{t("students.selectPlaceholder", "Select")}</option>
                {(step.options ?? []).map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.full_name ?? o.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {complete && groupName && (
        <p className="flex items-center gap-1 text-[11px] font-medium text-success-strong truncate">
          <Check size={11} className="shrink-0" />
          {[levelName, fieldName, professorName, groupName].filter(Boolean).join(" › ")}
          {" · "}
          {formatCurrency(Number(slot.fee) || 0)}
        </p>
      )}
    </div>
  );
}

interface Props {
  slots: AssignmentSlot[];
  onChange: (slots: AssignmentSlot[]) => void;
  maxSlots?: number;
}

/**
 * Multi-assignment picker for students: one chain per enrollment, so a student
 * can be registered in, say, two fields of the same level — each with its own
 * professor, group and monthly fee underneath. The first slot is the primary
 * assignment (used for dashboard roll-ups). Each dropdown only offers options
 * under the selection before it, mirroring the parent cascade used for the
 * other entities. A live summary line per slot and a running total keep the
 * billing visible while building the chains.
 */
export default function AssignmentSlotsPicker({ slots, onChange, maxSlots = 4 }: Props) {
  const { t } = useTranslation();

  const update = (index: number, patch: Partial<AssignmentSlot>) => {
    const next = slots.map((slot, i) => {
      if (i !== index) return slot;
      const merged = { ...slot, ...patch };
      if (patch.levelId !== undefined && patch.levelId !== slot.levelId) {
        merged.fieldId = "";
        merged.professorId = "";
        merged.groupId = "";
      }
      if (patch.fieldId !== undefined && patch.fieldId !== slot.fieldId) {
        merged.professorId = "";
        merged.groupId = "";
      }
      if (patch.professorId !== undefined && patch.professorId !== slot.professorId) {
        merged.groupId = "";
      }
      return merged;
    });
    onChange(next);
  };

  const total = slots.reduce((sum, s) => sum + (parseFloat(s.fee) || 0), 0);
  const firstFee = slots[0]?.fee ?? "";

  return (
    <div>
      <label className="block text-sm font-medium mb-1">
        {t("students.assignment", "Assignment")} *
      </label>
      <div className="space-y-3">
        {slots.map((slot, index) => (
          <SlotChain
            key={index}
            slot={slot}
            index={index}
            removable={slots.length > 1}
            onChange={(patch) => update(index, patch)}
            onRemove={() => onChange(slots.filter((_, i) => i !== index))}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {slots.length < maxSlots && (
            <button
              type="button"
              onClick={() => onChange([...slots, emptyAssignmentSlot(firstFee)])}
              className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-strong transition-colors"
            >
              <Plus size={14} />
              {t("students.assignmentAdd", "Add another assignment")}
            </button>
          )}
          {slots.length > 1 && firstFee && (
            <button
              type="button"
              onClick={() => onChange(slots.map((s) => ({ ...s, fee: firstFee })))}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
              title={t("students.feeApplyAllTitle", "Copy the first fee to every assignment")}
            >
              <Copy size={12} />
              {t("students.feeApplyAll", "Apply fee to all")}
            </button>
          )}
        </div>
        {total > 0 && (
          <p className="text-xs text-text-secondary">
            <span className="font-medium text-text-primary">{t("students.assignmentTotal", "Total")}:</span>{" "}
            {formatCurrency(total)}
            <span className="text-text-secondary">/mo</span>
          </p>
        )}
      </div>
    </div>
  );
}
