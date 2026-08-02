"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Users, BookOpen, GraduationCap, Layers } from "lucide-react";
import { cn } from "@/lib/utils/format";
import { StatusBadge } from "./status-badge";
import type { Student, Field, Professor, Level, Group } from "@/types";

interface TreeNode {
  id: string;
  name: string;
  type: "field" | "professor" | "level" | "group" | "student";
  children?: TreeNode[];
  student?: Student;
  meta?: Record<string, any>;
}

interface TreeViewProps {
  data: TreeNode[];
  onSelect?: (node: TreeNode) => void;
  onStudentSelect?: (student: Student) => void;
  className?: string;
}

const ICON_MAP = {
  field: <BookOpen size={16} className="text-primary" />,
  professor: <GraduationCap size={16} className="text-accent" />,
  level: <Layers size={16} className="text-sky" />,
  group: <Users size={16} className="text-gold" />,
  student: <GraduationCap size={16} className="text-text-secondary" />,
};

function TreeNodeItem({ node, depth = 0, onSelect, onStudentSelect }: { node: TreeNode; depth?: number; onSelect?: (node: TreeNode) => void; onStudentSelect?: (student: Student) => void }) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const isStudent = node.type === "student" && node.student && onStudentSelect;

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (hasChildren) setIsExpanded(!isExpanded);
  };

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isStudent) {
      onStudentSelect!(node.student!);
      return;
    }
    onSelect?.(node);
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 hover:bg-background/50 rounded-btn transition-colors",
          isStudent ? "cursor-pointer" : hasChildren ? "cursor-pointer" : "cursor-pointer",
        )}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={handleSelect}
      >
        {hasChildren ? (
          <button
            type="button"
            className="text-text-secondary hover:text-text-primary rounded-btn hover:bg-background/50 transition-colors p-0.5"
            onClick={handleExpand}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px]" />
        )}
        {ICON_MAP[node.type]}
        <span className="text-sm font-medium text-text-primary">{node.name}</span>
        {node.type === "student" && node.student && (
          <StatusBadge status={node.student.status} />
        )}
        {hasChildren && (
          <span className="text-xs text-text-secondary ml-auto">
            {node.children!.length}
          </span>
        )}
      </div>
      {isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeItem key={child.id} node={child} depth={depth + 1} onSelect={onSelect} onStudentSelect={onStudentSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView({ data, onSelect, onStudentSelect, className }: TreeViewProps) {
  return (
    <div className={cn("rounded-table border border-border bg-surface overflow-hidden", className)}>
      <div className="p-2">
        {data.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-4">No data to display</p>
        ) : (
          data.map((node) => (
            <TreeNodeItem key={node.id} node={node} onSelect={onSelect} onStudentSelect={onStudentSelect} />
          ))
        )}
      </div>
    </div>
  );
}

export function buildStudentTree(students: Student[]): TreeNode[] {
  const fieldMap = new Map<string, Map<string, Map<string, Map<string, TreeNode>>>>();
  const rootNodes: TreeNode[] = [];

  students.forEach((student) => {
    const prof = student.group?.professor;
    const field = prof?.field;
    const level = field?.level;
    const fieldId = field?.id ?? "unknown-field";
    const fieldName = field?.name ?? "Unknown Field";
    const profId = prof?.id ?? "unknown-prof";
    const profName = prof?.full_name ?? "Unknown Professor";
    const levelId = level?.id ?? "unknown-level";
    const levelName = level?.name ?? "Unknown Level";
    const groupName = student.group?.name ?? "Unknown Group";
    const groupId = student.group?.id ?? "unknown-group";

    if (!fieldMap.has(fieldId)) fieldMap.set(fieldId, new Map());
    const profMap = fieldMap.get(fieldId)!;
    if (!profMap.has(profId)) profMap.set(profId, new Map());
    const levelMap = profMap.get(profId)!;
    if (!levelMap.has(levelId)) levelMap.set(levelId, new Map());
    const groupMap = levelMap.get(levelId)!;

    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        id: groupId,
        name: groupName,
        type: "group",
        children: [],
      });
    }
    groupMap.get(groupId)!.children!.push({
      id: student.id,
      name: `${student.first_name} ${student.last_name}`,
      type: "student",
      student,
    });
  });

  fieldMap.forEach((profMap, fieldId) => {
    const fieldNode: TreeNode = {
      id: fieldId,
      name: profMap.values().next().value?.values().next().value?.values().next().value?.children?.[0]?.student?.group?.professor?.field?.name ?? "Field",
      type: "field",
      children: [],
    };

    profMap.forEach((levelMap, profId) => {
      const profNode: TreeNode = {
        id: profId,
        name: levelMap.values().next().value?.values().next().value?.children?.[0]?.student?.group?.professor?.full_name ?? "Professor",
        type: "professor",
        children: [],
      };

      levelMap.forEach((groupMap, levelId) => {
        const levelNode: TreeNode = {
          id: levelId,
          name: groupMap.values().next().value?.children?.[0]?.student?.group?.professor?.field?.level?.name ?? "Level",
          type: "level",
          children: Array.from(groupMap.values()),
        };
        profNode.children!.push(levelNode);
      });

      fieldNode.children!.push(profNode);
    });

    rootNodes.push(fieldNode);
  });

  return rootNodes;
}

