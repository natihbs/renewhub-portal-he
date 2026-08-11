// Phase 5 — /data-import as a guided operations workspace.
//
// These tests cover the NEW presentation derivations only; the import
// processing, matching, PII, preview-filter, target-write and undo suites keep
// owning their own semantics and are untouched.
//
// The rule under test throughout: the screen may never describe an import
// better than it was, and may never invent a signal the data does not carry.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProcessedRow } from "@/lib/import-processing";
import type { ImportHistoryEntry } from "@/lib/import-store";
import {
  countImportActions,
  deriveStoredImportOutcome,
  hasImportableRows,
  importOutcomeView,
  importStatusLabel,
  importTargetPlan,
  MATCH_EXCEPTIONS_SKIPPED_LABEL,
  summarizeProcessedRows,
} from "@/lib/import-summary";
import { IMPORT_PREVIEW_FILTER_LABEL, classifyImportPreviewRow } from "@/lib/import-preview";

const dataImportSrc = readFileSync(
  resolve(__dirname, "../../routes/_authenticated/data-import.tsx"),
  "utf8",
);

const row = (over: Partial<ProcessedRow>): ProcessedRow =>
  ({
    index: 0,
    raw: {},
    name: "דנה",
    teamId: "t1",
    teamName: "צוות",
    teamRaw: "צוות",
    monthlyTarget: null,
    currentResult: 10,
    updatedAt: "2026-08-01",
    renewalOpportunities: null,
    completedRenewals: null,
    renewalFieldsSkipped: false,
    issues: [],
    matchRepId: "r1",
    matchedInactive: false,
    matchedBy: "name",
    action: "update",
    ...over,
  }) as ProcessedRow;

const ROWS: ProcessedRow[] = [
  row({ index: 0, action: "update" }),
  row({ index: 1, action: "update" }),
  // matched a DEACTIVATED rep — parked on skip until a human decides
  row({ index: 2, action: "skip", matchedInactive: true }),
  // no match at all — will be dropped unless explicitly set to create
  row({ index: 3, action: "skip", matchRepId: null, matchedBy: null, name: "חדש" }),
  // explicitly chosen reactivation
  row({ index: 4, action: "reactivate", matchedInactive: true }),
  // explicitly chosen creation
  row({ index: 5, action: "create", matchRepId: null, matchedBy: null, name: "נוסף" }),
  // a hard error — skipped, and NOT a pending decision
  row({
    index: 6,
    action: "skip",
    matchRepId: null,
    matchedBy: null,
    issues: [{ severity: "error", message: "חסר שם" }],
  }),
  // a warning only
  row({ index: 7, action: "update", issues: [{ severity: "warning", message: "צוות לא מזוהה" }] }),
];

describe("summarizeProcessedRows — counts, never a quality score", () => {
  const s = summarizeProcessedRows(ROWS);

  it("counts every action bucket, with reactivation separate from update and create", () => {
    expect(s.total).toBe(8);
    expect(s.update).toBe(3);
    expect(s.reactivate).toBe(1);
    expect(s.create).toBe(1);
    expect(s.skip).toBe(3);
    // The four buckets are mutually exclusive and cover every row.
    expect(s.update + s.reactivate + s.create + s.skip).toBe(s.total);
  });

  it("counts error ROWS and warning ISSUES separately", () => {
    expect(s.errorRows).toBe(1);
    expect(s.warnings).toBe(1);
  });

  it("counts matching exceptions that are still set to skip", () => {
    // Still skipped: the inactive match (2) and the unmatched importable row
    // (3). Resolved to an action: the reactivation (4) and the explicit create
    // (5). Never counted: the error row (6) — it needs a file fix, not a
    // choice.
    expect(s.matchExceptionsSkipped).toBe(2);
    expect(s.matchedInactive).toBe(2);
    expect(s.unmatched).toBe(2);
  });

  it("resolving a matching exception removes it from the skipped count", () => {
    const pending = row({ action: "skip", matchedInactive: true });
    expect(summarizeProcessedRows([pending]).matchExceptionsSkipped).toBe(1);
    expect(
      summarizeProcessedRows([{ ...pending, action: "reactivate" }]).matchExceptionsSkipped,
    ).toBe(0);
    expect(summarizeProcessedRows([{ ...pending, action: "create" }]).matchExceptionsSkipped).toBe(
      0,
    );
  });

  it("exposes no score, percentage or freshness field", () => {
    expect(Object.keys(s).some((k) => /score|pct|percent|rate|quality|fresh/i.test(k))).toBe(false);
  });

  it("an empty file is all zeros, never NaN", () => {
    expect(summarizeProcessedRows([])).toEqual({
      total: 0,
      update: 0,
      reactivate: 0,
      create: 0,
      skip: 0,
      errorRows: 0,
      warnings: 0,
      matchExceptionsSkipped: 0,
      matchedInactive: 0,
      unmatched: 0,
    });
  });
});

