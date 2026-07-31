"use client";

import { useRef, useState, useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Eye,
} from "lucide-react";
import { importsApi, type ImportResult, type ParsedRow, type PreviewResult, type ImportRowError } from "@/lib/api/imports.api";
import { cn } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

const COLUMNS = [
  "field",
  "professor",
  "professorPhone",
  "level",
  "group",
  "firstName",
  "lastName",
  "phone",
  "parentPhone",
  "email",
  "enrollmentDate",
  "monthlyFee",
  "status",
] as const;

type ColumnKey = (typeof COLUMNS)[number];

const REQUIRED_COLUMNS: ColumnKey[] = [
  "field",
  "professor",
  "level",
  "group",
  "firstName",
  "lastName",
  "phone",
  "enrollmentDate",
  "monthlyFee",
];

const OPTIONAL_COLUMNS: ColumnKey[] = [
  "professorPhone",
  "parentPhone",
  "email",
  "status",
];

type Step = "upload" | "preview" | "result";

export default function ImportPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [errors, setErrors] = useState<ImportRowError[]>([]);
  const [missingColumns, setMissingColumns] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ row: number; col: ColumnKey } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const templateMutation = useMutation({
    mutationFn: () => importsApi.downloadTemplate(),
    onError: () => setPageError(t("import.templateDownloadError")),
  });

  const previewMutation = useMutation({
    mutationFn: (selected: File) => importsApi.previewStudents(selected),
    onSuccess: (data: PreviewResult) => {
      setRows(data.rows);
      setErrors(data.errors);
      setMissingColumns(data.missingColumns ?? []);
      setSelectedRows(new Set());
      setPageError(null);
      setStep("preview");
    },
    onError: (err: any) => {
      setPageError(
        err?.response?.data?.error?.message ??
          t("import.importFailed"),
      );
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (editedRows: ParsedRow[]) => importsApi.confirmImport(editedRows),
    onSuccess: (data: ImportResult) => {
      setResult(data);
      setPageError(null);
      setStep("result");
      setRows([]);
      setErrors([]);
      setSelectedRows(new Set());
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      queryClient.invalidateQueries();
    },
    onError: (err: any) => {
      setPageError(
        err?.response?.data?.error?.message ??
          t("import.importFailed"),
      );
    },
  });

  const selectFile = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".xlsx")) {
      setPageError(t("import.invalidFileType"));
      return;
    }
    setPageError(null);
    setResult(null);
    setFile(candidate);
  };

  const handleUpload = () => {
    if (file) previewMutation.mutate(file);
  };

  const getErrorForCell = useCallback(
    (rowNumber: number) => {
      const err = errors.find((e) => e.row === rowNumber);
      return err?.message ?? null;
    },
    [errors],
  );

  const startEdit = (rowIndex: number, col: ColumnKey, currentValue: string) => {
    setEditingCell({ row: rowIndex, col });
    setEditValue(currentValue ?? "");
  };

  const saveEdit = () => {
    if (!editingCell) return;
    setRows((prev) => {
      const next = [...prev];
      const row = { ...next[editingCell.row] };
      if (editingCell.col === "monthlyFee") {
        (row as any)[editingCell.col] = parseFloat(editValue) || 0;
      } else {
        (row as any)[editingCell.col] = editValue;
      }
      next[editingCell.row] = row;
      return next;
    });
    setEditingCell(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
  };

  const deleteRows = (indices: Set<number>) => {
    setRows((prev) => prev.filter((_, i) => !indices.has(i)));
    setSelectedRows(new Set());
  };

  const toggleRow = (index: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedRows.size === filteredRows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredRows.map((_, i) => i)));
    }
  };

  const filteredRows = useMemo(() => {
    if (!search) return rows.map((r, i) => ({ ...r, originalIndex: i }));
    const q = search.toLowerCase();
    return rows
      .map((r, i) => ({ ...r, originalIndex: i }))
      .filter((r) => {
        return (
          r.firstName.toLowerCase().includes(q) ||
          r.lastName.toLowerCase().includes(q) ||
          r.field.toLowerCase().includes(q) ||
          r.professor.toLowerCase().includes(q) ||
          r.group.toLowerCase().includes(q) ||
          r.level.toLowerCase().includes(q)
        );
      });
  }, [rows, search]);

  const hasErrors = errors.length > 0;

  return (
    <>
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-h2 font-bold text-text-primary">{t("import.title")}</h1>
          <p className="mt-1 text-small text-text-secondary">
            {t("import.description")}
          </p>
        </div>

        {step === "upload" && (
          <UploadStep
            t={t}
            file={file}
            dragging={dragging}
            inputRef={inputRef}
            setDragging={setDragging}
            selectFile={selectFile}
            setFile={setFile}
            handleUpload={handleUpload}
            templateMutation={templateMutation}
            previewMutation={previewMutation}
          />
        )}

        {step === "preview" && (
          <PreviewStep
            t={t}
            rows={rows}
            errors={errors}
            filteredRows={filteredRows}
            selectedRows={selectedRows}
            editingCell={editingCell}
            editValue={editValue}
            search={search}
            setSearch={setSearch}
            startEdit={startEdit}
            saveEdit={saveEdit}
            cancelEdit={cancelEdit}
            setEditValue={setEditValue}
            toggleRow={toggleRow}
            toggleAll={toggleAll}
            deleteRows={deleteRows}
              getErrorForCell={getErrorForCell}
              setStep={setStep}
              confirmMutation={confirmMutation}
              missingColumns={missingColumns}
            />
        )}

        {step === "result" && result && (
          <ImportSummary result={result} t={t} />
        )}

        {pageError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger-soft p-4"
          >
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger-strong" aria-hidden="true" />
            <p className="text-small text-danger-strong">{pageError}</p>
          </div>
        )}

        {step === "result" && (
          <button
            type="button"
            onClick={() => {
              setStep("upload");
              setResult(null);
            }}
            className="btn btn-secondary"
          >
            <Upload size={16} aria-hidden="true" />
            {t("import.importMore", "Import More")}
          </button>
        )}
      </div>
    </>
  );
}

