// Pulse v2 — ingestion domain. Pure, dependency-free, unit-tested.
//
// The rules the pipeline applies, stated where they can be tested without a
// database and where a caller can apply them before a round trip. The database
// remains authoritative — 20260809091000_v2_ingestion_rpcs.sql runs the same
// checks over the real staged set — and where the two could disagree the
// database wins.
//
// What lives here:
//   * the canonical row form the checksum is taken over
//   * row-level validation, matching the classify pass in SQL arm for arm
//   * the volume decision, including why it uses a median
//   * freshness classification
//   * the batch summary shape every later consumer reads
//
// What deliberately does NOT live here: the checksum itself. It is md5 in
// Postgres, and reimplementing it in TypeScript would create a second
// definition that can drift from the one that actually decides whether a batch
// is a duplicate. The canonical STRING is defined here and tested; hashing it
// is the database's job.

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * One row exactly as the source delivered it. Everything is a string because
 * staging holds untrusted text: a malformed date has to survive as far as
 * validation so it can be reported as a corrupted row naming its own value,
 * rather than aborting the load with a cast error naming nothing.
 */
export type RawWorkItemRow = {
  externalRef: string | null;
  subjectRef?: string | null;
  subjectLabel?: string | null;
  ownerExternalRef?: string | null;
  dueAtRaw?: string | null;
  eligibleFromRaw?: string | null;
  businessValueRaw?: string | null;
};

export type RowErrorCode =
  | "missing_external_ref"
  | "malformed_due_at"
  | "malformed_eligible_from"
  | "malformed_business_value"
  | "negative_business_value"
  | "unknown_owner"
  | "window_inverted";

export type RowVerdict =
  | { valid: true }
  | { valid: false; errorCode: RowErrorCode; detail: string | null };

const blank = (v: string | null | undefined): boolean =>
  v === null || v === undefined || v.trim() === "";