describe("import outcome wording is derived from the stored status", () => {
  it("a successful import may say so", () => {
    const v = importOutcomeView("success");
    expect(v.title).toBe("הייבוא הושלם בהצלחה");
    expect(v.tone).toBe("success");
  });

  it("a PARTIAL import can never render success wording", () => {
    const v = importOutcomeView("partial");
    expect(v.title).not.toContain("בהצלחה");
    expect(v.title).toBe("הייבוא הושלם חלקית");
    expect(v.tone).toBe("warning");
    expect(v.description).toContain("דוח השגיאות");
  });

  it("a FAILED import can never render success wording", () => {
    const v = importOutcomeView("failed");
    expect(v.title).not.toContain("בהצלחה");
    expect(v.title).toBe("הייבוא נכשל");
    expect(v.tone).toBe("danger");
  });

  it("only the success status produces the success sentence", () => {
    const statuses: ImportHistoryEntry["status"][] = ["success", "partial", "failed"];
    const withSuccessWording = statuses.filter((s) =>
      importOutcomeView(s).title.includes("בהצלחה"),
    );
    expect(withSuccessWording).toEqual(["success"]);
  });

  it("history labels match the same three statuses", () => {
    expect(importStatusLabel("success")).toBe("הושלם");
    expect(importStatusLabel("partial")).toBe("חלקי");
    expect(importStatusLabel("failed")).toBe("נכשל");
  });

  it("the summary step renders the derived wording, not a hard-coded banner", () => {
    // The truthfulness bug fixed in Phase 5: SummaryStep used to print
    // "הייבוא הושלם בהצלחה" unconditionally, including for partial/failed.
    const summaryStep = dataImportSrc.slice(
      dataImportSrc.indexOf("function SummaryStep"),
      dataImportSrc.indexOf("function HistoryCard"),
    );
    expect(summaryStep).toContain("importOutcomeView(entry.status)");
    expect(summaryStep).toContain("{outcome.title}");
    expect(summaryStep).not.toContain("<AlertTitle>הייבוא הושלם בהצלחה</AlertTitle>");
    // The "go look at the results" action only appears when rows landed.
    expect(summaryStep).toContain("entry.rowsUpdated + entry.rowsCreated > 0 &&");
  });
});

describe("target import plan — opt-in and an explicit month, or nothing", () => {
  it("targets OFF means no target write, whatever the file contains", () => {
    expect(
      importTargetPlan({ applyTargetsFromImport: false, importTargetMonth: "2026-08" }),
    ).toEqual({ willWrite: false, reason: "off" });
  });

  it("targets ON without a month never writes and never guesses one", () => {
    const plan = importTargetPlan({ applyTargetsFromImport: true, importTargetMonth: "" });
    expect(plan).toEqual({ willWrite: false, reason: "month_missing" });
    expect(JSON.stringify(plan)).not.toContain("20");
  });

  it("targets ON with an explicit month writes to that month only", () => {
    expect(
      importTargetPlan({ applyTargetsFromImport: true, importTargetMonth: "2026-08" }),
    ).toEqual({ willWrite: true, month: "2026-08" });
  });

  it("the page still defaults the opt-in to OFF and blocks confirm without a month", () => {
    expect(dataImportSrc).toContain("useState(false)");
    expect(dataImportSrc).toContain(
      "const monthMissing = applyTargetsFromImport && !importTargetMonth;",
    );
    // Eligibility now goes through hasImportableRows (update + reactivate +
    // create); the target-month guard remains its own separate condition.
    expect(dataImportSrc).toContain(
      "disabled={busy || !hasImportableRows(actions) || monthMissing}",
    );
    // The month default is only seeded from an unambiguous file, never "now".
    expect(dataImportSrc).toContain(
      'setImportTargetMonth(reportedMonths.size === 1 ? [...reportedMonths][0] : "")',
    );
    expect(dataImportSrc).toContain(
      "applyTargetsFromImport && targetCandidates.length > 0 && importTargetMonth",
    );
  });
});

