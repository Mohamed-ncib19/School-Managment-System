"use client";

import { formatCurrency, studentTotalFee } from "@/lib/utils/format";

interface AssignmentLike {
  id?: string;
  fee?: string | number | null;
  group?: {
    name?: string | null;
    professor?: { field?: { name?: string | null } | null } | null;
  } | null;
}

interface StudentLike {
  assignments?: AssignmentLike[] | null;
  group?: { name?: string | null } | null;
  monthly_fee?: string | number | null;
}

/**
 * The enrollment chips for a student row: one chip per group when the student
 * is enrolled in several, otherwise the primary group. Each chip carries its
 * own monthly fee, because a multi-group student is billed per enrollment.
 */
export function StudentAssignmentsCell({ student }: { student: StudentLike }) {
  const assignments = student.assignments?.length ? student.assignments : null;
  if (!assignments) {
    return (
      <span className="text-text-secondary">
        {student.group?.name ?? "—"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {assignments.map((a) => (
        <span
          key={a.id ?? a.group?.name}
          className="inline-flex items-center gap-1 rounded-btn border border-border bg-surface-2 px-1.5 py-0.5 text-xs"
          title={a.group?.professor?.field?.name ?? undefined}
        >
          <span className="font-medium text-text-primary">{a.group?.name ?? "—"}</span>
          <span className="text-text-secondary">{formatCurrency(Number(a.fee) || 0)}</span>
        </span>
      ))}
    </span>
  );
}

/** The sum of all enrollment fees — the total a multi-group student owes monthly. */
export function StudentFeeCell({ student }: { student: StudentLike }) {
  return <span className="text-text-secondary">{formatCurrency(studentTotalFee(student))}</span>;
}
