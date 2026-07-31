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
    const fieldName = student.group?.level?.professor?.field?.name ?? "Unknown Field";
    const fieldId = student.group?.level?.professor?.field?.id ?? "unknown-field";
    const profName = student.group?.level?.professor?.full_name ?? "Unknown Professor";
    const profId = student.group?.level?.professor?.id ?? "unknown-prof";
    const levelName = student.group?.level?.name ?? "Unknown Level";
    const levelId = student.group?.level?.id ?? "unknown-level";
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
      name: profMap.values().next().value?.values().next().value?.values().next().value?.children?.[0]?.student?.group?.level?.professor?.field?.name ?? "Field",
      type: "field",
      children: [],
    };

    profMap.forEach((levelMap, profId) => {
      const profNode: TreeNode = {
        id: profId,
        name: levelMap.values().next().value?.values().next().value?.children?.[0]?.student?.group?.level?.professor?.full_name ?? "Professor",
        type: "professor",
        children: [],
      };

      levelMap.forEach((groupMap, levelId) => {
        const levelNode: TreeNode = {
          id: levelId,
          name: groupMap.values().next().value?.children?.[0]?.student?.group?.level?.name ?? "Level",
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

  const levelByProf = new Map<string, Level[]>();
  levels.forEach((l) => {
    const arr = levelByProf.get(l.prof_id) ?? [];
    arr.push(l);
    levelByProf.set(l.prof_id, arr);
  });

  const groupByLevel = new Map<string, Group[]>();
  groups.forEach((g) => {
    const arr = groupByLevel.get(g.level_id) ?? [];
    arr.push(g);
    groupByLevel.set(g.level_id, arr);
  });

  const studentCountByGroup = new Map<string, number>();
  students.forEach((s) => {
    studentCountByGroup.set(s.group_id, (studentCountByGroup.get(s.group_id) ?? 0) + 1);
  });

  return fields.map((field) => {
    const fieldProfs = profByField.get(field.id) ?? [];
    const children: TreeNode[] = fieldProfs.map((prof) => {
      const profLevels = levelByProf.get(prof.id) ?? [];
      const levelNodes: TreeNode[] = profLevels.map((level) => {
        const levelGroups = groupByLevel.get(level.id) ?? [];
        const groupNodes: TreeNode[] = levelGroups.map((group) => ({
          id: group.id,
          name: group.name,
          type: "group" as const,
          meta: { capacity: group.capacity, schedule_notes: group.schedule_notes, student_count: studentCountByGroup.get(group.id) ?? 0, field_id: field.id, prof_id: prof.id, level_id: level.id },
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

  const levelByProf = new Map<string, Level[]>();
  levels.forEach((l) => {
    const arr = levelByProf.get(l.prof_id) ?? [];
    arr.push(l);
    levelByProf.set(l.prof_id, arr);
  });

  const groupByLevel = new Map<string, Group[]>();
  groups.forEach((g) => {
    const arr = groupByLevel.get(g.level_id) ?? [];
    arr.push(g);
    groupByLevel.set(g.level_id, arr);
  });

  const studentCountByGroup = new Map<string, number>();
  students.forEach((s) => {
    studentCountByGroup.set(s.group_id, (studentCountByGroup.get(s.group_id) ?? 0) + 1);
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

    const profLevels = levelByProf.get(prof.id) ?? [];
    let totalGroups = 0;
    let totalStudents = 0;
    profLevels.forEach((level) => {
      const levelGroups = groupByLevel.get(level.id) ?? [];
      totalGroups += levelGroups.length;
      levelGroups.forEach((g) => {
        totalStudents += studentCountByGroup.get(g.id) ?? 0;
      });
    });

     fieldNode.children!.push({
      id: prof.id,
      name: prof.full_name,
      type: "professor",
      meta: { phone: prof.phone, email: prof.email, is_active: prof.is_active, levels_count: profLevels.length, groups_count: totalGroups, students_count: totalStudents, field_id: prof.field_id },
      children: [],
    });
  });

  return rootNodes;
}

export function buildLevelsTree(levels: Level[], professors: Professor[], fields: Field[], groups: Group[], students: Student[]): TreeNode[] {
  const fieldMap = new Map<string, Field>();
  fields.forEach((f) => fieldMap.set(f.id, f));

  const profMap = new Map<string, Professor>();
  professors.forEach((p) => profMap.set(p.id, p));

  const groupByLevel = new Map<string, Group[]>();
  groups.forEach((g) => {
    const arr = groupByLevel.get(g.level_id) ?? [];
    arr.push(g);
    groupByLevel.set(g.level_id, arr);
  });

  const studentCountByGroup = new Map<string, number>();
  students.forEach((s) => {
    studentCountByGroup.set(s.group_id, (studentCountByGroup.get(s.group_id) ?? 0) + 1);
  });

  const rootNodes: TreeNode[] = [];
  const seenFields = new Set<string>();

  levels.forEach((level) => {
    const prof = profMap.get(level.prof_id);
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

  levels.forEach((level) => {
    const prof = profMap.get(level.prof_id);
    if (!prof) return;
    const fieldNode = rootNodes.find((n) => n.id === prof.field_id);
    if (!fieldNode) return;

    let profNode = fieldNode.children!.find((n) => n.id === prof.id);
    if (!profNode) {
      profNode = {
        id: prof.id,
        name: prof.full_name,
        type: "professor",
        meta: { phone: prof.phone, email: prof.email, is_active: prof.is_active, field_id: prof.field_id },
        children: [],
      };
      fieldNode.children!.push(profNode);
    }

    const levelGroups = groupByLevel.get(level.id) ?? [];
    let totalStudents = 0;
    levelGroups.forEach((g) => {
      totalStudents += studentCountByGroup.get(g.id) ?? 0;
    });

    profNode.children!.push({
      id: level.id,
      name: level.name,
      type: "level",
      meta: { groups_count: levelGroups.length, students_count: totalStudents, field_id: prof.field_id, prof_id: prof.id },
      children: [],
    });
  });

  return rootNodes;
}

export function buildGroupsTree(groups: Group[], levels: Level[], professors: Professor[], fields: Field[], students: Student[]): TreeNode[] {
  const fieldMap = new Map<string, Field>();
  fields.forEach((f) => fieldMap.set(f.id, f));

  const profMap = new Map<string, Professor>();
  professors.forEach((p) => profMap.set(p.id, p));

  const levelMap = new Map<string, Level>();
  levels.forEach((l) => levelMap.set(l.id, l));

  const studentCountByGroup = new Map<string, number>();
  students.forEach((s) => {
    studentCountByGroup.set(s.group_id, (studentCountByGroup.get(s.group_id) ?? 0) + 1);
  });

  const rootNodes: TreeNode[] = [];
  const seenFields = new Set<string>();

  groups.forEach((group) => {
    const level = levelMap.get(group.level_id);
    const prof = level ? profMap.get(level.prof_id) : undefined;
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

  groups.forEach((group) => {
    const level = levelMap.get(group.level_id);
    const prof = level ? profMap.get(level.prof_id) : undefined;
    if (!prof) return;
    const fieldNode = rootNodes.find((n) => n.id === prof.field_id);
    if (!fieldNode) return;

    let profNode = fieldNode.children!.find((n) => n.id === prof.id);
    if (!profNode) {
      profNode = {
        id: prof.id,
        name: prof.full_name,
        type: "professor",
        meta: { phone: prof.phone, email: prof.email, is_active: prof.is_active, field_id: prof.field_id },
        children: [],
      };
      fieldNode.children!.push(profNode);
    }

    let levelNode = profNode.children!.find((n) => n.id === level!.id);
    if (!levelNode) {
      levelNode = {
        id: level!.id,
        name: level!.name,
        type: "level",
        meta: { field_id: prof.field_id, prof_id: prof.id },
        children: [],
      };
      profNode.children!.push(levelNode);
    }

    levelNode.children!.push({
      id: group.id,
      name: group.name,
      type: "group",
      meta: { capacity: group.capacity, schedule_notes: group.schedule_notes, student_count: studentCountByGroup.get(group.id) ?? 0, field_id: prof.field_id, prof_id: prof.id, level_id: level!.id },
      children: [],
    });
  });

  return rootNodes;
}