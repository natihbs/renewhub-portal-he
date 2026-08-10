// Import-preview filtering/search/pagination — pure, dependency-free,
// unit-tested. The preview table used to hard-cap at the first 20 rows, so an
// error, an inactive match or an unmatched representative on row 21+ was
// invisible before confirmation. These helpers classify the ALREADY-processed
// rows for display only: nothing here re-derives, re-matches or re-validates
// anything — ProcessedRow semantics, actions and the confirm/apply pipeline
// are untouched, and every row keeps its ORIGINAL row.index so actions target
// the right row no matter how the table is filtered or paged.

export type ImportPreviewIssueLike = { severity: "error" | "warning"; message: string };

/** The structural slice of ProcessedRow the preview classification needs. */
export type ImportPreviewRowLike = {
  index: number;
  name: string;
  teamId: string | null;
  teamName: string | null;
  teamRaw: string;
  matchRepId: string | null;
  matchedInactive: boolean;
  renewalFieldsSkipped: boolean;
  issues: ImportPreviewIssueLike[];
  action: string;
};

export type ImportPreviewFilter =
  | "all"
  | "errors"
  | "warnings"
  | "decisions"
  | "inactive"
  | "unmatched"
  | "unknown_team"
  | "renewals_skipped";

export const IMPORT_PREVIEW_FILTER_LABEL: Record<ImportPreviewFilter, string> = {
  all: "הכול",
  errors: "שגיאות",
  warnings: "אזהרות",
  decisions: "דורש החלטה",
  inactive: "נציגים מושבתים",
  unmatched: "ללא התאמה",
  unknown_team: "צוות לא מזוהה",
  renewals_skipped: "חידושים לא יישמרו",
};

/** Chip render order — הכול first, most actionable next. */
export const IMPORT_PREVIEW_FILTERS: ImportPreviewFilter[] = [
  "all",
  "decisions",
  "errors",
  "warnings",
  "inactive",
  "unmatched",
  "unknown_team",
  "renewals_skipped",
];

export const IMPORT_PREVIEW_PAGE_SIZES = [25, 50, 100] as const;
export const IMPORT_PREVIEW_DEFAULT_PAGE_SIZE = 25;

export const IMPORT_PREVIEW_DISPLAY_FILTER_NOTE =
  "זהו סינון תצוגה בלבד. האישור יתייחס לכל השורות לפי הפעולה שהוגדרה לכל שורה.";
export const IMPORT_CONFIRM_INCLUDES_HIDDEN_NOTE =
  "האישור כולל גם שורות שלא הוצגו בסינון התצוגה המקדימה.";

export type ImportPreviewRowClass = {
  hasError: boolean;
  /** Warning without a blocking error — an errored row counts as an error, not a plain warning. */
  hasWarning: boolean;
  inactive: boolean;
  /** No match, has a name, and importable (no blocking error). */
  unmatched: boolean;
  unknownTeam: boolean;
  renewalsSkipped: boolean;
  /**
   * The manager must actively decide: a matched-but-deactivated row, or an
   * importable unmatched row currently parked on "skip" (it will silently be
   * dropped unless they choose create/manual-match).
   */
  decision: boolean;
};

export function classifyImportPreviewRow(row: ImportPreviewRowLike): ImportPreviewRowClass {
  const hasError = row.issues.some((i) => i.severity === "error");
  const hasWarning = !hasError && row.issues.some((i) => i.severity === "warning");
  const inactive = row.matchedInactive;
  const unmatched = !row.matchRepId && !!row.name && !hasError;
  const unknownTeam = !row.teamId && !!row.teamRaw;
  const renewalsSkipped = row.renewalFieldsSkipped;
  const decision = inactive || (unmatched && row.action === "skip");
  return { hasError, hasWarning, inactive, unmatched, unknownTeam, renewalsSkipped, decision };
}

export function matchesImportPreviewFilter(
  row: ImportPreviewRowLike,
  filter: ImportPreviewFilter,
): boolean {
  if (filter === "all") return true;
  const c = classifyImportPreviewRow(row);
  switch (filter) {
    case "errors":
      return c.hasError;
    case "warnings":
      return c.hasWarning;
    case "decisions":
      return c.decision;
    case "inactive":
      return c.inactive;
    case "unmatched":
      return c.unmatched;
    case "unknown_team":
      return c.unknownTeam;
    case "renewals_skipped":
      return c.renewalsSkipped;
  }
}

export function getImportPreviewFilterCounts(
  rows: ImportPreviewRowLike[],
): Record<ImportPreviewFilter, number> {
  const counts: Record<ImportPreviewFilter, number> = {
    all: rows.length,
    errors: 0,
    warnings: 0,
    decisions: 0,
    inactive: 0,
    unmatched: 0,
    unknown_team: 0,
    renewals_skipped: 0,
  };
  for (const row of rows) {
    const c = classifyImportPreviewRow(row);
    if (c.hasError) counts.errors++;
    if (c.hasWarning) counts.warnings++;
    if (c.decision) counts.decisions++;
    if (c.inactive) counts.inactive++;
    if (c.unmatched) counts.unmatched++;
    if (c.unknownTeam) counts.unknown_team++;
    if (c.renewalsSkipped) counts.renewals_skipped++;
  }
  return counts;
}

/** Decisions beat errors beat everything — the manager's attention goes where an action is owed. */
export function pickDefaultImportPreviewFilter(rows: ImportPreviewRowLike[]): ImportPreviewFilter {
  const counts = getImportPreviewFilterCounts(rows);
  if (counts.decisions > 0) return "decisions";
  if (counts.errors > 0) return "errors";
  return "all";
}

/**
 * Filter + search, in that order, BEFORE pagination. Search matches the
 * representative name, the resolved team name, the raw team text, and the
 * matched representative's name (when a name lookup is provided). Rows come
 * back as the SAME objects — original row.index preserved.
 */
export function filterImportPreviewRows<T extends ImportPreviewRowLike>(
  rows: T[],
  filter: ImportPreviewFilter,
  search: string,
  matchNames?: Map<string, string>,
): T[] {
  const q = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (!matchesImportPreviewFilter(row, filter)) return false;
    if (!q) return true;
    const matchedName = row.matchRepId ? (matchNames?.get(row.matchRepId) ?? "") : "";
    const hay = `${row.name} ${row.teamName ?? ""} ${row.teamRaw} ${matchedName}`.toLowerCase();
    return hay.includes(q);
  });
}

export type ImportPreviewPage<T> = {
  pageRows: T[];
  /** Clamped into [1, totalPages] — a shrinking filter can never strand the table on an empty page. */
  page: number;
  totalPages: number;
  /** 1-based inclusive display bounds; 0–0 when there are no rows. */
  from: number;
  to: number;
  total: number;
};

export function paginateImportPreviewRows<T>(
  rows: T[],
  page: number,
  pageSize: number,
): ImportPreviewPage<T> {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const start = (clamped - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  return {
    pageRows,
    page: clamped,
    totalPages,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + pageRows.length,
    total,
  };
}
