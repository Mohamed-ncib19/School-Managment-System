"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatCurrency, studentTotalFee } from "@/lib/utils/format";

interface GroupLike {
  id?: string;
  name?: string | null;
  professor?: {
    full_name?: string | null;
    field?: { name?: string | null; level?: { name?: string | null } | null } | null;
  } | null;
}

interface AssignmentLike {
  id?: string;
  fee?: string | number | null;
  group?: GroupLike | null;
}

interface StudentLike {
  assignments?: AssignmentLike[] | null;
  group?: GroupLike | null;
  monthly_fee?: string | number | null;
}

/**
 * The "Affectation" cell for a student row (list and cards).
 *
 * A student enrolled in several groups gets one line per enrollment — same
 * breadcrumb (level › field › professor › group) as a single enrollment, and
 * the group name navigates to the group's hierarchy page like everywhere
 * else. Falls back to the primary group when the student has no assignment
 * rows (legacy data).
 */
export function StudentAffectationCell({ student }: { student: StudentLike }) {
  const enrollments = student.assignments?.length
    ? student.assignments.map((a) => a.group)
    : student.group
      ? [student.group]
      : [];

  if (enrollments.length === 0) {
    return <span className="text-text-secondary">—</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {enrollments.map((group, i) => (
        <AssignmentPath key={group?.id ?? i} group={group} />
      ))}
    </div>
  );
}

function AssignmentPath({ group }: { group?: GroupLike | null }) {
  const levelName = group?.professor?.field?.level?.name;
  const fieldName = group?.professor?.field?.name;
  const professorName = group?.professor?.full_name;
  const groupName = group?.name;
  const groupId = group?.id;

  const crumbs: Array<{ key: string; node: React.ReactNode }> = [];
  if (levelName) crumbs.push({ key: "level", node: <span className="font-medium text-text-primary">{levelName}</span> });
  if (fieldName) crumbs.push({ key: "field", node: <span>{fieldName}</span> });
  if (professorName) crumbs.push({ key: "professor", node: <span>{professorName}</span> });
  if (groupName && groupId) {
    crumbs.push({
      key: "group",
      node: (
        <Link href={`/hierarchy/group/${groupId}`} className="font-medium text-primary hover:underline">
          {groupName}
        </Link>
      ),
    });
  }

  return (
    <div className="flex items-center gap-1 text-xs text-text-secondary flex-wrap">
      {crumbs.length === 0 ? (
        <span className="text-text-secondary">—</span>
      ) : (
        crumbs.map((crumb, i) => (
          <span key={crumb.key} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight size={10} className="text-text-secondary/50 shrink-0" />}
            {crumb.node}
          </span>
        ))
      )}
    </div>
  );
}

/** The sum of all enrollment fees — the total a multi-group student owes monthly. */
export function StudentFeeCell({ student }: { student: StudentLike }) {
  return <span className="text-text-secondary">{formatCurrency(studentTotalFee(student))}</span>;
}
