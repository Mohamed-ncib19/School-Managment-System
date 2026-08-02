"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer, ChevronRight } from "lucide-react";
import { groupsApi } from "@/lib/api/groups.api";
import { studentsApi } from "@/lib/api/students.api";
import { useProfessors } from "@/hooks/use-queries";
import Link from "next/link";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useTranslation } from "@/lib/i18n/context";
import type { Group, Student } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { AttendanceSheetModal } from "@/components/shared/attendance-sheet-modal";
import { formatDate } from "@/lib/utils/format";

const MONTH_NAMES_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export default function AttendanceSheetPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const groupId = params.groupId as string;

  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === "super_admin";

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
  const { data: students, isLoading: studentsLoading } = useQuery({
    queryKey: ["students", groupId],
    queryFn: () => studentsApi.list(groupId),
  });

  const [modalOpen, setModalOpen] = useState(true);
  const [previewData, setPreviewData] = useState<{
    month: number;
    year: number;
    schedule: string;
    teacherName: string;
    groupName: string;
    levelName: string;
    students: Student[];
  } | null>(null);

  const isLoading = groupLoading || studentsLoading;

  const handleGenerate = (data: {
    month: number;
    year: number;
    schedule: string;
    teacherId: string;
  }) => {
    const selectedTeacher = professors?.find((p) => p.id === data.teacherId) ?? professor;
    const teacherName = selectedTeacher?.full_name ?? professor?.full_name ?? "Inconnu";

    if (!group || !level) return;

    const sortedStudents = [...(students ?? [])].sort((a, b) => {
      const nameA = `${a.last_name} ${a.first_name}`.toLowerCase();
      const nameB = `${b.last_name} ${b.first_name}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

    setPreviewData({
      month: data.month,
      year: data.year,
      schedule: data.schedule,
      teacherName,
      groupName: group.name,
      levelName: level.name,
      students: sortedStudents,
    });
    setModalOpen(false);
  };

  const handlePrint = () => {
    if (!previewData) return;

    const daysInMonth = new Date(previewData.year, previewData.month, 0).getDate();
    const monthName = MONTH_NAMES_FR[previewData.month - 1];
    const generatedOn = formatDate(new Date());

    const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const dayCells = dayHeaders.map((d) => `<td class="day-col">&nbsp;</td>`).join("");

    const studentRows = previewData.students
      .map(
        (s) => `
      <tr>
        <td class="student-name">${s.last_name} ${s.first_name}</td>
        <td class="student-phone">${s.phone || s.parent_phone || ""}</td>
        ${dayCells}
      </tr>
    `,
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Feuille de Présence - ${previewData.groupName} - ${monthName} ${previewData.year}</title>
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              font-size: 10px;
              color: #000;
              line-height: 1.3;
            }
            .sheet { width: 100%; }
            .header {
              text-align: center;
              border-bottom: 2px solid #000;
              padding-bottom: 8px;
              margin-bottom: 10px;
            }
            .logo {
              font-size: 20px;
              font-weight: 800;
              letter-spacing: 2px;
              text-transform: uppercase;
            }
            .title {
              font-size: 14px;
              font-weight: 700;
              margin-top: 4px;
              text-transform: uppercase;
            }
            .meta {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 3px 16px;
              margin-top: 8px;
              text-align: left;
            }
            .meta-item { font-size: 10px; }
            .meta-label { font-weight: 700; }
            .schedule {
              margin-top: 6px;
              font-size: 10px;
              text-align: left;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            th, td {
              border: 1px solid #000;
              padding: 3px 4px;
              text-align: center;
              vertical-align: middle;
            }
            th {
              font-weight: 700;
              background: #e5e5e5;
            }
            thead { display: table-header-group; }
            tr { page-break-inside: avoid; }
            .student-name {
              text-align: left;
              width: 55mm;
              font-weight: 500;
            }
            .student-phone {
              text-align: left;
              width: 35mm;
            }
            .day-col {
              width: 4.2mm;
              min-width: 4.2mm;
              height: 8mm;
            }
            .footer {
              margin-top: 14px;
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
            }
            .signature-box {
              text-align: center;
            }
            .signature-line {
              border-top: 1px solid #000;
              width: 120px;
              margin: 0 auto;
              padding-top: 4px;
              font-size: 10px;
            }
            .generated {
              font-size: 9px;
              color: #444;
              margin-top: 4px;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <div class="sheet">
            <div class="header">
              <div class="logo">IQ ACADEMY</div>
              <div class="title">Feuille de Présence Mensuelle</div>
            </div>
            <div class="meta">
              <div class="meta-item"><span class="meta-label">Enseignant :</span> ${previewData.teacherName}</div>
              <div class="meta-item"><span class="meta-label">Niveau :</span> ${previewData.levelName}</div>
              <div class="meta-item"><span class="meta-label">Groupe :</span> ${previewData.groupName}</div>
              <div class="meta-item"><span class="meta-label">Mois :</span> ${monthName} ${previewData.year}</div>
            </div>
            ${previewData.schedule ? `<div class="schedule"><span class="meta-label">Emploi du temps :</span> ${previewData.schedule.replace(/\n/g, "<br>")}</div>` : ""}
            <table>
              <thead>
                <tr>
                  <th class="student-name">Nom de l'étudiant</th>
                  <th class="student-phone">Téléphone</th>
                  ${dayHeaders.map((d) => `<th class="day-col">${d}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${studentRows || "<tr><td colspan='2' style='text-align:center;padding:12px;'>Aucun étudiant dans ce groupe</td>" + dayCells + "</tr>"}
              </tbody>
            </table>
            <div class="footer">
              <div class="signature-box">
                <div class="signature-line">Signature de l'enseignant</div>
              </div>
              <div class="signature-box">
                <div class="signature-line">Généré le : ${generatedOn}</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  // The group list sits one level above the group: /hierarchy/.../level/{lId}.
  const handleBack = () => {
    if (fieldId && profId && levelId) {
      router.push(`/hierarchy/field/${fieldId}/professor/${profId}/level/${levelId}`);
    } else {
      router.push("/hierarchy");
    }
  };

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
        <LoadingSkeleton type="table-row" />
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
          {previewData && (
            <button className="btn btn-primary" onClick={handlePrint}>
              <Printer size={16} /> {t("attendanceSheet.printButton")}
            </button>
          )}
          {!previewData && (
            <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
              {t("attendanceSheet.generateButton")}
            </button>
          )}
        </div>

        {previewData && (
          <div className="card p-6">
            <h3 className="text-h4 font-bold mb-4">{t("attendanceSheet.preview")}</h3>
            <div className="border border-border rounded-lg p-4 bg-white dark:bg-neutral-900">
              <div className="text-center border-b-2 border-black pb-2 mb-3">
                <div className="text-lg font-extrabold tracking-widest uppercase">IQ ACADEMY</div>
                <div className="text-sm font-bold uppercase mt-1">{t("attendanceSheet.title")}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2 text-sm">
                <div><span className="font-bold">{t("attendanceSheet.teacher")} :</span> {previewData.teacherName}</div>
                <div><span className="font-bold">{t("attendanceSheet.level")} :</span> {previewData.levelName}</div>
                <div><span className="font-bold">{t("attendanceSheet.group")} :</span> {previewData.groupName}</div>
                <div><span className="font-bold">{t("attendanceSheet.month")} :</span> {MONTH_NAMES_FR[previewData.month - 1]} {previewData.year}</div>
              </div>
              {previewData.schedule && (
                <div className="text-sm mb-3">
                  <span className="font-bold">{t("attendanceSheet.schedule")} :</span> {previewData.schedule}
                </div>
              )}
              <div className="overflow-x-auto border border-black">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="border border-black px-2 py-1 text-left w-48">{t("attendanceSheet.studentName")}</th>
                      <th className="border border-black px-2 py-1 text-left w-28">{t("attendanceSheet.phone")}</th>
                      {Array.from({ length: new Date(previewData.year, previewData.month, 0).getDate() }, (_, i) => (
                        <th key={i} className="border border-black px-1 py-1 w-6 text-center">{i + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.students.length === 0 ? (
                      <tr>
                        <td colSpan={2 + new Date(previewData.year, previewData.month, 0).getDate()} className="border border-black px-2 py-3 text-center">
                          {t("attendanceSheet.noStudents")}
                        </td>
                      </tr>
                    ) : (
                      previewData.students.map((s) => (
                        <tr key={s.id}>
                          <td className="border border-black px-2 py-1 text-left">{s.last_name} {s.first_name}</td>
                          <td className="border border-black px-2 py-1 text-left">{s.phone || s.parent_phone || ""}</td>
                          {Array.from({ length: new Date(previewData.year, previewData.month, 0).getDate() }, () => (
                            <td key={Math.random()} className="border border-black px-1 py-1 w-6">&nbsp;</td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between mt-4 text-sm">
                <div className="text-center">
                  <div className="border-t border-black w-32 pt-1">{t("attendanceSheet.teacherSignature")}</div>
                </div>
                <div className="text-center">
                  <div className="border-t border-black w-32 pt-1">{t("attendanceSheet.generatedOn")} : {formatDate(new Date())}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {!previewData && (
          <div className="card p-8 text-center text-text-secondary">
            <p className="mb-2">{t("attendanceSheet.noSheetYet")}</p>
            <p className="text-sm">{t("attendanceSheet.clickToGenerate")}</p>
          </div>
        )}
      </div>

      <AttendanceSheetModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onGenerate={handleGenerate}
        group={group as Group}
        professor={professor}
        level={level}
        professors={professors ?? []}
        isSuperAdmin={isSuperAdmin}
      />
    </>
  );
}
