// Import preview filters/search/pagination: display-only helpers over the
// ALREADY-processed rows. The old preview hard-capped at the first 20 rows,
// hiding errors and decision rows beyond them; these tests prove the
// classification, the default-filter priority, the pagination math, and —
// critically — that rows keep their ORIGINAL row.index so actions and the
// confirmation keep operating on the full processed array.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyImportPreviewRow,
  filterImportPreviewRows,
  getImportPreviewFilterCounts,
  paginateImportPreviewRows,
  pickDefaultImportPreviewFilter,
  IMPORT_CONFIRM_INCLUDES_HIDDEN_NOTE,
  IMPORT_PREVIEW_DISPLAY_FILTER_NOTE,
  IMPORT_PREVIEW_FILTER_LABEL,
  IMPORT_PREVIEW_PAGE_SIZES,
  type ImportPreviewRowLike,
} from "../import-preview";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const dataImportSrc = read("../../routes/_authenticated/data-import.tsx");
const previewSrc = read("../import-preview.ts");

// ---------------------------------------------------------------- fixtures

function row(over: Partial<ImportPreviewRowLike> & { index: number }): ImportPreviewRowLike {
  return {
    name: "נציג",
    teamId: "t1",
    teamName: "חידושי דירה",
    teamRaw: "חידושי דירה",
    matchRepId: "rep-1",
    matchedInactive: false,
    renewalFieldsSkipped: false,
    issues: [],
    action: "update",
    ...over,
  };
}

const errorRow = row({
  index: 0,
  issues: [
    { severity: "error", message: "שגיאה" },
    { severity: "warning", message: "אזהרה" },
  ],
  action: "skip",
});
const warningRow = row({ index: 1, issues: [{ severity: "warning", message: "אזהרה" }] });
const inactiveRow = row({ index: 2, matchedInactive: true, action: "skip" });
const unmatchedParkedRow = row({ index: 3, matchRepId: null, action: "skip", name: "דנה" });
const unmatchedCreateRow = row({ index: 4, matchRepId: null, action: "create", name: "איתי" });
const unknownTeamRow = row({ index: 5, teamId: null, teamName: null, teamRaw: "צוות זר" });
const renewalsSkippedRow = row({ index: 6, renewalFieldsSkipped: true });
const cleanRow = row({ index: 7 });

const allRows = [
  errorRow,
  warningRow,
  inactiveRow,
  unmatchedParkedRow,
  unmatchedCreateRow,
  unknownTeamRow,
  renewalsSkippedRow,
  cleanRow,
];

describe("classification — each filter matches the right rows", () => {
  it("errors: any row with an error-severity issue", () => {
    expect(classifyImportPreviewRow(errorRow).hasError).toBe(true);
    expect(classifyImportPreviewRow(warningRow).hasError).toBe(false);
  });

  it("a row with both error and warning counts as an ERROR, not a plain warning", () => {
    const c = classifyImportPreviewRow(errorRow);
    expect(c.hasError).toBe(true);
    expect(c.hasWarning).toBe(false);
    const counts = getImportPreviewFilterCounts([errorRow, warningRow]);
    expect(counts.errors).toBe(1);
    expect(counts.warnings).toBe(1);
  });

  it("decisions: inactive matches and importable unmatched rows parked on skip", () => {
    expect(classifyImportPreviewRow(inactiveRow).decision).toBe(true);
    expect(classifyImportPreviewRow(unmatchedParkedRow).decision).toBe(true);
    // Already decided (create) → no longer waiting on a decision.
    expect(classifyImportPreviewRow(unmatchedCreateRow).decision).toBe(false);
    expect(classifyImportPreviewRow(cleanRow).decision).toBe(false);
  });

  it("inactive / unmatched / unknown-team / renewals-skipped classify independently", () => {
    expect(classifyImportPreviewRow(inactiveRow).inactive).toBe(true);
    expect(classifyImportPreviewRow(unmatchedParkedRow).unmatched).toBe(true);
    // An errored row is not "unmatched" — it is blocked, not awaiting a match.
    expect(classifyImportPreviewRow({ ...errorRow, matchRepId: null }).unmatched).toBe(false);
    expect(classifyImportPreviewRow(unknownTeamRow).unknownTeam).toBe(true);
    expect(classifyImportPreviewRow(cleanRow).unknownTeam).toBe(false);
    expect(classifyImportPreviewRow(renewalsSkippedRow).renewalsSkipped).toBe(true);
  });

  it("counts cover every filter with 'all' as the full population", () => {
    const counts = getImportPreviewFilterCounts(allRows);
    expect(counts.all).toBe(8);
    expect(counts.errors).toBe(1);
    expect(counts.warnings).toBe(1);
    expect(counts.decisions).toBe(2);
    expect(counts.inactive).toBe(1);
    expect(counts.unmatched).toBe(2); // parked + create (both importable, no match)
    expect(counts.unknown_team).toBe(1);
    expect(counts.renewals_skipped).toBe(1);
  });
});