export function buildFieldsTree(fields: Field[], professors: Professor[], levels: Level[], groups: Group[], students: Student[]): TreeNode[] {
  const fieldMap = new Map<string, Field>();
  fields.forEach((f) => fieldMap.set(f.id, f));

  const profByField = new Map<string, Professor[]>();
  professors.forEach((p) => {
    const arr = profByField.get(p.field_id) ?? [];
    arr.push(p);
    profByField.set(p.field_id, arr);
  });

  const groupByProf = new Map<string, Group[]>();
  groups.forEach((g) => {
    const arr = groupByProf.get(g.prof_id) ?? [];
    arr.push(g);
    groupByProf.set(g.prof_id, arr);
  });

  const studentCountByGroup = new Map<string, number>();
  students
    .filter((s) => s.status === "active")
    .forEach((s) => {
      // Roster = every enrollment, not the legacy primary group: a student in
      // several groups counts toward each of them.
      const enrolled = s.assignments?.length ? s.assignments.map((a) => a.group_id) : [s.group_id];
      enrolled.forEach((gid) => {
        studentCountByGroup.set(gid, (studentCountByGroup.get(gid) ?? 0) + 1);
      });
    });

  return fields.map((field) => {
    const fieldProfs = profByField.get(field.id) ?? [];
    const children: TreeNode[] = fieldProfs.map((prof) => {
      const profGroups = groupByProf.get(prof.id) ?? [];
      const levelIds = new Set<string>();
      profGroups.forEach((g) => {
        const levelId = g.professor?.field?.level?.id;
        if (levelId) levelIds.add(levelId);
      });

      const seenLevelIds = new Set<string>();
      const profLevels = levels.filter((l) => {
        if (seenLevelIds.has(l.id)) return false;
        const levelMatches = levelIds.has(l.id);
        if (levelMatches) seenLevelIds.add(l.id);
        return levelMatches;
      });

      const levelNodes: TreeNode[] = profLevels.map((level) => {
        const levelGroups = profGroups.filter((g) => g.professor?.field?.level?.id === level.id);
        const groupNodes: TreeNode[] = levelGroups.map((group) => ({
          id: group.id,
          name: group.name,
          type: "group" as const,
          meta: { capacity: group.capacity, schedule_notes: group.schedule_notes, student_count: studentCountByGroup.get(group.id) ?? 0, field_id: field.id, prof_id: prof.id },
          children: [],
        }));
        return {
          id: level.id,
          name: level.name,
          type: "level" as const,
          meta: { field_id: field.id, prof_id: prof.id },
          children: groupNodes,
        };
      });

      return {
        id: prof.id,
        name: prof.full_name,
        type: "professor" as const,
        meta: { phone: prof.phone, email: prof.email, is_active: prof.is_active, field_id: field.id },
        children: levelNodes,
      };
    });
    return {
      id: field.id,
      name: field.name,
      type: "field" as const,
      meta: { description: field.description, professor_count: fieldProfs.length },
      children,
    };
  });
}

