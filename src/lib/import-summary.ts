// /data-import presentation derivations — pure, dependency-free, unit-tested.
//
// These functions decide what the import workspace SAYS about data that has
// already been processed elsewhere. They never process, match, validate or
// write anything: processRows (import-processing.ts) owns the row semantics and
// the route owns the writes.
//
// Two truthfulness rules govern this file:
//   1. No fabricated quality signal. There is no score, no success percentage,
//      no "data freshness", no guessed month, team, match or KPI profile. Every
//      number is a count of rows that exist in the processed array.
//   2. An outcome is never described better than it was. A partial or failed
//      import can never render success wording — the wording is derived from
//      the stored ImportHistoryEntry status, not chosen by the screen.

import type { ImportHistoryEntry } from "@/lib/import-store";
import type { ProcessedRow } from "@/lib/import-processing";

// -------------------------------------------- preview / matching exceptions

/**
 * The band's label for rows that are a matching exception AND still parked on
 * skip. Deliberately NOT "דורש החלטה": ProcessedRow carries a single `action`
 * field, so a row parked on skip by processRows and a row a person explicitly
 * chose to skip are indistinguishable. Claiming the latter still "requires a
 * decision" would assert knowledge the application does not have — the honest
 * statement is what the data actually says: it is a matching exception, and it
 * is currently set to be skipped.
 */
export const MATCH_EXCEPTIONS_SKIPPED_LABEL = "חריגי התאמה בדילוג";

export type ImportPreviewSummary = {
  total: number;
  /** Rows resolved to each action — the four are mutually exclusive. */
  update: number;
  reactivate: number;
  create: number;
  skip: number;
  /** Rows carrying at least one error-severity issue (they will be skipped). */
  errorRows: number;
  /** Total warning-severity issues across all rows (not rows). */
  warnings: number;
  /**
   * Matching exceptions — a match to a deactivated representative, or an
   * importable row with no match at all — that are ALSO still set to skip, so
   * confirming now would drop them. The count falls as each one is resolved to
   * reactivate/create/update; an error row is never counted, because it needs
   * a file fix rather than a choice.
   *
   * This does NOT claim the row is unresolved: see
   * MATCH_EXCEPTIONS_SKIPPED_LABEL for why the wording stops at what the model
   * can prove.
   */
  matchExceptionsSkipped: number;
  matchedInactive: number;
  unmatched: number;
};

/** A matching exception that is still set to be skipped. */
function isSkippedMatchException(r: ProcessedRow): boolean {
  if (r.issues.some((i) => i.severity === "error")) return false;
  if (r.action !== "skip") return false;
  if (r.matchedInactive) return true;
  return !r.matchRepId && !!r.name;
}

export function summarizeProcessedRows(processed: ProcessedRow[]): ImportPreviewSummary {
  let update = 0;
  let reactivate = 0;
  let create = 0;
  let skip = 0;
  let errorRows = 0;
  let warnings = 0;
  let matchExceptionsSkipped = 0;
  let matchedInactive = 0;
  let unmatched = 0;
  for (const r of processed) {
    if (r.action === "update") update += 1;
    else if (r.action === "reactivate") reactivate += 1;
    else if (r.action === "create") create += 1;
    else skip += 1;
    if (r.issues.some((i) => i.severity === "error")) errorRows += 1;
    warnings += r.issues.filter((i) => i.severity === "warning").length;
    if (isSkippedMatchException(r)) matchExceptionsSkipped += 1;
    if (r.matchedInactive) matchedInactive += 1;
    if (!r.matchRepId && !!r.name && !r.issues.some((i) => i.severity === "error")) unmatched += 1;
  }
  return {
    total: processed.length,
    update,
    reactivate,
    create,
    skip,
    errorRows,
    warnings,
    matchExceptionsSkipped,
    matchedInactive,
    unmatched,
  };
}

// ------------------------------------------------------- confirmation view

/**
 * The four action populations, counted EXPLICITLY.
 *
 * The confirmation step used to derive skip as
 * `processed.length - update - create`, which silently folded reactivations
 * into the skip figure — so a row that was about to be reactivated was
 * announced as one that would be dropped. Each bucket is now counted from the
 * row's own action, and `total` is asserted to be their sum.
 */
export type ImportActionCounts = {
  update: number;
  reactivate: number;
  create: number;
  skip: number;
  total: number;
};

export function countImportActions(processed: ProcessedRow[]): ImportActionCounts {
  const update = processed.filter((p) => p.action === "update").length;
  const reactivate = processed.filter((p) => p.action === "reactivate").length;
  const create = processed.filter((p) => p.action === "create").length;
  const skip = processed.filter((p) => p.action === "skip").length;
  return { update, reactivate, create, skip, total: processed.length };
}