describe("default filter — decisions over errors over all", () => {
  it("prefers decisions when decision rows exist", () => {
    expect(pickDefaultImportPreviewFilter(allRows)).toBe("decisions");
  });

  it("falls back to errors when there are errors but no decisions", () => {
    expect(pickDefaultImportPreviewFilter([errorRow, warningRow, cleanRow])).toBe("errors");
  });

  it("falls back to all when the file is clean", () => {
    expect(pickDefaultImportPreviewFilter([warningRow, cleanRow])).toBe("all");
  });
});

describe("search — name, resolved team, raw team, matched name; before pagination", () => {
  it("matches the representative name and team texts", () => {
    expect(filterImportPreviewRows(allRows, "all", "דנה").map((r) => r.index)).toEqual([3]);
    expect(filterImportPreviewRows(allRows, "all", "צוות זר").map((r) => r.index)).toEqual([5]);
  });

  it("matches the matched representative's name via the lookup", () => {
    const names = new Map([["rep-1", "חן עטר"]]);
    const hits = filterImportPreviewRows([cleanRow, unmatchedParkedRow], "all", "חן עטר", names);
    expect(hits.map((r) => r.index)).toEqual([7]);
  });

  it("combines with the active filter", () => {
    expect(filterImportPreviewRows(allRows, "decisions", "דנה").map((r) => r.index)).toEqual([3]);
    expect(filterImportPreviewRows(allRows, "errors", "דנה")).toHaveLength(0);
  });
});

