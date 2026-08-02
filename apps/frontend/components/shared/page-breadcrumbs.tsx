"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@/lib/i18n/context";
import { useHierarchyConfig, type HierarchyEntity } from "@/hooks/use-hierarchy-config";
import { useLevels, useFields, useProfessors, useGroups } from "@/hooks/use-queries";
import { studentsApi } from "@/lib/api/students.api";
import type { Level, Field, Professor, Group } from "@/types";

/**
 * Navbar breadcrumb for the hierarchy screens.
 *
 * Turns the current URL into a drill-down trail with real entity names —
 * Dashboard > 1ere > Math > Prof name > Group — instead of the static page
 * titles ("Levels", "Fields & Hierarchy", ...) the header used before.
 * Works with the hierarchy URL family:
 *   /hierarchy/level/l1/field/f1/professor/p1/group/g1
 *
 * The names come from the same list queries the pages themselves use, so the
 * trail renders instantly once a hierarchy screen has been visited.
 */

interface Ids {
  levelId?: string;
  fieldId?: string;
  profId?: string;
  groupId?: string;
}

type Route =
  | { kind: "hierarchy"; pairs: { type: HierarchyEntity; id?: string }[] }
  | { kind: "student"; studentId: string; isPayments: boolean }
  | { kind: "flat"; page: HierarchyEntity }
  | { kind: "none" };

const VALID_ENTITIES: HierarchyEntity[] = ["level", "field", "professor", "group", "student"];

function parseRoute(pathname: string): Route {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0 || segments[0] === "dashboard") return { kind: "none" };

  // /hierarchy[/level/l1][/field/f1][/professor/p1][/group/g1][/student/s1]
  if (segments[0] === "hierarchy") {
    const pairs: { type: HierarchyEntity; id?: string }[] = [];
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (VALID_ENTITIES.includes(seg as HierarchyEntity)) {
        const next = segments[i + 1];
        const hasId = next && !VALID_ENTITIES.includes(next as HierarchyEntity);
        pairs.push({ type: seg as HierarchyEntity, id: hasId ? next : undefined });
        if (hasId) i++;
      }
    }
    return { kind: "hierarchy", pairs };
  }

  // /students /students/[id] /students/[id]/payments
  if (segments[0] === "students") {
    if (segments.length >= 2) return { kind: "student", studentId: segments[1], isPayments: segments[2] === "payments" };
    return { kind: "flat", page: "student" };
  }

  // /levels /professors /groups
  if (segments.length === 1 && VALID_ENTITIES.includes(segments[0] as HierarchyEntity)) {
    return { kind: "flat", page: segments[0] as HierarchyEntity };
  }

  return { kind: "none" };
}

const PAGE_LABEL_KEYS: Record<string, string> = {
  level: "fieldsHierarchy.breadcrumbLevels",
  field: "fieldsHierarchy.breadcrumbFields",
  professor: "fieldsHierarchy.breadcrumbProfessors",
  group: "fieldsHierarchy.breadcrumbGroups",
  student: "fieldsHierarchy.breadcrumbStudents",
};

const ID_KEY: Record<Exclude<HierarchyEntity, "student">, keyof Ids> = {
  level: "levelId",
  field: "fieldId",
  professor: "profId",
  group: "groupId",
};

