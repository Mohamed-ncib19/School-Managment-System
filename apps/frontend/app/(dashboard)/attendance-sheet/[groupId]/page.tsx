"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  ChevronRight,
  Download,
  Loader2,
  Printer,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { groupsApi } from "@/lib/api/groups.api";
import {
  attendanceSheetsApi,
  downloadAttendanceExcel,
  openAttendancePrint,
} from "@/lib/api/attendance-sheets.api";
import { useProfessors } from "@/hooks/use-queries";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useTranslation } from "@/lib/i18n/context";
import type { AttendanceSession, AttendanceStudent } from "@/types";
import { PageLoader } from "@/components/shared/skeletons";
import { formatDate } from "@/lib/utils/format";

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

/** A register being prepared: context + sessions the user may still edit. */
interface Draft {
  month: number;
  year: number;
  academicYear: string;
  schedule: string | null;
  teacherId: string | null;
  teacherName: string;
  levelName: string;
  fieldName: string | null;
  groupName: string;
  students: AttendanceStudent[];
  sessions: AttendanceSession[];
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function AttendanceSheetPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const groupId = params.groupId as string;

  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === "super_admin";

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [teacherId, setTeacherId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftSheetId, setDraftSheetId] = useState<string | null>(null);

  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => groupsApi.get(groupId),
  });

  // The group payload carries its full chain (professor -> field -> level),
  // so the attendance sheet needs no other URL segments.
  const fieldId = group?.professor?.field_id;
  const profId = group?.prof_id;
  const levelId = group?.professor?.field?.level_id;
  const professor = group?.professor ?? null;
  const level = group?.professor?.field?.level ?? null;

  const { data: professors } = useProfessors(fieldId, { enabled: !!fieldId });

  // Every printed sheet is persisted, so a reprint shows the exact list that
  // was handed out rather than whatever the group roster looks like today.
  const { data: savedSheets } = useQuery({
    queryKey: ["attendance-sheets", groupId],
    queryFn: () => attendanceSheetsApi.listForGroup(groupId),
    enabled: !!groupId,
  });
  const saveSheet = useMutation({
    mutationFn: attendanceSheetsApi.save,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance-sheets", groupId] }),
  });
  const deleteSheet = useMutation({
    mutationFn: attendanceSheetsApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance-sheets", groupId] }),
  });
  const generate = useMutation({
    mutationFn: attendanceSheetsApi.generate,
  });

  const handleGenerate = async () => {
    const result = await generate.mutateAsync({ group_id: groupId, month, year });
    const selected = professors?.find((p) => p.id === teacherId);
    const teacherName = selected?.full_name ?? result.professor_name ?? "—";
    setDraft({
      month: result.month,
      year: result.year,
      academicYear: result.academic_year,
      schedule: result.schedule,
      teacherId: teacherId || result.professor_id,
      teacherName,
      levelName: result.level_name,
      fieldName: result.field_name,
      groupName: result.group_name,
      students: result.students,
      sessions: result.sessions,
    });
    setDraftSheetId(null);
  };

  const removeSession = (id: string) =>
    setDraft((d) => (d ? { ...d, sessions: d.sessions.filter((s) => s.id !== id) } : d));

  const moveSession = (index: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const target = index + dir;
      if (target < 0 || target >= d.sessions.length) return d;
      const sessions = [...d.sessions];
      [sessions[index], sessions[target]] = [sessions[target], sessions[index]];
      return { ...d, sessions };
    });

  const addSession = () => {
    setDraft((d) => (d ? { ...d, sessions: [...d.sessions, { id: uid() }] } : d));
  };

  /** Re-generates the default 8 sessions (any count) from the group schedule. */
  const resetSessions = async () => {
    if (!draft) return;
    const result = await generate.mutateAsync({ group_id: groupId, month: draft.month, year: draft.year });
    setDraft({ ...draft, sessions: result.sessions });
  };

  const handleLoad = (sheet: {
    id: string;
    month: number;
    year: number;
    schedule: string | null;
    teacher_name: string;
    teacher_id: string | null;
    level_name: string;
    field_name: string | null;
    group_name: string;
    academic_year: string | null;
    students: unknown[];
    sessions: AttendanceSession[] | null;
  }) => {
    const legacy = Array.from({ length: 8 }, (_, i) => ({
      id: `legacy-${i + 1}`,
    }));
    setDraft({
      month: sheet.month,
      year: sheet.year,
      academicYear: sheet.academic_year ?? "",
      schedule: sheet.schedule,
      teacherId: sheet.teacher_id,
      teacherName: sheet.teacher_name,
      levelName: sheet.level_name,
      fieldName: sheet.field_name,
      groupName: sheet.group_name,
      students: (sheet.students ?? []) as AttendanceStudent[],
      sessions: sheet.sessions ?? legacy,
    });
    setDraftSheetId(sheet.id);
  };

  const handleDelete = (id: string) => {
    if (!window.confirm(t("attendanceSheet.confirmDelete", "Delete this saved sheet?"))) return;
    deleteSheet.mutate(id);
  };

  const buildSavePayload = () => {
    if (!draft) return null;
    return {
      group_id: groupId,
      month: draft.month,
      year: draft.year,
      schedule: draft.schedule ?? undefined,
      teacher_id: draft.teacherId ?? undefined,
      teacher_name: draft.teacherName,
      level_name: draft.levelName,
      field_name: draft.fieldName ?? undefined,
      group_name: draft.groupName,
      academic_year: draft.academicYear || undefined,
      sessions: draft.sessions,
      students: draft.students,
    };
  };

  /** Saves the current draft as a new snapshot, returning the row id. */
  const ensureSaved = async (): Promise<string> => {
    const payload = buildSavePayload();
    if (!payload) throw new Error("nothing-to-save");
    if (draftSheetId) return draftSheetId;
    const saved = await saveSheet.mutateAsync(payload);
    setDraftSheetId(saved.id);
    return saved.id;
  };

  const handlePrint = async () => {
    if (!draft) return;
    try {
      const id = await ensureSaved();
      await openAttendancePrint(id);
    } catch {
      // popup blocked or save failed — the buttons simply had no effect
    }
  };

  const handleExcel = async () => {
    if (!draft) return;
    try {
      const id = await ensureSaved();
      await downloadAttendanceExcel(id);
    } catch {
      // download failed — nothing to do here
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    await ensureSaved();
  };

  const handleBack = () => {
    if (fieldId && profId && levelId) {
      router.push(`/hierarchy/field/${fieldId}/professor/${profId}/level/${levelId}`);
    } else {
      router.push("/hierarchy");
    }
  };

  const isLoading = groupLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="h-9 w-9 flex items-center justify-center rounded-btn hover:bg-neutral-soft">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-h4 font-bold text-text-primary">{t("attendanceSheet.title")}</h2>
            <p className="text-xs text-text-secondary">{t("common.loading", "Loading…")}</p>
          </div>
        </div>
        <PageLoader text={t("common.loading", "Loading…")} />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="h-9 w-9 flex items-center justify-center rounded-btn hover:bg-neutral-soft">
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-h4 font-bold text-text-primary">{t("attendanceSheet.title")}</h2>
        </div>
        <p className="text-sm text-danger">{t("attendanceSheet.groupNotFound", "Group not found.")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/hierarchy" className="hover:text-primary">{t("fieldsHierarchy.breadcrumbFields")}</Link>
          {level && (
            <>
              <ChevronRight size={14} />
              <Link
                href={fieldId && profId ? `/hierarchy/field/${fieldId}/professor/${profId}/level/${level.id}` : "#"}
                className="hover:text-primary"
              >
                {level.name}
              </Link>
            </>
          )}
          <ChevronRight size={14} />
          <span className="text-text-primary font-medium">{t("attendanceSheet.title")}</span>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="h-9 w-9 flex items-center justify-center rounded-btn hover:bg-neutral-soft" aria-label={t("fieldsHierarchy.goBack")}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h2 className="text-h4 font-bold text-text-primary">{t("attendanceSheet.title")}</h2>
            <p className="text-xs text-text-secondary">{group.name} - {level?.name}</p>
          </div>
          {draft && (
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary" onClick={handleSave} disabled={saveSheet.isPending}>
                {saveSheet.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {t("attendanceSheet.save", "Save")}
              </button>
              <button className="btn btn-secondary" onClick={handleExcel} disabled={saveSheet.isPending}>
                <Download size={16} />
                {t("attendanceSheet.excel", "Excel")}
              </button>
              <button className="btn btn-primary" onClick={handlePrint} disabled={saveSheet.isPending}>
                <Printer size={16} />
                {t("attendanceSheet.printButton")}
              </button>
            </div>
          )}
        </div>

        {/* Generate card: month / year / teacher, always visible so the user
            can switch month and regenerate sessions. */}
        <div className="card p-5">
          <h3 className="text-h4 font-bold mb-4">{t("attendanceSheet.generateButton")}</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("attendanceSheet.month")} *</label>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="input">
                {MONTHS_FR.map((name, idx) => (
                  <option key={idx} value={idx + 1}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("attendanceSheet.year")} *</label>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="input">
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            {isSuperAdmin && (
              <div>
                <label className="block text-sm font-medium mb-1">{t("attendanceSheet.teacher")}</label>
                <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="input">
                  <option value="">{professor?.full_name ?? t("attendanceSheet.selectTeacher")}</option>
                  {professors?.filter((p) => p.id !== professor?.id).map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generate.isPending}
            >
              {generate.isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarPlus size={16} />}
              {draft ? t("attendanceSheet.regenerate", "Regenerate sessions") : t("attendanceSheet.generate", "Generate")}
            </button>
          </div>
          <p className="text-xs text-text-secondary mt-3">
            {t("attendanceSheet.generateHint", "Sessions are laid out from the group schedule (8 séances by default) — add or remove séances below as needed.")}
          </p>
        </div>

        {draft && (
          <>
            {/* Session editor */}
            <div className="card p-5">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                <div>
                  <h3 className="text-h4 font-bold">
                    {t("attendanceSheet.sessions", "Sessions")}
                    <span className="ml-2 text-xs font-semibold text-primary bg-primary-50 px-2 py-0.5 rounded-full">
                      {draft.sessions.length}
                    </span>
                  </h3>
                  <p className="text-xs text-text-secondary mt-1">
                    {t("attendanceSheet.sessionsHint", "Add or remove séances, reorder them — the printed register follows exactly.")}
                  </p>
                </div>
                <button className="btn btn-secondary text-xs" onClick={resetSessions} disabled={generate.isPending}>
                  <RotateCcw size={13} />
                  {t("attendanceSheet.resetSessions", "Reset to default")}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {draft.sessions.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-1.5 border border-border rounded-btn p-2 bg-white dark:bg-neutral-900">
                    <span className="text-xs font-bold text-primary flex-1">{t("attendanceSheet.seance", "S")}{i + 1}</span>
                    <div className="flex flex-col shrink-0">
                      <button type="button" className="p-0.5 text-text-secondary hover:text-primary" onClick={() => moveSession(i, -1)} disabled={i === 0} aria-label={t("attendanceSheet.moveUp", "Move up")}>
                        <ArrowUp size={12} />
                      </button>
                      <button type="button" className="p-0.5 text-text-secondary hover:text-primary" onClick={() => moveSession(i, 1)} disabled={i === draft.sessions.length - 1} aria-label={t("attendanceSheet.moveDown", "Move down")}>
                        <ArrowDown size={12} />
                      </button>
                    </div>
                    <button type="button" className="p-1 text-text-secondary hover:text-danger shrink-0" onClick={() => removeSession(s.id)} aria-label={t("attendanceSheet.removeSession", "Remove session")}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" className="flex items-center justify-center gap-1.5 border border-dashed border-primary/40 rounded-btn p-2 bg-primary-50 text-primary text-xs font-semibold hover:bg-primary-100" onClick={addSession}>
                  <CalendarPlus size={13} />
                  {t("attendanceSheet.addSession", "Add")}
                </button>
              </div>
            </div>

            {/* Print-ready preview */}
            <div className="card p-6">
              <h3 className="text-h4 font-bold mb-4">{t("attendanceSheet.preview")}</h3>
              <div className="border border-primary-200 rounded-lg p-5 bg-white shadow-sm overflow-x-auto">
                <div className="min-w-[640px]">
                  {/* Header */}
                  <div className="flex items-end justify-between gap-4 border-b-[2.5px] border-primary pb-2">
                    <div>
                      <div className="text-primary font-bold text-lg leading-tight">{draft.groupName}</div>
                      <div className="text-[10px] text-text-secondary">{t("attendanceSheet.academyLabel", "Monthly attendance register")}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-primary font-semibold uppercase tracking-wide text-sm">
                        {t("attendanceSheet.title")}
                      </div>
                      {draft.academicYear && (
                        <div className="text-[10px] text-text-secondary">
                          {t("attendanceSheet.academicYear", "Academic year")} : {draft.academicYear}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Info panel */}
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 border border-primary rounded-md overflow-hidden">
                    {[
                      [t("attendanceSheet.teacher"), draft.teacherName],
                      [t("attendanceSheet.month"), `${MONTHS_FR[draft.month - 1]} ${draft.year}`],
                      [t("attendanceSheet.level"), draft.levelName],
                      [t("attendanceSheet.field", "Field"), draft.fieldName ?? "—"],
                      [t("attendanceSheet.group"), draft.groupName],
                      [t("attendanceSheet.sessions"), String(draft.sessions.length)],
                    ].map(([k, v], i) => (
                      <div key={i} className="bg-[#F8E8A5] border-r border-primary/40 px-2.5 py-1.5 last:border-r-0">
                        <div className="text-[8px] font-semibold uppercase tracking-wider text-primary">{k}</div>
                        <div className="text-[11px] font-semibold text-gray-800 truncate">{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Schedule banner */}
                  {draft.schedule && (
                    <div className="mt-2 bg-[#DCEEFF] border border-primary rounded-md px-3 py-1.5 flex items-center gap-2">
                      <span className="text-[8.5px] font-bold uppercase tracking-wider text-primary whitespace-nowrap">
                        {t("attendanceSheet.schedule")}
                      </span>
                      <span className="text-[10.5px] font-semibold text-gray-800 whitespace-pre-wrap">
                        {draft.schedule}
                      </span>
                    </div>
                  )}

                  {/* Register table */}
                  <table className="w-full mt-2 border-2 border-primary border-collapse table-fixed text-[10px]">
                    <thead>
                      <tr>
                        <th className="w-7 bg-primary text-white border border-primary py-1 font-semibold">#</th>
                        <th className="w-36 bg-primary text-white border border-primary py-1 font-semibold text-left px-1.5">
                          {t("attendanceSheet.studentName")}
                        </th>
                        <th className="w-20 bg-primary text-white border border-primary py-1 font-semibold text-left px-1.5">
                          {t("attendanceSheet.phone")}
                        </th>
                        {draft.sessions.map((s, i) => (
                          <th key={s.id} className="bg-primary text-white border border-primary py-1 font-semibold px-0.5">
                            {t("attendanceSheet.seance", "S")}{i + 1}
                          </th>
                        ))}
                        <th className="w-24 bg-white text-primary border border-primary py-1 font-semibold">
                          {t("attendanceSheet.presence", "Presence")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.students.length === 0 ? (
                        <tr>
                          <td colSpan={3 + draft.sessions.length + 1} className="border border-primary py-4 text-center text-text-secondary">
                            {t("attendanceSheet.noStudents")}
                          </td>
                        </tr>
                      ) : (
                        draft.students.map((s, i) => (
                          <tr key={s.id ?? i} className="break-inside-avoid">
                            <td className="border border-primary text-center py-1.5 font-semibold text-gray-500">{i + 1}</td>
                            <td className="border border-primary text-left px-1.5 py-1.5 font-medium text-gray-800">
                              {s.last_name} {s.first_name}
                            </td>
                            <td className="border border-primary text-left px-1.5 py-1.5 text-gray-600">
                              {s.phone?.trim() || ""}
                            </td>
                            {draft.sessions.map((ses) => (
                              <td key={ses.id} className="border border-primary" />
                            ))}
                            <td className="border border-primary" />
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>

                  {/* Signatures */}
                  <div className="flex justify-between gap-8 mt-8">
                    <div className="flex-1 text-center">
                      <div className="border-b-[1.2px] border-primary h-10" />
                      <div className="text-[10px] font-medium text-gray-700 mt-1.5">
                        {t("attendanceSheet.teacherSignature")}
                      </div>
                    </div>
                    <div className="flex-1 text-center">
                      <div className="border-b-[1.2px] border-primary h-10" />
                      <div className="text-[10px] font-medium text-gray-700 mt-1.5">
                        {t("attendanceSheet.adminSignature", "Administrator signature")}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between mt-4 pt-2 border-t border-primary-100 text-[9px] text-text-secondary">
                    <span>
                      {t("attendanceSheet.generatedOn")} : {formatDate(new Date())}
                      {isSuperAdmin ? ` · ${t("attendanceSheet.generatedBy", "Generated by")} : ${user?.full_name}` : ""}
                    </span>
                    <span className="font-semibold text-primary">
                      {t("attendanceSheet.page", "Page")} 1 / {draft.students.length > 24 ? 2 : 1}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {!draft && (
          <div className="card p-8 text-center text-text-secondary">
            <p className="mb-2">{t("attendanceSheet.noSheetYet")}</p>
            <p className="text-sm">{t("attendanceSheet.clickToGenerate")}</p>
          </div>
        )}

        {savedSheets && savedSheets.length > 0 && (
          <div className="card">
            <h3 className="text-h4 font-bold mb-3">{t("attendanceSheet.savedSheets", "Saved sheets")}</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                      {t("attendanceSheet.month", "Month")}
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                      {t("attendanceSheet.teacher", "Teacher")}
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                      {t("attendanceSheet.studentsCount", "Students")}
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                      {t("attendanceSheet.sessions", "Sessions")}
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                      {t("attendanceSheet.generatedOn", "Generated on")}
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary uppercase" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {savedSheets.map((sheet) => (
                    <tr key={sheet.id} className="hover:bg-background/50">
                      <td className="px-3 py-2 font-medium">
                        {MONTHS_FR[sheet.month - 1]} {sheet.year}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{sheet.teacher_name}</td>
                      <td className="px-3 py-2 text-text-secondary">{Array.isArray(sheet.students) ? sheet.students.length : 0}</td>
                      <td className="px-3 py-2 text-text-secondary">
                        {Array.isArray(sheet.sessions) ? sheet.sessions.length : 8}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{formatDate(sheet.generated_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button type="button" onClick={() => handleLoad(sheet)} className="btn btn-secondary text-xs">
                            {t("attendanceSheet.load", "Load")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(sheet.id)}
                            disabled={deleteSheet.isPending}
                            aria-label={t("common.delete", "Delete")}
                            className="btn btn-secondary text-xs text-danger hover:text-danger"
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