describe("pagination — 25/50/100, clamped, honest bounds", () => {
  const sixty = Array.from({ length: 60 }, (_, i) => row({ index: i }));

  it("60 rows at 25 per page = 3 pages, last page has 10 rows", () => {
    expect(paginateImportPreviewRows(sixty, 1, 25).totalPages).toBe(3);
    expect(paginateImportPreviewRows(sixty, 1, 25).pageRows).toHaveLength(25);
    const last = paginateImportPreviewRows(sixty, 3, 25);
    expect(last.pageRows).toHaveLength(10);
    expect(last.from).toBe(51);
    expect(last.to).toBe(60);
    expect(last.total).toBe(60);
  });

  it("clamps an out-of-range page instead of stranding the table empty", () => {
    // e.g. the user acts on rows and the filtered set shrinks below the page.
    const clamped = paginateImportPreviewRows(sixty.slice(0, 10), 3, 25);
    expect(clamped.page).toBe(1);
    expect(clamped.pageRows).toHaveLength(10);
    const empty = paginateImportPreviewRows([], 5, 25);
    expect(empty.page).toBe(1);
    expect(empty.from).toBe(0);
    expect(empty.to).toBe(0);
  });

  it("supports exactly the 25/50/100 page sizes with 25 as default", () => {
    expect([...IMPORT_PREVIEW_PAGE_SIZES]).toEqual([25, 50, 100]);
  });

  it("the UI resets to page 1 on filter/search/page-size changes", () => {
    // Each control's handler pairs its set* with setPage(1).
    const preview = dataImportSrc.slice(
      dataImportSrc.indexOf("function PreviewStep"),
      dataImportSrc.indexOf("function ManualMatchDialog"),
    );
    expect(preview).toContain("setFilter(f);");
    expect((preview.match(/setPage\(1\);/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("original row.index is preserved end to end", () => {
  it("filtering and paging return the same row objects, original indexes intact", () => {
    const filtered = filterImportPreviewRows(allRows, "decisions", "");
    expect(filtered.map((r) => r.index)).toEqual([2, 3]);
    const page = paginateImportPreviewRows(filtered, 1, 25);
    expect(page.pageRows[0]).toBe(inactiveRow);
    expect(page.pageRows.map((r) => r.index)).toEqual([2, 3]);
  });

  it("the table still keys rows and dispatches actions by r.index", () => {
    const preview = dataImportSrc.slice(
      dataImportSrc.indexOf("function PreviewStep"),
      dataImportSrc.indexOf("function ManualMatchDialog"),
    );
    expect(preview).toContain(
      "onValueChange={(v) => onChangeAction(r.index, v as ResolvedAction)}",
    );
    expect(preview).toContain('onPick={(id) => onChangeAction(r.index, "update", id)}');
    expect(preview).toContain("<TableRow key={r.index}");
    // The hard 20-row cap is gone.
    expect(preview).not.toContain("slice(0, 20)");
    expect(preview).not.toContain("מוצגות 20 השורות הראשונות");
  });

  it("summary and confirmation counts stay based on the FULL processed array", () => {
    const preview = dataImportSrc.slice(
      dataImportSrc.indexOf("function PreviewStep"),
      dataImportSrc.indexOf("function ManualMatchDialog"),
    );
    // The stat chips and banners count `processed`, never the filtered rows.
    expect(preview).toContain('value={processed.filter((p) => p.action === "update").length}');
    expect(preview).toContain("value={processed.length}");
    const confirm = dataImportSrc.slice(dataImportSrc.indexOf("function ConfirmStep"));
    expect(confirm).toContain(
      'const updateN = processed.filter((p) => p.action === "update").length;',
    );
    expect(confirm).toContain("{IMPORT_CONFIRM_INCLUDES_HIDDEN_NOTE}");
  });
});

describe("display-only wording", () => {
  it("declares the filter as display-only and reminds at confirmation", () => {
    expect(IMPORT_PREVIEW_DISPLAY_FILTER_NOTE).toBe(
      "זהו סינון תצוגה בלבד. האישור יתייחס לכל השורות לפי הפעולה שהוגדרה לכל שורה.",
    );
    expect(IMPORT_CONFIRM_INCLUDES_HIDDEN_NOTE).toBe(
      "האישור כולל גם שורות שלא הוצגו בסינון התצוגה המקדימה.",
    );
    expect(dataImportSrc).toContain("{IMPORT_PREVIEW_DISPLAY_FILTER_NOTE}");
    expect(IMPORT_PREVIEW_FILTER_LABEL.decisions).toBe("דורש החלטה");
    expect(IMPORT_PREVIEW_FILTER_LABEL.all).toBe("הכול");
  });
});

describe("safety — display-only change", () => {
  it("import-preview.ts is pure display logic: no processing, no writes, no I/O", () => {
    for (const term of [
      "processRows",
      "matchImportRow",
      "resolveTeam",
      "supabase",
      "createServerFn",
      "fetch(",
    ]) {
      expect(previewSrc).not.toContain(term);
    }
  });

  it("the wizard's pipeline entry points are untouched", () => {
    expect(dataImportSrc).toContain("processRows(rows, mapping, state.reps, teamsForResolution");
    expect(dataImportSrc).toContain("updateRepresentativeMetrics");
    expect(dataImportSrc).toContain("writeRepresentativeKpiValue");
    expect(dataImportSrc).toContain("setRepresentativeGoals");
  });

  it("no DB/RLS/role surface and no CRM vocabulary", () => {
    for (const src of [previewSrc]) {
      expect(src).not.toContain("ALTER ");
      expect(src).not.toContain("user_roles");
      for (const term of ["crm", "worklist", "policy_number", "call_outcome"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