describe("display filtering never changes what will be imported", () => {
  it("the confirm totals read the FULL processed array", () => {
    const confirm = dataImportSrc.slice(dataImportSrc.indexOf("function ConfirmStep"));
    // The four action counts come from countImportActions over the FULL
    // processed array, never from the filtered/paginated preview rows.
    expect(confirm).toContain("countImportActions(processed)");
    expect(confirm).toContain("{IMPORT_CONFIRM_INCLUDES_HIDDEN_NOTE}");
  });

  it("the preview band summarizes the processed rows, not the filtered page", () => {
    const preview = dataImportSrc.slice(
      dataImportSrc.indexOf("function PreviewStep"),
      dataImportSrc.indexOf("function PreviewRowAction"),
    );
    expect(preview).toContain("summarizeProcessedRows(processed)");
    expect(preview).toContain("{IMPORT_PREVIEW_DISPLAY_FILTER_NOTE}");
    // Filtering a set of rows out of the VIEW cannot change the summary the
    // confirmation is based on — both read `processed`.
    const filteredOut = ROWS.filter((r) => r.action !== "skip");
    expect(summarizeProcessedRows(ROWS).update).toBe(3);
    expect(summarizeProcessedRows(filteredOut).total).toBe(5);
    expect(summarizeProcessedRows(ROWS).total).toBe(8);
  });

  it("row identity stays the original row.index in both layouts", () => {
    const action = dataImportSrc.slice(
      dataImportSrc.indexOf("function PreviewRowAction"),
      dataImportSrc.indexOf("function ManualMatchDialog"),
    );
    expect(action).toContain("onValueChange={(v) => onChangeAction(r.index, v as ResolvedAction)}");
    expect(action).toContain('onPick={(id) => onChangeAction(r.index, "update", id)}');
  });
});

describe("inactive-match safety is unchanged", () => {
  it("keeps all three explicit choices and the duplication warning", () => {
    const action = dataImportSrc.slice(
      dataImportSrc.indexOf("function PreviewRowAction"),
      dataImportSrc.indexOf("function ManualMatchDialog"),
    );
    // plain update stays impossible for an inactive match
    expect(action).toContain(
      '<SelectItem value="update" disabled={!r.matchRepId || r.matchedInactive}>',
    );
    expect(action).toContain('<SelectItem value="reactivate">');
    expect(action).toContain('"יצירת נציג נפרד (כפילות!)"');
    expect(action).toContain('<SelectItem value="skip">דילוג</SelectItem>');
  });

  it("keeps the up-front warning that such rows do not import by default", () => {
    expect(dataImportSrc).toContain("שורות אלו לא ייובאו כברירת מחדל");
    expect(dataImportSrc).toContain("יצירה תייצר רשומה כפולה עם היסטוריה ריקה");
  });

  it("a matched-inactive row is counted as a pending decision, not as an update", () => {
    const s = summarizeProcessedRows([row({ action: "skip", matchedInactive: true })]);
    expect(s.update).toBe(0);
    expect(s.matchExceptionsSkipped).toBe(1);
  });
});

