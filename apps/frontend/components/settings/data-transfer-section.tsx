"use client";

import { useMemo, useRef, useState } from "react";
import { Database, Download, Upload, RefreshCw, Trash2, AlertTriangle, CheckCircle2, FileJson } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { useExportAll, useImportPreview, useDataImport, type ImportPreview, type FillValues } from "@/hooks/use-data-transfer";
import { cn } from "@/lib/utils/format";

const errorMessage = (err: unknown): string => {
  const axios = (err as any)?.response?.data;
  if (axios?.message) return Array.isArray(axios.message) ? axios.message.join(" ") : axios.message;
  return (err as Error)?.message ?? "Une erreur est survenue";
};

export default function DataTransferSection() {
  const { t } = useTranslation();
  const exportAll = useExportAll();
  const importPreview = useImportPreview();
  const dataImport = useDataImport();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [phrase, setPhrase] = useState("");
  const [pendingEnc, setPendingEnc] = useState<File | null>(null);
  const [fills, setFills] = useState<FillValues>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKeyword, setConfirmKeyword] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setPhrase("");
    setPendingEnc(null);
    setFills({});
    setIncluded({});
    setConfirmOpen(false);
    setConfirmKeyword("");
    setDone(null);
    setError(null);
  };

  const onFile = (next: File | null) => {
    if (!next) return;
    setError(null);
    setDone(null);
    importPreview.mutate(
      { file: next, phrase: phrase || undefined },
      {
        onSuccess: (result) => {
          setFile(next);
          setPreview(result);
          setPendingEnc(null);
        setFills({});
        setIncluded(Object.fromEntries(result.tables.map((table) => [table.table, true])));
      },
        onError: (err) => {
          setFile(null);
          setPreview(null);
          setError(errorMessage(err));
          // Encrypted Dropbox copy without its phrase yet: keep it for retry
          // once the phrase is typed below instead of asking for the file again.
          setPendingEnc(next.name.toLowerCase().endsWith(".enc") ? next : null);
        },
      },
    );
  };

  const blockers = useMemo(() => {
    if (!preview) return [];
    const list: string[] = [];
    for (const table of preview.tables) {
      if (!included[table.table] || table.rowCount === 0) continue;
      for (const column of table.missingRequired) {
        if (!(fills[table.table]?.[column.column] ?? "").trim()) {
          list.push(`${table.label} → ${column.column}`);
        }
      }
      for (const target of table.missingTargetTables) {
        list.push(`${table.label} → ${target.column} (réf. ${target.targetLabel})`);
      }
    }
    return list;
  }, [preview, fills, included]);

  const setFill = (table: string, column: string, value: string) => {
    setFills((prev) => ({ ...prev, [table]: { ...prev[table], [column]: value } }));
  };

  const toggleTable = (table: string) => {
    setIncluded((prev) => ({ ...prev, [table]: !(prev[table] !== false) }));
  };

  const runImport = () => {
    if (!file || !preview) return;
    setError(null);
    setDone(null);
    const payload: FillValues = {};
    for (const table of preview.tables) {
      if (included[table.table] !== false) {
        payload[table.table] = { ...(fills[table.table] ?? {}) };
      } else {
        payload[table.table] = { skip: "true" };
      }
    }
    dataImport.mutate(
      { file, fills: payload, phrase: phrase || undefined },
      {
        onSuccess: (result) => {
          setConfirmOpen(false);
          setConfirmKeyword("");
          setPhrase("");
          setDone(result.message);
        },
        onError: (err) => {
          setConfirmOpen(false);
          setConfirmKeyword("");
          setError(errorMessage(err));
        },
      },
    );
  };

  const hasMissing = (preview?.tables ?? []).some(
    (table) => included[table.table] !== false && table.missingRequired.length > 0,
  );

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
            <Database size={20} />
          </div>
          <div>
            <h3 className="text-h4 font-bold text-text-primary">{t("settings.dataTitle", "Données")}</h3>
            <p className="text-xs text-text-secondary">{t("settings.dataDescription", "Exporter ou importer l'intégralité des données du système")}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Export */}
          <div className="rounded-btn border border-border bg-background p-5">
            <div className="flex items-center gap-2 mb-2">
              <FileJson size={16} className="text-primary" />
              <h4 className="text-sm font-semibold text-text-primary">{t("settings.exportTitle", "Exporter les données")}</h4>
            </div>
            <p className="text-xs text-text-secondary mb-4">
              {t("settings.exportDesc", "Télécharge un fichier .json contenant toutes les tables (niveaux, filières, utilisateurs, groupes, étudiants, paiements, emplois du temps, tableaux blancs, paramètres…). Utilisable sur n'importe quelle version du système.")}
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setDone(null);
                exportAll.mutate(undefined, {
                  onSuccess: () => {
                    setDone(t("settings.exportDone", "Export téléchargé."));
                    setTimeout(() => setDone(null), 4000);
                  },
                  onError: (err) => setError(errorMessage(err)),
                });
              }}
              disabled={exportAll.isPending}
              className="btn btn-primary w-full text-xs min-h-[40px] disabled:opacity-50"
            >
              {exportAll.isPending ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {exportAll.isPending ? t("settings.exporting", "Export en cours…") : t("settings.exportButton", "Télécharger l'export")}
            </button>
          </div>

          {/* Import */}
          <div className="rounded-btn border border-border bg-background p-5">
            <div className="flex items-center gap-2 mb-2">
              <Upload size={16} className="text-primary" />
              <h4 className="text-sm font-semibold text-text-primary">{t("settings.importTitle", "Importer des données")}</h4>
            </div>
            <p className="text-xs text-text-secondary mb-4">
              {t("settings.importDesc", "Importe un fichier d'export, quelle que soit la version. Les tables présentes dans le fichier remplacent les données actuelles. Les colonnes absentes sont listées dans l'aperçu pour être remplies manuellement. Les copies chiffrées de Dropbox (fichiers .enc, une par sauvegarde) se restaurent ici aussi : déposez le fichier et saisissez la phrase de récupération.")}
            </p>
            {!preview ? (
              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  dragCounterRef.current += 1;
                  if (dragCounterRef.current === 1) setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  dragCounterRef.current -= 1;
                  if (dragCounterRef.current === 0) setIsDragging(false);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dragCounterRef.current = 0;
                  setIsDragging(false);
                  onFile(e.dataTransfer.files?.[0] ?? null);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={cn(
                  "group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-btn border-2 border-dashed p-6 text-center transition-all duration-200 outline-none",
                  isDragging
                    ? "border-primary bg-primary-50 dark:bg-primary/10"
                    : "border-border bg-background hover:border-primary/60 hover:bg-primary-50/50 dark:hover:bg-primary/5",
                  importPreview.isPending && "pointer-events-none opacity-70",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json,.enc"
                  className="hidden"
                  onChange={(e) => {
                    onFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <div className={cn("flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200", isDragging ? "bg-primary/15 text-primary scale-110" : "bg-neutral-soft text-text-secondary group-hover:text-primary group-hover:scale-105")}>
                  {importPreview.isPending ? <RefreshCw size={20} className="animate-spin" /> : <Upload size={20} aria-hidden="true" />}
                </div>
                <p className="text-sm font-semibold text-text-primary">{t("settings.importDropTitle", "Déposez un fichier .json ou .enc ici")}</p>
                <p className="text-xs text-text-secondary">{t("settings.importDropSubtitle", "ou cliquez pour parcourir — aperçu avant toute modification")}</p>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{preview.fileName}</p>
                  <p className="text-xs text-text-secondary truncate">
                    {t("settings.importFileMeta", "Version source")}: {preview.sourceVersion ?? "?"}
                    {preview.exportedAt ? ` · ${new Date(preview.exportedAt).toLocaleString()}` : ""}
                  </p>
                </div>
                <button type="button" onClick={reset} className="btn btn-secondary text-xs shrink-0">
                  <Trash2 size={12} />
                  {t("fields.cancel")}
                </button>
              </div>
            )}
            {(file?.name.toLowerCase().endsWith(".enc") || pendingEnc) && (
              <div className="mt-3 rounded-btn border border-border p-3">
                <label className="block text-[11px] font-medium text-text-secondary mb-1">
                  {t("settings.recoveryPhraseLabel", "Phrase de récupération (copie Dropbox chiffrée)")}
                </label>
                <input
                  type="password"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder={t("settings.recoveryPhrasePlaceholder", "Les 12 mots, dans l'ordre")}
                  autoComplete="off"
                  className="input w-full text-xs"
                />
                {pendingEnc && !preview && (
                  <button
                    type="button"
                    onClick={() => {
                      const retry = pendingEnc;
                      setPendingEnc(null);
                      onFile(retry);
                    }}
                    disabled={!phrase.trim() || importPreview.isPending}
                    className="btn btn-primary w-full text-xs min-h-[36px] mt-2 disabled:opacity-50"
                  >
                    {importPreview.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                    {t("settings.decryptPreview", "Déchiffrer et prévisualiser")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-input border border-danger/30 bg-danger-soft dark:bg-danger-dark-soft px-4 py-3 text-sm text-danger-strong dark:text-danger-dark-strong flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {done && (
          <div className="mt-4 rounded-input border border-success/30 bg-success-soft dark:bg-success-dark-soft px-4 py-3 text-sm text-success-strong dark:text-success-dark-strong flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{done}</span>
          </div>
        )}
      </div>

      {preview && (
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
              <Upload size={20} />
            </div>
            <div>
              <h3 className="text-h4 font-bold text-text-primary">{t("settings.previewTitle", "Aperçu de l'import")}</h3>
              <p className="text-xs text-text-secondary">
                {t("settings.importPreviewDesc", "Colonnes manquantes à remplir, tables à inclure, puis confirmation finale")}
              </p>
            </div>
          </div>

          {preview.ignoredTables.length > 0 && (
            <p className="mb-3 text-xs text-text-secondary">
              {t("settings.ignoredTables", "Tables ignorées (inconnues de cette version)")}: {preview.ignoredTables.join(", ")}
            </p>
          )}

          {preview.tables.length === 0 && (
            <p className="text-sm text-text-secondary">{t("settings.noKnownTables", "Aucune table connue dans ce fichier.")}</p>
          )}

          <div className="space-y-3">
            {preview.tables.map((table) => {
              const isIncluded = included[table.table] !== false;
              const needsFill = isIncluded && table.rowCount > 0 && table.missingRequired.length > 0;
              const blockedTargets = isIncluded && table.rowCount > 0 ? table.missingTargetTables : [];
              return (
                <div
                  key={table.table}
                  className={cn("rounded-btn border p-4", isIncluded ? "border-border bg-background" : "border-border/60 bg-neutral-soft/30 opacity-70")}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isIncluded}
                      onChange={() => toggleTable(table.table)}
                      className="h-4 w-4 accent-primary"
                      aria-label={`${t("settings.includeTable", "Inclure")} ${table.label}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-text-primary">{table.label}</p>
                        <span className="inline-flex items-center gap-1 rounded-full bg-neutral-soft px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                          {table.rowCount} {t("settings.rows", "ligne(s)")}
                        </span>
                        {needsFill && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft dark:bg-danger-dark-soft px-2 py-0.5 text-[10px] font-medium text-danger-strong dark:text-danger-dark-strong">
                            <AlertTriangle size={9} />
                            {table.missingRequired.length} {t("settings.missingColumns", "colonne(s) à remplir")}
                          </span>
                        )}
                        {isIncluded && table.rowCount > 0 && table.missingRequired.length === 0 && blockedTargets.length === 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft dark:bg-success-dark-soft px-2 py-0.5 text-[10px] font-medium text-success-strong dark:text-success-dark-strong">
                            <CheckCircle2 size={9} />
                            {t("settings.tableComplete", "Complet")}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-text-secondary truncate">{table.table}</p>
                    </div>
                  </div>

                  {isIncluded && (
                    <div className="mt-3 space-y-3">
                      {table.missingRequired.length > 0 && (
                        <div className="rounded-btn border border-danger/20 bg-danger-soft/50 dark:bg-danger-dark-soft/40 p-3 space-y-2">
                          <p className="text-[11px] font-semibold text-danger-strong dark:text-danger-dark-strong">
                            {t("settings.fillRequiredHint", "Ces colonnes manquent dans le fichier — une valeur sera appliquée à toutes les lignes :")}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {table.missingRequired.map((column) => (
                              <div key={column.column}>
                                <label className="block text-[11px] font-medium text-text-secondary mb-1">
                                  {column.column}
                                  <span className="text-text-secondary/60"> · {column.type}</span>
                                </label>
                                <input
                                  type="text"
                                  value={fills[table.table]?.[column.column] ?? ""}
                                  onChange={(e) => setFill(table.table, column.column, e.target.value)}
                                  placeholder={t("settings.fillPlaceholder", "Valeur obligatoire")}
                                  className={cn("input w-full text-xs", !(fills[table.table]?.[column.column] ?? "").trim() && "input-error")}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {table.missingOptional.length > 0 && (
                        <div className="rounded-btn border border-border p-3 space-y-2">
                          <p className="text-[11px] font-semibold text-text-secondary">
                            {t("settings.fillOptionalHint", "Colonnes facultatives manquantes — laissez vide pour utiliser la valeur par défaut :")}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {table.missingOptional.map((column) => (
                              <div key={column.column}>
                                <label className="block text-[11px] font-medium text-text-secondary mb-1">
                                  {column.column}
                                  <span className="text-text-secondary/60"> · {column.type}</span>
                                </label>
                                <input
                                  type="text"
                                  value={fills[table.table]?.[column.column] ?? ""}
                                  onChange={(e) => setFill(table.table, column.column, e.target.value)}
                                  placeholder={t("settings.fillOptionalPlaceholder", "Optionnel")}
                                  className="input w-full text-xs"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {blockedTargets.length > 0 && (
                        <p className="text-[11px] text-danger">
                          <AlertTriangle size={10} className="inline mr-1" />
                          {t("settings.blockedTargets", "Référence une table absente du fichier — import bloqué pour cette table")}: {blockedTargets.map((target) => `${target.column} (${target.targetLabel})`).join(", ")}
                        </p>
                      )}

                      {table.extraColumns.length > 0 && (
                        <p className="text-[11px] text-text-secondary/80">
                          {t("settings.extraColumns", "Colonnes ignorées (inconnues de cette version)")}: {table.extraColumns.join(", ")}
                        </p>
                      )}

                      {table.rowCount > 0 && table.columnsPresent.length > 0 && (
                        <div className="overflow-x-auto rounded-btn border border-border/70">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="bg-neutral-soft/50 text-text-secondary">
                                {table.columnsPresent.slice(0, 6).map((column) => (
                                  <th key={column} className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">{column}</th>
                                ))}
                                {table.columnsPresent.length > 6 && <th className="px-2.5 py-1.5 text-left font-medium">…</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {table.sampleRows.map((row, rowIndex) => (
                                <tr key={rowIndex} className="border-t border-border/60 text-text-secondary">
                                  {table.columnsPresent.slice(0, 6).map((column) => (
                                    <td key={column} className="px-2.5 py-1.5 whitespace-nowrap">{row[column] || "—"}</td>
                                  ))}
                                  {table.columnsPresent.length > 6 && <td className="px-2.5 py-1.5">…</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-xs text-text-secondary">
              {blockers.length > 0 ? (
                <span className="flex items-center gap-1.5 text-danger">
                  <AlertTriangle size={12} />
                  {t("settings.importBlocked", "À compléter avant l'import")}: {blockers.slice(0, 3).join(", ")}{blockers.length > 3 ? ` (+${blockers.length - 3})` : ""}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-text-secondary">
                  {t("settings.importWarning", "L'import remplace les données des tables incluses")}
                  {hasMissing ? " — colonnes facultatives laissées vides" : ""}
                </span>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={reset} className="btn btn-secondary text-xs min-h-[36px]">
                {t("fields.cancel")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={blockers.length > 0 || dataImport.isPending}
                className="btn btn-primary text-xs min-h-[36px] disabled:opacity-50"
              >
                {dataImport.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                {dataImport.isPending ? t("settings.importing", "Import en cours…") : t("settings.importButton", "Importer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmOpen(false)}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-md mx-4 border border-border" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold text-text-primary mb-4">{t("settings.importConfirmTitle", "Confirmer l'import")}</h3>
            <p className="text-sm text-text-secondary mb-4">
              {t("settings.importConfirmDesc", "Les données actuelles des tables incluses seront remplacées. Saisissez IMPORTER pour confirmer.")}
            </p>
            <input
              type="text"
              value={confirmKeyword}
              onChange={(e) => setConfirmKeyword(e.target.value)}
              placeholder="IMPORTER"
              className="input w-full mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="btn btn-secondary text-xs"
              >
                {t("fields.cancel")}
              </button>
              <button
                type="button"
                onClick={runImport}
                disabled={confirmKeyword !== "IMPORTER" || dataImport.isPending}
                className="btn btn-danger text-xs"
              >
                {dataImport.isPending ? t("settings.importing", "Import en cours…") : t("settings.importButton", "Importer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}