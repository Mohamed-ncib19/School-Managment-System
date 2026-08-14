import { Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { students } from "../db/schema";
import { FinancialSettingsService } from "../financial/financial-settings.service";
import { ScheduleEntryService } from "./schedule-entries/schedule-entry.service";

/** 0 = Saturday, matching the Tunisian school week used throughout scheduling. */
const DAY_NAMES = ["Samedi", "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

/** One session as it appears in a cell of the grid. */
interface Session {
  day: number;
  start: string;
  end: string;
  group: string;
  professor: string;
  classroom: string | null;
  field: string | null;
  color: string | null;
}

/**
 * The printable weekly timetable for one student.
 *
 * Built from the student's *enrolments*, not from a single group, so the same
 * document serves a student in one group and a student in four — the case that
 * previously had no answer at all, since the only timetable view was per group
 * and a multi-group student had to be pieced together by hand.
 *
 * Rendered server-side as a self-contained print document for the same reason
 * the quittances and attendance registers are: the browser's own print dialogue
 * (with "Save as PDF" on every modern machine) turns this into paper or a file
 * exactly as the CSS lays it out, so there is no second rendering pipeline that
 * can disagree with the screen.
 */
@Injectable()
export class StudentTimetablePrintService {
  constructor(
    private readonly db: DbService,
    private readonly entries: ScheduleEntryService,
    private readonly settings: FinancialSettingsService,
  ) {}

  async render(studentId: string): Promise<string> {
    const student = await this.db.client.query.students.findFirst({
      where: eq(students.id, studentId),
      columns: { id: true, first_name: true, last_name: true },
      with: {
        assignments: {
          with: {
            group: {
              columns: { id: true, name: true },
              with: {
                professor: {
                  columns: { id: true, full_name: true },
                  with: { field: { columns: { id: true, name: true }, with: { level: { columns: { name: true } } } } },
                },
              },
            },
          },
        },
      },
    });
    if (!student) throw new NotFoundException(`Étudiant ${studentId} introuvable`);

    const settings = await this.settings.get();

    // A recurring weekly pattern only needs one week of expansion; the range is
    // wide enough to pick up rules that start later this term.
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 180 * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.entries.getStudentSchedule(studentId, from, to);

    const seen = new Set<string>();
    const sessions: Session[] = [];
    for (const row of rows as any[]) {
      const slot = row.timeSlot ?? row.time_slot;
      if (!slot) continue;
      const start = String(slot.start_time).slice(0, 5);
      const end = String(slot.end_time).slice(0, 5);
      // One rule can be returned once per matching enrolment; the grid wants
      // one cell per actual session.
      const key = `${slot.day_of_week}|${start}|${end}|${row.group?.id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sessions.push({
        day: slot.day_of_week,
        start,
        end,
        group: row.group?.name ?? "—",
        professor: row.professor?.full_name ?? row.group?.professor?.full_name ?? "—",
        classroom: row.classroom?.name
          ? row.classroom.room_number
            ? `${row.classroom.name} · ${row.classroom.room_number}`
            : row.classroom.name
          : null,
        field: row.group?.professor?.field?.name ?? null,
        color: row.group?.color ?? row.group?.professor?.field?.color ?? null,
      });
    }

    const groups = student.assignments
      .map((a) => a.group)
      .filter((g): g is NonNullable<typeof g> => Boolean(g));

    return this.document({
      academy: settings.academy_name || "School Management System",
      studentName: `${student.first_name} ${student.last_name}`,
      level: groups[0]?.professor?.field?.level?.name ?? null,
      groups: groups.map((g) => ({
        name: g.name,
        professor: g.professor?.full_name ?? "—",
        field: g.professor?.field?.name ?? null,
      })),
      sessions,
      generatedAt: new Date(),
    });
  }

  // ---------------------------------------------------------------------------

  private document(data: {
    academy: string;
    studentName: string;
    level: string | null;
    groups: { name: string; professor: string; field: string | null }[];
    sessions: Session[];
    generatedAt: Date;
  }): string {
    const e = (v: string) => this.escape(v);

    /**
     * Every day of the week is a column, whether or not it holds a class.
     *
     * Only the occupied days used to be printed, which saved paper but made the
     * document lie about the shape of the week: a student free on Wednesday saw
     * Tuesday and Thursday side by side, and no way to tell whether Wednesday
     * was empty or simply not taught. A timetable is read as much for the gaps
     * as for the sessions, so the gaps are printed too.
     */
    const days = DAY_NAMES.map((_, index) => index);

    // Rows are the distinct time windows, so sessions that share a start line
    // up across the week the way a paper timetable does.
    const windows = [...new Set(data.sessions.map((s) => `${s.start}-${s.end}`))].sort();

    /**
     * Every session in a cell, not just the first.
     *
     * `find` returned one, so a student enrolled in two groups that meet at the
     * same hour on the same day had one of them silently dropped from their own
     * timetable — the multi-group case this document exists to serve.
     */
    const cellsFor = (day: number, window: string) =>
      data.sessions.filter((s) => s.day === day && `${s.start}-${s.end}` === window);

    const grid =
      data.sessions.length === 0
        ? `<p class="empty">Aucune séance programmée pour cet étudiant.</p>`
        : `<table class="grid">
            <thead>
              <tr>
                <th class="time-col">Horaire</th>
                ${days.map((d) => `<th>${e(DAY_NAMES[d] ?? `Jour ${d}`)}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${windows
                .map(
                  (w) => `<tr>
                    <td class="time-col">${e(w.replace("-", " – "))}</td>
                    ${days
                      .map((d) => {
                        const cells = cellsFor(d, w);
                        if (cells.length === 0) return `<td class="empty-cell"></td>`;
                        return `<td class="session">${cells
                          .map((s) => {
                            const accent = s.color ? ` style="border-top:3px solid ${e(s.color)}"` : "";
                            return `<div class="entry"${accent}>
                              <span class="group">${e(s.group)}</span>
                              ${s.field ? `<span class="field">${e(s.field)}</span>` : ""}
                              <span class="meta">${e(s.professor)}</span>
                              ${s.classroom ? `<span class="room">${e(s.classroom)}</span>` : ""}
                            </div>`;
                          })
                          .join("")}</td>`;
                      })
                      .join("")}
                  </tr>`,
                )
                .join("")}
            </tbody>
          </table>`;

    // The enrolments as cards rather than a bulleted list: a bullet forces a
    // left margin, which is the one thing a centred block cannot have.
    const enrolments = data.groups
      .map(
        (g) => `<div class="enrolment">
          <span class="enrolment-group">${e(g.name)}</span>
          ${g.field ? `<span class="enrolment-field">${e(g.field)}</span>` : ""}
          <span class="enrolment-prof">${e(g.professor)}</span>
        </div>`,
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Emploi du temps — ${e(data.studentName)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 3px solid #264EAE; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { font-size: 13px; font-weight: 700; color: #264EAE; letter-spacing: .04em; text-transform: uppercase; }
  h1 { font-size: 19px; margin: 4px 0 0; }
  .sub { font-size: 11px; color: #555; margin-top: 2px; }
  .generated { font-size: 10px; color: #777; text-align: right; }

  /* Enrolments: centred cards, so group / field / professor read as one block
     rather than as a left-hugging list beside a full-width table. */
  .enrolments { background: #DCEEFF; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px;
                text-align: center; }
  .enrolments h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
                   color: #264EAE; margin: 0 0 6px; }
  .enrolment-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 10px; }
  .enrolment { background: #fff; border: 1px solid #B9CDEA; border-radius: 5px;
               padding: 4px 10px; text-align: center; min-width: 110px; }
  .enrolment-group { display: block; font-size: 11px; font-weight: 700; color: #1a1a1a; }
  .enrolment-field { display: block; font-size: 9.5px; font-weight: 600; color: #264EAE; }
  .enrolment-prof  { display: block; font-size: 9.5px; color: #555; }

  /* Seven day columns plus the time gutter, so the cells are narrow: the
     content is centred and the type scaled to match. */
  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.grid th, table.grid td { border: 1px solid #B9CDEA; padding: 5px 4px;
                                 vertical-align: middle; text-align: center; }
  table.grid th { background: #264EAE; color: #fff; font-size: 10.5px; text-transform: uppercase;
                  letter-spacing: .03em; padding: 7px 4px; }
  .time-col { width: 84px; background: #F8E8A5; font-size: 10.5px; font-weight: 700;
              text-align: center; vertical-align: middle; white-space: nowrap; }
  thead .time-col { background: #264EAE; color: #fff; }
  td.session { background: #fff; }
  td.empty-cell { background: #FAFBFD; }
  /* One block per session, so a cell holding two groups keeps them apart. */
  .entry { padding: 2px 0; }
  .entry + .entry { margin-top: 4px; border-top: 1px dashed #B9CDEA; padding-top: 4px; }
  .group { display: block; font-size: 10.5px; font-weight: 700; line-height: 1.25; }
  .field { display: block; font-size: 9.5px; font-weight: 600; color: #264EAE; line-height: 1.25; }
  .meta  { display: block; font-size: 9.5px; color: #555; line-height: 1.25; }
  .room  { display: inline-block; margin-top: 3px; font-size: 9px; font-weight: 600;
           color: #264EAE; background: #DCEEFF; border-radius: 3px; padding: 1px 5px; }
  .empty { font-size: 12px; color: #777; padding: 30px; text-align: center;
           border: 1px dashed #B9CDEA; border-radius: 6px; }

  footer { margin-top: 14px; font-size: 9.5px; color: #888; text-align: center; }
  /* Never split a row across pages — a half-printed session is unreadable. */
  tr { page-break-inside: avoid; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <header>
    <div>
      <div class="brand">${e(data.academy)}</div>
      <h1>Emploi du temps — ${e(data.studentName)}</h1>
      <div class="sub">${data.level ? e(data.level) + " · " : ""}${data.groups.length} groupe${data.groups.length > 1 ? "s" : ""}</div>
    </div>
    <div class="generated">Établi le<br />${data.generatedAt.toLocaleDateString("fr-FR")}</div>
  </header>

  ${data.groups.length > 0 ? `<section class="enrolments"><h2>Inscriptions</h2><div class="enrolment-list">${enrolments}</div></section>` : ""}

  ${grid}

  <footer>${e(data.academy)} · Emploi du temps de ${e(data.studentName)}</footer>

  <script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 150); });</script>
</body>
</html>`;
  }

  private escape(value: string): string {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