export default function PageBreadcrumbs({ pathname }: { pathname: string }) {
  const { t } = useTranslation();
  const { entityOrder } = useHierarchyConfig();

  const route = useMemo(() => parseRoute(pathname), [pathname]);

  const ids: Ids = useMemo(() => {
    if (route.kind === "hierarchy") {
      const out: Ids = {};
      for (const pair of route.pairs) {
        if (!pair.id || pair.type === "student") continue;
        out[ID_KEY[pair.type as Exclude<HierarchyEntity, "student">]] = pair.id;
      }
      return out;
    }
    return {};
  }, [route]);

  const has = (key: keyof Ids) => !!ids[key];
  const studentId = route.kind === "student" ? route.studentId : undefined;
  const levels = useLevels({ enabled: has("levelId") });
  const fields = useFields({ enabled: has("fieldId") });
  const professors = useProfessors(ids.fieldId, { enabled: has("profId") });
  const groups = useGroups(ids.profId, { enabled: has("groupId") });
  const student = useQuery({
    queryKey: ["student", studentId ?? "none"],
    queryFn: () => studentsApi.get(studentId as string),
    enabled: !!studentId,
  });

  const { crumbs, current } = useMemo(() => {
    const findName = <T extends { id: string }>(list: T[] | undefined, id?: string, pick?: (item: T) => string) => {
      if (!id || !list) return undefined;
      const item = list.find((e) => e.id === id);
      return item ? (pick ? pick(item) : (item as unknown as { name?: string }).name ?? undefined) : undefined;
    };

    const named: Record<string, string | undefined> = {
      level: findName(levels.data as Level[] | undefined, ids.levelId),
      field: findName(fields.data as Field[] | undefined, ids.fieldId),
      professor: findName(professors.data as Professor[] | undefined, ids.profId, (p) => p.full_name),
      group: findName(groups.data as Group[] | undefined, ids.groupId),
      student: route.kind === "student" && student.data ? `${student.data.first_name} ${student.data.last_name}` : undefined,
    };

    // Chain of named entities in the active hierarchy order, each linking to
    // its own drill-down page (/hierarchy/level/l1/field → fields of 1ere).
    const chain: { type: HierarchyEntity; name?: string; href: string }[] = [];
    const seenSegments: string[] = [];
    for (const type of entityOrder) {
      const key = ID_KEY[type as Exclude<HierarchyEntity, "student">];
      if (!key || !ids[key]) continue;
      seenSegments.push(type, ids[key] as string);
      chain.push({ type, name: named[type], href: `/hierarchy/${seenSegments.join("/")}` });
    }

    let current: { label?: string; name?: string } = {};
    if (route.kind === "hierarchy") {
      const last = route.pairs[route.pairs.length - 1];
      if (last && last.id) {
        // Deepest named entity is where the user is — Dashboard > 1ere > math > prof > group.
        current = { name: named[last.type] };
      } else if (last) {
        // A bare entity type means its own list is showing.
        current = { label: t(PAGE_LABEL_KEYS[last.type] ?? "", last.type) };
      } else {
        current = { label: t(PAGE_LABEL_KEYS[entityOrder[0]] ?? "", entityOrder[0]) };
      }
    } else if (route.kind === "student") {
      current = route.isPayments
        ? { label: t("nav.studentPayments", "Payments") }
        : { name: named.student };
    } else if (route.kind === "flat") {
      current = { label: t(PAGE_LABEL_KEYS[route.page] ?? "", route.page) };
    }

    // When the current crumb is the deepest named entity, it is not clickable —
    // drop it from the chain so it renders as the trail's last segment.
    const clickable = route.kind === "hierarchy" && current.name !== undefined && chain.length > 0
      ? chain.slice(0, -1)
      : chain;

    return { crumbs: clickable, current };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, entityOrder, ids, levels.data, fields.data, professors.data, groups.data, student.data, t]);

  if (route.kind === "none") return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 text-sm">
      <Link href="/dashboard" className="text-text-secondary hover:text-primary font-medium transition-colors whitespace-nowrap">
        {t("nav.dashboard")}
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1.5 min-w-0">
          <ChevronRight size={14} className="text-text-secondary/40 shrink-0" />
          <Link href={crumb.href} className="text-text-secondary hover:text-primary transition-colors truncate">
            {crumb.name ?? "…"}
          </Link>
        </span>
      ))}
      <ChevronRight size={14} className="text-text-secondary/40 shrink-0" />
      <span className="text-text-primary font-semibold truncate">
        {current.name ?? current.label ?? "…"}
      </span>
    </nav>
  );
}