function UploadStep({
  t,
  file,
  dragging,
  inputRef,
  setDragging,
  selectFile,
  setFile,
  handleUpload,
  templateMutation,
  previewMutation,
}: {
  t: (key: string, fallback?: string) => string;
  file: File | null;
  dragging: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  setDragging: (v: boolean) => void;
  selectFile: (f: File | undefined) => void;
  setFile: (f: File | null) => void;
  handleUpload: () => void;
  templateMutation: any;
  previewMutation: any;
}) {
  return (
    <>
      <section className="card">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-sky-100">
            <FileSpreadsheet size={20} className="text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-h4 font-bold text-text-primary">{t("import.step1")}</h2>
            <p className="mt-1 text-small text-text-secondary">
              {t("import.step1Desc")}
            </p>
            <button
              type="button"
              onClick={() => templateMutation.mutate()}
              disabled={templateMutation.isPending}
              className="btn btn-secondary mt-4 min-h-[44px]"
            >
              {templateMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Download size={16} aria-hidden="true" />
              )}
              {t("import.downloadTemplate")}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-sky-100">
            <Upload size={20} className="text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-h4 font-bold text-text-primary">{t("import.step2")}</h2>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                selectFile(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "mt-4 rounded-card border-2 border-dashed p-8 text-center transition-colors duration-150",
                dragging ? "border-primary bg-primary-50" : "border-border bg-background",
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx"
                className="sr-only"
                id="import-file"
                onChange={(e) => selectFile(e.target.files?.[0])}
              />

              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileSpreadsheet size={20} className="text-success" aria-hidden="true" />
                  <span className="text-small font-medium text-text-primary">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                    aria-label={t("import.removeSelectedFile")}
                    className="flex h-11 w-11 items-center justify-center rounded-btn text-text-secondary hover:bg-neutral-soft"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-small text-text-secondary">
                    {t("import.dragDropText")}
                  </p>
                  <label
                    htmlFor="import-file"
                    className="btn btn-secondary mt-3 inline-flex min-h-[44px] cursor-pointer"
                  >
                    {t("import.chooseFile")}
                  </label>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || previewMutation.isPending}
              className="btn btn-primary mt-4 min-h-[44px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  {t("import.previewing", "Previewing...")}
                </>
              ) : (
                <>
                  <Eye size={16} aria-hidden="true" />
                  {t("import.previewData", "Preview Data")}
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function PreviewStep({
  t,
  rows,
  errors,
  filteredRows,
  selectedRows,
  editingCell,
  editValue,
  search,
  setSearch,
  startEdit,
  saveEdit,
  cancelEdit,
  setEditValue,
  toggleRow,
  toggleAll,
  deleteRows,
  getErrorForCell,
   setStep,
   confirmMutation,
   missingColumns,
}: {
   t: (key: string, fallback?: string) => string;
   rows: ParsedRow[];
   errors: ImportRowError[];
   filteredRows: (ParsedRow & { originalIndex: number })[];
   selectedRows: Set<number>;
   editingCell: { row: number; col: ColumnKey } | null;
   editValue: string;
   search: string;
   setSearch: (v: string) => void;
   startEdit: (rowIndex: number, col: ColumnKey, currentValue: string) => void;
   saveEdit: () => void;
   cancelEdit: () => void;
   setEditValue: (v: string) => void;
   toggleRow: (index: number) => void;
   toggleAll: () => void;
   deleteRows: (indices: Set<number>) => void;
   getErrorForCell: (rowNumber: number) => string | null;
   setStep: (s: Step) => void;
   confirmMutation: any;
   missingColumns: string[];
}) {
  const hasError = (rowNumber: number) => !!getErrorForCell(rowNumber);
  const errorRows = useMemo(() => new Set(errors.map((e) => e.row)), [errors]);
  const hasMissingRequiredValues = useMemo(() => {
    if (missingColumns.length === 0) return false;
    return rows.some((row) =>
      missingColumns.some((col) => {
        const value = (row as any)[col];
        return value === "" || value === null || value === undefined;
      }),
    );
  }, [rows, missingColumns]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStep("upload")}
            className="btn btn-secondary text-xs"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            {t("import.back", "Back")}
          </button>
          <h2 className="text-h4 font-bold text-text-primary">
            {t("import.previewTitle", "Data Preview")}
            <span className="ml-2 text-small font-normal text-text-secondary">
              ({rows.length} {t("import.rows", "rows")})
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {selectedRows.size > 0 && (
            <button
              type="button"
              onClick={() => deleteRows(selectedRows)}
              className="btn btn-secondary text-xs text-danger"
            >
              <Trash2 size={14} aria-hidden="true" />
              {t("import.deleteSelected", "Delete")} ({selectedRows.size})
            </button>
          )}
          <button
            type="button"
            onClick={() => confirmMutation.mutate(rows)}
            disabled={confirmMutation.isPending || rows.length === 0 || hasMissingRequiredValues}
            className="btn btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 size={16} aria-hidden="true" />
            )}
            {t("import.confirmImport", "Confirm Import")} ({rows.length})
          </button>
          {hasMissingRequiredValues && (
            <p className="text-xs text-warning mt-2">
              {t("import.fillMissingValues", "Fill in all missing column values before importing")}
            </p>
          )}
        </div>
      </div>

      {missingColumns.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-card border border-warning/30 bg-warning-soft dark:bg-warning/10 p-4"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="text-small font-medium text-warning">
              {t("import.missingColumnsTitle", "Missing columns")}
            </p>
            <p className="text-caption text-text-secondary mt-1">
              {t("import.missingColumnsDesc", "Your file is missing the following required column(s). The cells are pre-filled as empty — fill them in before importing.")}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {missingColumns.map((col) => (
                <span key={col} className="text-xs bg-warning-soft dark:bg-warning/10 text-warning px-2 py-1 rounded">
                  {col}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasError(0) && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger-soft p-4"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger-strong" aria-hidden="true" />
          <div>
            <p className="text-small font-medium text-danger-strong">
              {errors.length} {t("import.rowsHaveErrors", "row(s) have validation errors")}
            </p>
            <p className="text-caption text-danger mt-1">
              {t("import.errorRowsNote", "Rows with errors will be skipped during import. Fix or delete them before importing.")}
            </p>
          </div>
        </div>
      )}

      <div className="card p-3">
        <input
          type="text"
          placeholder={t("import.searchRows", "Search by name, field, professor, group...")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full max-w-sm"
        />
      </div>

      <div className="overflow-hidden rounded-table border border-border shadow-card">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-background">
                <th className="px-3 py-3 text-left bg-neutral-soft">
                  <input
                    type="checkbox"
                    checked={selectedRows.size === filteredRows.length && filteredRows.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-border"
                  />
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft w-12">
                  #
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.field")}
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.professor")}
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.level")}
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.group")}
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.firstName")}
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.lastName")}
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.phone")}
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.enrollmentDate")}
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.monthlyFee")}
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase bg-neutral-soft">
                  {t("import.status")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRows.map((row) => {
                const isError = errorRows.has(row.rowNumber);
                return (
                  <tr
                    key={row.originalIndex}
                    className={cn(
                      "hover:bg-background/50 transition-colors",
                      isError && "bg-danger-soft/30",
                    )}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedRows.has(row.originalIndex)}
                        onChange={() => toggleRow(row.originalIndex)}
                        className="h-4 w-4 rounded border-border"
                      />
                    </td>
                    <td className="px-3 py-2 text-text-secondary font-medium text-xs">
                      {row.rowNumber}
                    </td>
                      {COLUMNS.map((col) => {
                        const value = (row as any)[col];
                        const isEditing =
                          editingCell?.row === row.originalIndex && editingCell?.col === col;
                        const isMissingColumn = missingColumns.includes(col);
                        const isMissingValue = isMissingColumn && (!value || value === "");
                        return (
                          <td
                            key={col}
                            className="px-3 py-1"
                            onDoubleClick={() =>
                              startEdit(row.originalIndex, col, String(value ?? ""))
                            }
                          >
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  autoFocus
                                  type={col === "monthlyFee" ? "number" : "text"}
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveEdit();
                                    if (e.key === "Escape") cancelEdit();
                                  }}
                                  onBlur={saveEdit}
                                  className={cn("input text-xs py-1 px-2 w-full min-w-[80px]", isMissingValue && "input-error")}
                                />
                              </div>
                            ) : (
                              <div
                                className={cn(
                                  "flex items-center gap-1 cursor-pointer rounded px-2 py-1 hover:bg-neutral-soft min-h-[32px] text-xs",
                                  isError && col === COLUMNS.find((c) => c === "firstName" || c === "lastName") && "font-medium text-danger-strong",
                                  isMissingValue && "font-medium text-warning",
                                )}
                              >
                                <span className="truncate">
                                  {col === "monthlyFee" && typeof value === "number"
                                    ? value.toFixed(2)
                                    : value ?? (isMissingColumn ? "—" : "—")}
                                </span>
                                <Edit3 size={10} className={cn("shrink-0 text-text-secondary", isMissingValue ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />
                              </div>
                            )}
                          </td>
                        );
                      })}
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="px-4 py-12 text-center text-text-secondary">
                    {t("import.noRows", "No rows found")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-caption text-text-secondary">
        {t("import.doubleClickToEdit", "Double-click a cell to edit. Press Enter to save, Escape to cancel.")}
      </div>

      {errors.length > 0 && (
        <div className="card">
          <h3 className="text-small font-bold text-text-primary mb-2">
            {t("import.validationErrors", "Validation Errors")}
          </h3>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {errors.map((err) => (
              <div key={err.row} className="flex items-center gap-2 text-xs">
                <span className="font-medium text-danger-strong">{t("import.row")} {err.row}:</span>
                <span className="text-text-secondary">{err.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ImportSummary({ result, t }: { result: ImportResult; t: (key: string, fallback?: string) => string }) {
  const { created } = result;
  const createdAny =
    created.fields + created.professors + created.levels + created.groups > 0;

  return (
    <section className="card" aria-live="polite">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-success-soft">
          <CheckCircle2 size={20} className="text-success-strong" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-h4 font-bold text-text-primary">{t("import.complete")}</h2>

          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label={t("import.studentsAdded")} value={result.imported} tone="success" />
            <Stat label={t("import.duplicatesSkipped")} value={result.skippedDuplicates} tone="muted" />
            <Stat label={t("import.rowsRejected")} value={result.failed} tone={result.failed > 0 ? "danger" : "muted"} />
          </dl>

          {createdAny && (
            <p className="mt-4 text-small text-text-secondary">
              {t("import.alsoCreated", `Also created: ${created.fields} field(s), ${created.professors} professor(s), ${created.levels} level(s), ${created.groups} group(s).`)}
            </p>
          )}

          {result.skippedDuplicates > 0 && (
            <p className="mt-2 text-small text-text-secondary">
              {t("import.duplicatesInfo", `Duplicates are students already in the same group with the same first and last name — re-importing the same file is safe.`)}
            </p>
          )}

          {result.errors.length > 0 && (
            <div className="mt-6">
              <h3 className="text-small font-bold text-text-primary">
                {t("import.rejectedRowsTitle")}
              </h3>
              <p className="mt-1 text-caption text-text-secondary">
                {t("import.rejectedRowsDesc")}
              </p>
              <div className="table-container mt-3 max-h-72 overflow-y-auto">
                <table className="w-full text-small">
                  <thead className="sticky top-0 bg-neutral-soft">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-text-secondary">
                        {t("import.row")}
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-text-secondary">
                        {t("import.problem")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((rowError) => (
                      <tr key={rowError.row} className="border-t border-border">
                        <td className="px-4 py-2 font-medium text-text-primary">{rowError.row}</td>
                        <td className="px-4 py-2 text-text-secondary">{rowError.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-success-strong"
      : tone === "danger"
        ? "text-danger-strong"
        : "text-text-primary";

  return (
    <div>
      <dd className={cn("text-h2 font-bold", toneClass)}>{value}</dd>
      <dt className="text-caption text-text-secondary">{label}</dt>
    </div>
  );
}