describe("workflow rail is status, not a shortcut", () => {
  it("keeps the exact five steps and marks done/current/upcoming", () => {
    expect(dataImportSrc).toContain(
      'const STEPS = ["העלאת קובץ", "מיפוי עמודות", "בדיקת נתונים", "אישור", "סיכום"] as const;',
    );
    const rail = dataImportSrc.slice(
      dataImportSrc.indexOf("function StepBar"),
      dataImportSrc.indexOf("function PrivacyNotice"),
    );
    expect(rail).toContain('aria-current={active ? "step" : undefined}');
    expect(rail).toContain("הושלם");
    expect(rail).toContain("שלב נוכחי");
    expect(rail).toContain("בהמשך");
    // No navigation handler — the rail cannot bypass a step's validation.
    expect(rail).not.toContain("onClick");
  });

  it("keeps both the privacy and the scope notices, and the undo caveat", () => {
    expect(dataImportSrc).toContain("function PrivacyNotice");
    expect(dataImportSrc).toContain("function ImportScopeCard");
    expect(dataImportSrc).toContain("<ImportScopeCard />");
    expect(dataImportSrc).toContain("אין להעלות פרטי לקוחות");
    expect(dataImportSrc).toContain("נציגים שנוצרו בייבוא זה אינם נמחקים");
  });
});

// ============================================ pre-PR audit fixes (Phase 5)

describe("A — stored import outcome accounts for target-write failures", () => {
  const base = { cloudFailed: 0, updated: 3, created: 1, errs: 0, targetsFailed: 0 };

  it("no failures at all → success with zero errors", () => {
    expect(deriveStoredImportOutcome(base)).toEqual({ status: "success", errors: 0 });
  });

  it("ordinary row errors → partial", () => {
    expect(deriveStoredImportOutcome({ ...base, errs: 2 })).toEqual({
      status: "partial",
      errors: 2,
    });
  });

  it("a failed official-target write with successful core writes → PARTIAL, never success", () => {
    // The exact audit case: cloudFailed = 0, errs = 0, targetsFailed > 0.
    const out = deriveStoredImportOutcome({ ...base, targetsFailed: 4 });
    expect(out.status).toBe("partial");
    expect(out.status).not.toBe("success");
  });

  it("target failures are counted in the stored error total, without double-counting", () => {
    // targetsFailed is tracked separately from errs during the run, so the
    // stored count is their sum — a run with both reports both.
    expect(deriveStoredImportOutcome({ ...base, errs: 1, targetsFailed: 2 }).errors).toBe(3);
    expect(deriveStoredImportOutcome({ ...base, targetsFailed: 2 }).errors).toBe(2);
    // And the permanent surface can never say "0 שגיאות" after a target failure.
    expect(deriveStoredImportOutcome({ ...base, targetsFailed: 1 }).errors).toBeGreaterThan(0);
  });

  it("core cloud failure keeps its existing meaning", () => {
    // Nothing landed → failed.
    expect(
      deriveStoredImportOutcome({
        cloudFailed: 5,
        updated: 0,
        created: 0,
        errs: 5,
        targetsFailed: 0,
      }),
    ).toEqual({ status: "failed", errors: 5 });
    // Something landed → partial.
    expect(
      deriveStoredImportOutcome({
        cloudFailed: 1,
        updated: 2,
        created: 0,
        errs: 1,
        targetsFailed: 0,
      }).status,
    ).toBe("partial");
  });

  it("a target skipped for having no team is NOT an error and never degrades the status", () => {
    // targetsSkippedNoTeam is deliberately not an input: a representative with
    // no team simply cannot receive an official target this way.
    const out = deriveStoredImportOutcome(base);
    expect(out).toEqual({ status: "success", errors: 0 });
    expect(Object.keys(base)).not.toContain("targetsSkippedNoTeam");
  });

  it("the stored status is what the summary wording is derived from", () => {
    const failedTargets = deriveStoredImportOutcome({ ...base, targetsFailed: 1 });
    expect(importOutcomeView(failedTargets.status).title).not.toContain("בהצלחה");
    expect(importStatusLabel(failedTargets.status)).toBe("חלקי");
  });
});