export function buildProfessorsTree(professors: Professor[], fields: Field[], levels: Level[], groups: Group[], students: Student[]): TreeNode[] {
  const fieldMap = new Map<string, Field>();
  fields.forEach((f) => fieldMap.set(f.id, f));

  const groupByProf = new Map<string, Group[]>();
  groups.forEach((g) => {
    const arr = groupByProf.get(g.prof_id) ?? [];
    arr.push(g);
    groupByProf.set(g.prof_id, arr);
  });

  const studentCountByGroup = new Map<string, number>();
  students
    .filter((s) => s.status === "active")
    .forEach((s) => {
      // Roster = every enrollment, not the legacy primary group: a student in
      // several groups counts toward each of them.
      const enrolled = s.assignments?.length ? s.assignments.map((a) => a.group_id) : [s.group_id];
      enrolled.forEach((gid) => {
        studentCountByGroup.set(gid, (studentCountByGroup.get(gid) ?? 0) + 1);
      });
    });

  const rootNodes: TreeNode[] = [];
  const seenFields = new Set<string>();

  professors.forEach((prof) => {
    if (!seenFields.has(prof.field_id)) {
      seenFields.add(prof.field_id);
      const field = fieldMap.get(prof.field_id);
      rootNodes.push({
        id: prof.field_id,
        name: field?.name ?? "Unknown Field",
        type: "field",
        children: [],
      });
    }
  });

  professors.forEach((prof) => {
    const fieldNode = rootNodes.find((n) => n.id === prof.field_id);
    if (!fieldNode) return;

    const profGroups = groupByProf.get(prof.id) ?? [];
    const levelIds = new Set<string>();
    profGroups.forEach((g) => {
      const lid = g.professor?.field?.level?.id;
      if (lid) levelIds.add(lid);
    });

    let totalGroups = 0;
    let totalStudents = 0;
    levelIds.forEach((levelId) => {
      const levelGroups = profGroups;
      totalGroups += levelGroups.length;
      levelGroups.forEach((g) => {
        totalStudents += studentCountByGroup.get(g.id) ?? 0;
      });
    });

     fieldNode.children!.push({
      id: prof.id,
      name: prof.full_name,
      type: "professor",
      meta: { phone: prof.phone, email: prof.email, is_active: prof.is_active, levels_count: levelIds.size, groups_count: totalGroups, students_count: totalStudents, field_id: prof.field_id },
      children: [],
    });
  });

  return rootNodes;
}

export function buildLevelsTree(levels: Level[], professors: Professor[], fields: Field[], groups: Group[], students: Student[]): TreeNode[] {
  const fieldMap = new Map<string, Field>();
  fields.forEach((f) => fieldMap.set(f.id, f));

  const profByField = new Map<string, Professor[]>();
  professors.forEach((p) => {
    const arr = profByField.get(p.field_id) ?? [];
    arr.push(p);
    profByField.set(p.field_id, arr);
  });

  const groupByProf = new Map<string, Group[]>();
  groups.forEach((g) => {
    const arr = groupByProf.get(g.prof_id) ?? [];
    arr.push(g);
    groupByProf.set(g.prof_id, arr);
  });

  const studentCountByGroup = new Map<string, number>();
  students
    .filter((s) => s.status === "active")
    .forEach((s) => {
      // Roster = every enrollment, not the legacy primary group: a student in
      // several groups counts toward each of them.
      const enrolled = s.assignments?.length ? s.assignments.map((a) => a.group_id) : [s.group_id];
      enrolled.forEach((gid) => {
        studentCountByGroup.set(gid, (studentCountByGroup.get(gid) ?? 0) + 1);
      });
    });

  const rootNodes: TreeNode[] = [];
  const seenFields = new Set<string>();

  const levelsByField = new Map<string, Level[]>();
  levels.forEach((level) => {
    const profsForLevel = professors.filter((p) => fieldMap.has(p.field_id));
    if (profsForLevel.length === 0) return;
    const fieldId = profsForLevel[0].field_id;
    if (!levelsByField.has(fieldId)) levelsByField.set(fieldId, []);
    const arr = levelsByField.get(fieldId)!;
    if (!arr.some((l) => l.id === level.id)) arr.push(level);
  });

  levelsByField.forEach((fieldLevels, fieldId) => {
    if (!seenFields.has(fieldId)) {
      seenFields.add(fieldId);
      const field = fieldMap.get(fieldId);
      rootNodes.push({
        id: fieldId,
        name: field?.name ?? "Unknown Field",
        type: "field",
        children: [],
      });
    }
  });

  const fieldProfsMap = new Map<string, Professor[]>();
  professors.forEach((p) => {
    if (fieldMap.has(p.field_id)) {
      const arr = fieldProfsMap.get(p.field_id) ?? [];
      arr.push(p);
      fieldProfsMap.set(p.field_id, arr);
    }
  });

  levels.forEach((level) => {
    const firstProf = professors.find((p) => fieldMap.has(p.field_id));
    if (!firstProf) return;
    const fieldId = firstProf.field_id;
    const fieldNode = rootNodes.find((n) => n.id === fieldId);
    if (!fieldNode) return;

    const fieldProfs = fieldProfsMap.get(fieldId) ?? [];
    const primaryProf = fieldProfs[0];
    if (!primaryProf) return;

    let profNode = fieldNode.children!.find((n) => n.id === primaryProf.id);
    if (!profNode) {
      profNode = {
        id: primaryProf.id,
        name: primaryProf.full_name,
        type: "professor" as const,
        meta: { phone: primaryProf.phone, email: primaryProf.email, is_active: primaryProf.is_active, field_id: fieldId },
        children: [],
      };
      fieldNode.children!.push(profNode);
    }

    const levelGroups = groupByProf.get(primaryProf.id) ?? [];
    let totalStudents = 0;
    levelGroups.forEach((g) => {
      totalStudents += studentCountByGroup.get(g.id) ?? 0;
    });

    if (!profNode.children!.some((n) => n.id === level.id)) {
      profNode.children!.push({
        id: level.id,
        name: level.name,
        type: "level" as const,
        meta: { groups_count: levelGroups.length, students_count: totalStudents, field_id: fieldId, prof_id: primaryProf.id },
        children: [],
      });
    }
  });

  return rootNodes;
}