/**
 * Whether confirming would actually write anything.
 *
 * A reactivation IS an importable action — it reactivates the existing
 * representative and writes its metrics (see applyImport) — so a file whose
 * rows are all explicit reactivations must be confirmable. A file of nothing
 * but skips and errors still must not be.
 */
export function hasImportableRows(counts: ImportActionCounts): boolean {
  return counts.update + counts.reactivate + counts.create > 0;
}

// ---------------------------------------------------------------- outcomes

/**
 * What gets STORED for a finished import — the status and the error count that
 * the summary panel and the history list then read forever.
 *
 * The defect this replaces: an opted-in official-target write that failed
 * incremented only `targetsFailed`, which the status expression never
 * consulted. So core writes succeeding + a failed goal write stored
 * `status: "success"` with `errors: 0`, while the toast fired at the same
 * moment said "הייבוא הושלם עם שגיאות שמירה". A target write is a real write
 * of the user's data; failing it is a partial import, and its failures belong
 * in the stored error count.
 *
 * Unchanged: "failed" still means the CORE cloud writes failed and nothing
 * landed. `targetsSkippedNoTeam` is deliberately absent — a representative
 * with no team simply cannot receive an official target this way. That is a
 * documented skip, not a failure, and it must never colour the status.
 */
export type StoredImportOutcome = {
  status: ImportHistoryEntry["status"];
  errors: number;
};

export function deriveStoredImportOutcome(params: {
  /** Core representative/performance writes that threw. */
  cloudFailed: number;
  updated: number;
  created: number;
  /** Row-level errors already tallied (validation + renewal write failures). */
  errs: number;
  /** Representative goals that could not be written for an opted-in import. */
  targetsFailed: number;
}): StoredImportOutcome {
  const { cloudFailed, updated, created, errs, targetsFailed } = params;
  const status: ImportHistoryEntry["status"] =
    cloudFailed > 0
      ? updated + created === 0
        ? "failed"
        : "partial"
      : errs > 0 || targetsFailed > 0
        ? "partial"
        : "success";
  // targetsFailed is tracked separately from errs and is never added to it
  // during the run, so this addition cannot double-count.
  return { status, errors: errs + targetsFailed };
}

export type ImportOutcomeTone = "success" | "warning" | "danger";

export type ImportOutcomeView = {
  status: ImportHistoryEntry["status"];
  tone: ImportOutcomeTone;
  title: string;
  description: string;
};

/**
 * The summary/history wording for a finished import, derived ONLY from the
 * stored status. "הושלם בהצלחה" is reachable from status === "success" and from
 * nowhere else — a partial or failed run says so plainly, and points at the
 * error report instead of at the dashboard.
 */
export function importOutcomeView(status: ImportHistoryEntry["status"]): ImportOutcomeView {
  if (status === "success") {
    return {
      status,
      tone: "success",
      title: "הייבוא הושלם בהצלחה",
      description: "הדשבורד, טבלת הביצועים והתובנות עודכנו בהתאם.",
    };
  }
  if (status === "partial") {
    return {
      status,
      tone: "warning",
      title: "הייבוא הושלם חלקית",
      description:
        "חלק מהשורות לא נשמרו. השורות שנשמרו עודכנו במערכת — יש לעבור על דוח השגיאות ולטפל בשורות שנכשלו.",
    };
  }
  return {
    status,
    tone: "danger",
    title: "הייבוא נכשל",
    description: "לא נשמרה אף שורה. יש לעיין בדוח השגיאות ולנסות שוב לאחר תיקון הקובץ.",
  };
}

/** The short status label used in the history list and its detail dialog. */
export function importStatusLabel(status: ImportHistoryEntry["status"]): string {
  return status === "success" ? "הושלם" : status === "partial" ? "חלקי" : "נכשל";
}

// ------------------------------------------------------------ confirm view

export type ImportTargetPlan =
  | { willWrite: false; reason: "off" }
  | { willWrite: false; reason: "month_missing" }
  | { willWrite: true; month: string };

/**
 * What the confirmation step may promise about OFFICIAL targets.
 *
 * Mapping a target column never implies a target write: the opt-in must be on
 * AND an explicit month chosen. There is no fallback month — "now" is never
 * assumed on the user's behalf.
 */
export function importTargetPlan(params: {
  applyTargetsFromImport: boolean;
  importTargetMonth: string;
}): ImportTargetPlan {
  if (!params.applyTargetsFromImport) return { willWrite: false, reason: "off" };
  if (!params.importTargetMonth) return { willWrite: false, reason: "month_missing" };
  return { willWrite: true, month: params.importTargetMonth };
}