describe("B — confirmation action counts are exact", () => {
  const mixed = [
    row({ index: 0, action: "update" }),
    row({ index: 1, action: "reactivate", matchedInactive: true }),
    row({ index: 2, action: "create", matchRepId: null }),
    row({ index: 3, action: "skip" }),
  ];

  it("counts each of the four populations from the row's own action", () => {
    const c = countImportActions(mixed);
    expect(c.update).toBe(1);
    expect(c.reactivate).toBe(1);
    expect(c.create).toBe(1);
    expect(c.skip).toBe(1);
  });

  it("the four displayed counts sum to the processed row count", () => {
    const c = countImportActions(mixed);
    expect(c.update + c.reactivate + c.create + c.skip).toBe(c.total);
    expect(c.total).toBe(4);
  });

  it("a reactivation is NEVER folded into the skip figure", () => {
    const c = countImportActions([row({ action: "reactivate", matchedInactive: true })]);
    expect(c.skip).toBe(0);
    expect(c.reactivate).toBe(1);
    // The old derivation (total - update - create) would have said 1.
    expect(c.total - c.update - c.create).toBe(1);
    expect(c.skip).not.toBe(c.total - c.update - c.create);
  });

  it("an empty file counts nothing", () => {
    expect(countImportActions([])).toEqual({
      update: 0,
      reactivate: 0,
      create: 0,
      skip: 0,
      total: 0,
    });
  });
});

describe("C — confirmation eligibility treats reactivate as importable", () => {
  const only = (action: ProcessedRow["action"]) =>
    hasImportableRows(countImportActions([row({ action })]));

  it("a file of only updates is confirmable", () => {
    expect(only("update")).toBe(true);
  });
  it("a file of only creates is confirmable", () => {
    expect(only("create")).toBe(true);
  });
  it("a file of only REACTIVATIONS is confirmable", () => {
    expect(only("reactivate")).toBe(true);
  });
  it("a file of only skips is not confirmable", () => {
    expect(only("skip")).toBe(false);
  });
  it("an empty file is not confirmable", () => {
    expect(hasImportableRows(countImportActions([]))).toBe(false);
  });

  it("eligibility does not override the target-month rule", () => {
    // The button stays disabled while an opted-in import has no month, even
    // though the rows themselves are importable — the two guards are separate.
    const importable = hasImportableRows(
      countImportActions([row({ action: "reactivate", matchedInactive: true })]),
    );
    const plan = importTargetPlan({ applyTargetsFromImport: true, importTargetMonth: "" });
    expect(importable).toBe(true);
    expect(plan.willWrite).toBe(false);
    expect(plan).toEqual({ willWrite: false, reason: "month_missing" });
  });
});

describe("D — matching-exception wording says only what the model knows", () => {
  it("neither surface claims a decision is still outstanding", () => {
    expect(MATCH_EXCEPTIONS_SKIPPED_LABEL).toBe("חריגי התאמה בדילוג");
    expect(IMPORT_PREVIEW_FILTER_LABEL.decisions).toBe("חריגי התאמה");
    for (const label of [MATCH_EXCEPTIONS_SKIPPED_LABEL, IMPORT_PREVIEW_FILTER_LABEL.decisions]) {
      expect(label).not.toContain("דורש החלטה");
    }
  });

  it("a resolved inactive row stays a matching exception but is no longer counted as skipped", () => {
    // This is why the two numbers may legitimately differ — and why their
    // labels now explain the difference instead of sharing one claim.
    const resolved = row({ action: "reactivate", matchedInactive: true });
    expect(classifyImportPreviewRow(resolved).decision).toBe(true);
    expect(summarizeProcessedRows([resolved]).matchExceptionsSkipped).toBe(0);
  });

  it("an unresolved inactive row is in both populations", () => {
    const pending = row({ action: "skip", matchedInactive: true });
    expect(classifyImportPreviewRow(pending).decision).toBe(true);
    expect(summarizeProcessedRows([pending]).matchExceptionsSkipped).toBe(1);
  });

  it("the summary field is not named as if it knew about intent", () => {
    const keys = Object.keys(summarizeProcessedRows([]));
    expect(keys).toContain("matchExceptionsSkipped");
    expect(keys.some((k) => /decisionsRequired|userDecided|touched/i.test(k))).toBe(false);
  });
});