export function buildGroupsTree(groups: Group[], professors: Professor[], fields: Field[], students: Student[]): TreeNode[] {
  const fieldMap = new Map<string, Field>();
  fields.forEach((f) => fieldMap.set(f.id, f));

  const profMap = new Map<string, Professor>();
  professors.forEach((p) => profMap.set(p.id, p));

  const groupByProf = new Map<string, Group[]>();
  groups.forEach((g) => {
    const arr = groupByProf.get(g.prof_id) ?? [];
    arr.push(g);
    groupByProf.set(g.prof_id, arr);
  });

  const studentCountByGroup = new Map<string, number>();
  students
    .filter((s) => s.status === "active")
    .forEach((s) => {
      // Roster = every enrollment, not the legacy primary group: a student in
      // several groups counts toward each of them.
      const enrolled = s.assignments?.length ? s.assignments.map((a) => a.group_id) : [s.group_id];
      enrolled.forEach((gid) => {
        studentCountByGroup.set(gid, (studentCountByGroup.get(gid) ?? 0) + 1);
      });
    });

  const rootNodes: TreeNode[] = [];
  const seenFields = new Set<string>();

  groups.forEach((group) => {
    const prof = profMap.get(group.prof_id);
    if (!prof) return;
    if (!seenFields.has(prof.field_id)) {
      seenFields.add(prof.field_id);
      const field = fieldMap.get(prof.field_id);
      rootNodes.push({
        id: prof.field_id,
        name: field?.name ?? "Unknown Field",
        type: "field",
        children: [],
      });
    }
  });

  const groupsByLevel = new Map<string, { levelId: string; levelName: string; groups: Group[] }>();
  groups.forEach((group) => {
    const prof = profMap.get(group.prof_id);
    if (!prof) return;
    const levelId = prof.field?.level?.id;
    const levelName = prof.field?.level?.name ?? "Level";
    if (!levelId) return;
    if (!groupsByLevel.has(levelId)) {
      groupsByLevel.set(levelId, { levelId, levelName, groups: [] });
    }
    groupsByLevel.get(levelId)!.groups.push(group);
  });

  groups.forEach((group) => {
    const prof = profMap.get(group.prof_id);
    if (!prof) return;
    const fieldNode = rootNodes.find((n) => n.id === prof.field_id);
    if (!fieldNode) return;

    let profNode = fieldNode.children!.find((n) => n.id === prof.id);
    if (!profNode) {
      profNode = {
        id: prof.id,
        name: prof.full_name,
        type: "professor" as const,
        meta: { phone: prof.phone, email: prof.email, is_active: prof.is_active, field_id: prof.field_id },
        children: [],
      };
      fieldNode.children!.push(profNode);
    }

    const levelId = prof.field?.level?.id;
    const levelName = prof.field?.level?.name ?? "Level";
    if (!levelId) return;

    let levelNode = profNode.children!.find((n) => n.id === levelId);
    if (!levelNode) {
      levelNode = {
        id: levelId,
        name: levelName,
        type: "level" as const,
        meta: { field_id: prof.field_id, prof_id: prof.id },
        children: [],
      };
      profNode.children!.push(levelNode);
    }

    levelNode.children!.push({
      id: group.id,
      name: group.name,
      type: "group" as const,
      meta: { capacity: group.capacity, schedule_notes: group.schedule_notes, student_count: studentCountByGroup.get(group.id) ?? 0, field_id: prof.field_id, prof_id: prof.id, level_id: levelId },
      children: [],
    });
  });

  return rootNodes;
}