/** Null for absent, null for malformed — the caller distinguishes them by checking `blank` first. */
export function parseTimestamp(raw: string | null | undefined): Date | null {
  if (blank(raw)) return null;
  const d = new Date(raw!.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseAmount(raw: string | null | undefined): number | null {
  if (blank(raw)) return null;
  const trimmed = raw!.trim();
  // Deliberately strict. Number("") is 0 and Number(" 12 ") is 12, both of
  // which would let a malformed feed through as a plausible figure — the exact
  // shape of defect this program keeps removing.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * The row-level verdict, in the same precedence order as the SQL classify
 * pass. One error per row, chosen deliberately: a row missing its key reports
 * that even when its date is also malformed, because the missing key is what
 * an operator fixes first.
 *
 * `ownerResolves` is supplied by the caller rather than looked up here — the
 * roster is a database fact and this function is pure. A supplied owner
 * reference that does not resolve is an error; no owner at all is not, because
 * an unallocated item is a legitimate state.
 */
export function validateRow(row: RawWorkItemRow, ownerResolves: boolean): RowVerdict {
  if (blank(row.externalRef)) {
    return { valid: false, errorCode: "missing_external_ref", detail: null };
  }

  const dueGiven = !blank(row.dueAtRaw);
  const dueAt = parseTimestamp(row.dueAtRaw);
  if (dueGiven && dueAt === null) {
    return { valid: false, errorCode: "malformed_due_at", detail: row.dueAtRaw!.slice(0, 100) };
  }

  const eligibleGiven = !blank(row.eligibleFromRaw);
  const eligibleFrom = parseTimestamp(row.eligibleFromRaw);
  if (eligibleGiven && eligibleFrom === null) {
    return {
      valid: false,
      errorCode: "malformed_eligible_from",
      detail: row.eligibleFromRaw!.slice(0, 100),
    };
  }

  const valueGiven = !blank(row.businessValueRaw);
  const value = parseAmount(row.businessValueRaw);
  if (valueGiven && value === null) {
    return {
      valid: false,
      errorCode: "malformed_business_value",
      detail: row.businessValueRaw!.slice(0, 100),
    };
  }
  if (value !== null && value < 0) {
    return {
      valid: false,
      errorCode: "negative_business_value",
      detail: row.businessValueRaw!.slice(0, 100),
    };
  }

  if (!blank(row.ownerExternalRef) && !ownerResolves) {
    return {
      valid: false,
      errorCode: "unknown_owner",
      detail: row.ownerExternalRef!.slice(0, 100),
    };
  }

  if (dueAt !== null && eligibleFrom !== null && dueAt.getTime() < eligibleFrom.getTime()) {
    return { valid: false, errorCode: "window_inverted", detail: null };
  }

  return { valid: true };
}

/**
 * The canonical string the row checksum is taken over, matching the generated
 * column in 20260809090000 field for field and separator for separator.
 *
 * subject_label is excluded on purpose: a cosmetic rename upstream must not
 * make an otherwise identical delivery register as new content, or every
 * duplicate check would pass for the wrong reason.
 */
export function canonicalRowString(row: RawWorkItemRow): string {
  return [
    row.externalRef ?? "",
    row.subjectRef ?? "",
    row.ownerExternalRef ?? "",
    row.dueAtRaw ?? "",
    row.eligibleFromRaw ?? "",
    row.businessValueRaw ?? "",
  ].join("|");
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

/**
 * The trailing baseline, as a MEDIAN.
 *
 * Not a mean. One anomalous batch that did get published must not drag the
 * floor down far enough to admit the next bad one — which is exactly how a
 * feed degrades silently over a week rather than failing loudly on day one.
 * With a mean, a single 5% delivery drops the bar by roughly 15%; the median
 * moves by a fraction of a percent, and only because the count's parity
 * changed.
 */
export function trailingMedian(rowCounts: readonly number[]): number | null {
  if (rowCounts.length === 0) return null;
  const sorted = [...rowCounts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type VolumeDecision = {
  passed: boolean;
  rowCount: number;
  baseline: number | null;
  floor: number | null;
  thresholdPct: number;
  /** True when there is no history to compare against — the first batch for a source. */
  noBaseline: boolean;
};

/**
 * A batch below `thresholdPct` of the trailing median is rejected.
 *
 * The FIRST batch for a source has no baseline and is not blocked. There is
 * nothing to compare it against, and refusing to start is not a safer answer
 * than starting — it is just a pipeline that can never be bootstrapped.
 */
export function decideVolume(
  rowCount: number,
  trailingRowCounts: readonly number[],
  thresholdPct: number,
): VolumeDecision {
  const baseline = trailingMedian(trailingRowCounts);
  if (baseline === null) {
    return { passed: true, rowCount, baseline: null, floor: null, thresholdPct, noBaseline: true };
  }
  const floor = Math.round((baseline * thresholdPct) / 100);
  return { passed: rowCount >= floor, rowCount, baseline, floor, thresholdPct, noBaseline: false };
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * `never` is a distinct state, not a very stale `critical`.
 *
 * "We have never received anything from this feed" and "the last delivery was
 * three days ago" call for opposite responses — one is a configuration
 * problem, the other an operational one — and collapsing them into a single
 * red badge loses the only information that tells them apart.
 */
export type FreshnessState = "fresh" | "warning" | "critical" | "never";

export type FreshnessInput = {
  sourceKey: string;
  sourceName: string;
  lastPublishedAt: string | null;
  lastBatchId: string | null;
  lastRowCount: number | null;
  ageSeconds: number | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: string | null;
  consecutiveFailures: number;
  warningHours: number;
  criticalHours: number;
  openItemCount: number;
};

export type FreshnessReport = FreshnessInput & {
  state: FreshnessState;
  ageHours: number | null;
  /**
   * True when the last thing that happened to this source was a failure. A
   * source can be FRESH and FAILING at the same time — yesterday's data is
   * still good, and this morning's run was rejected — and a consumer that only
   * reads `state` would report everything is fine on the morning it stopped
   * being fine.
   */
  lastAttemptFailed: boolean;
};

export function classifyFreshness(input: FreshnessInput): FreshnessReport {
  const ageHours = input.ageSeconds === null ? null : input.ageSeconds / 3600;

  let state: FreshnessState;
  if (input.lastPublishedAt === null || ageHours === null) {
    state = "never";
  } else if (ageHours >= input.criticalHours) {
    state = "critical";
  } else if (ageHours >= input.warningHours) {
    state = "warning";
  } else {
    state = "fresh";
  }

  return {
    ...input,
    state,
    ageHours,
    lastAttemptFailed:
      input.lastAttemptStatus === "rejected" || input.lastAttemptStatus === "failed",
  };
}

/**
 * Whether a consumer may present figures derived from this source as current.
 *
 * The rule every later surface should call rather than reimplement: anything
 * past the critical threshold, or never loaded at all, must render as
 * unavailable rather than as the last figures it happens to hold. A stale
 * number shown without its staleness is the defect this program has spent its
 * sprints removing.
 */
export function canAssertCurrent(report: FreshnessReport): boolean {
  return report.state === "fresh" || report.state === "warning";
}

/** One Hebrew sentence stating what, when and from where. */
export function describeFreshness(report: FreshnessReport): string {
  if (report.state === "never") {
    return `${report.sourceName}: לא התקבלה קליטה מוצלחת מעולם`;
  }
  const hours = Math.floor(report.ageHours ?? 0);
  const age =
    hours < 1
      ? "בשעה האחרונה"
      : hours < 24
        ? `לפני ${hours} שעות`
        : `לפני ${Math.floor(hours / 24)} ימים`;
  const failing = report.lastAttemptFailed
    ? ` · הריצה האחרונה נכשלה (${report.consecutiveFailures} ברצף)`
    : "";
  return `${report.sourceName}: ${report.lastRowCount ?? 0} פריטים, עודכן ${age}${failing}`;
}

// ---------------------------------------------------------------------------
// Batch summary
// ---------------------------------------------------------------------------

export type BatchStatus = "open" | "staged" | "validated" | "published" | "rejected" | "failed";

export type ValidationCheckName =
  | "non_empty"
  | "row_integrity"
  | "duplicate_keys"
  | "duplicate_batch"
  | "volume";

/**
 * What comes back from a jsonb column. Narrower than `unknown` on purpose:
 * these values cross a server-function boundary, and `unknown` is not
 * serializable — the compiler catches that, which is the right place to catch
 * it rather than at runtime on a response that silently drops fields.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ValidationCheck = {
  check: ValidationCheckName;
  passed: boolean;
  /** The numbers the check judged on — stored so a rejection stays explainable. */
  detail: Record<string, JsonValue>;
};

export type ValidationResult = { passed: boolean; checks: ValidationCheck[] };

export type BatchSummary = {
  id: string;
  sourceKey: string;
  status: BatchStatus;
  externalBatchRef: string | null;
  rowCount: number;
  checksum: string | null;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsRejected: number;
  rowsVoided: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  validationResult: ValidationResult | null;
  rejectionCode: string | null;
  rejectionDetail: string | null;
  triggerKind: "scheduled" | "manual";
};

export const TERMINAL_BATCH_STATUSES: readonly BatchStatus[] = ["published", "rejected"];

export function isBatchTerminal(status: BatchStatus): boolean {
  return (TERMINAL_BATCH_STATUSES as readonly string[]).includes(status);
}

/** The checks that failed, for a rejection that has to be explained to a human. */
export function failedChecks(result: ValidationResult | null): ValidationCheck[] {
  if (!result) return [];
  return result.checks.filter((c) => !c.passed);
}

/**
 * How much of the inventory this batch actually moved.
 *
 * Worth a named function because the interesting number is almost never the
 * row count. A 100,000-row snapshot that changed 12 items and a 100,000-row
 * snapshot that changed 40,000 are the same size and mean completely different
 * things, and only one of them should make anyone look.
 */
export function changeRate(
  summary: Pick<BatchSummary, "rowCount" | "rowsInserted" | "rowsUpdated">,
): number {
  if (summary.rowCount === 0) return 0;
  return (summary.rowsInserted + summary.rowsUpdated) / summary.rowCount;
}
