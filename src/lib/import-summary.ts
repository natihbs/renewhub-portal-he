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

// ------------------------------------------------------ preview / decisions

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
   * Rows that are STILL waiting on a person: a match to a deactivated
   * representative, or an importable row with no match at all, that is also
   * still parked on "skip". Both default to being skipped, so leaving them
   * alone silently drops data — and the count falls as each one is resolved.
   * A row whose action was already chosen (reactivate / create / update) is
   * decided and no longer counted; an error row cannot be decided at all,
   * only fixed in the file.
   */
  decisionsRequired: number;
  matchedInactive: number;
  unmatched: number;
};

/** Rows whose only sensible next step is a person deciding what to do. */
function needsDecision(r: ProcessedRow): boolean {
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
  let decisionsRequired = 0;
  let matchedInactive = 0;
  let unmatched = 0;
  for (const r of processed) {
    if (r.action === "update") update += 1;
    else if (r.action === "reactivate") reactivate += 1;
    else if (r.action === "create") create += 1;
    else skip += 1;
    if (r.issues.some((i) => i.severity === "error")) errorRows += 1;
    warnings += r.issues.filter((i) => i.severity === "warning").length;
    if (needsDecision(r)) decisionsRequired += 1;
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
    decisionsRequired,
    matchedInactive,
    unmatched,
  };
}

// ---------------------------------------------------------------- outcomes

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
