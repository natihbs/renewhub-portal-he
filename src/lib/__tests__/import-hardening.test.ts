import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  matchImportRow,
  processRows,
  UNMATCHED_NO_AUTOCREATE_MESSAGE,
  type ImportMatchCandidate,
} from "@/lib/import-processing";
import {
  autoMap,
  parseDate,
  REQUIRED_FIELDS,
  MATCH_ONLY_FIELDS,
  FIELD_LABEL,
  type ImportFieldKey,
} from "@/lib/import-store";

// ---------------------------------------------------------------------------
// Performance import & KPI data hardening: a safe, explicit import path for
// current-month performance and renewal KPIs. Pure-function coverage for the
// matcher/validator, source pins for apply/permissions/freshness.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const dataImportSrc = read("../../routes/_authenticated/data-import.tsx");
const importStoreSrc = read("../import-store.tsx");
const repAdminSrc = read("../rep-admin.functions.ts");
const kpiFnsSrc = read("../kpi.functions.ts");
const dashboardFnsSrc = read("../dashboard.functions.ts");
const homeCardsSrc = read("../../components/HomeCards.tsx");
const homeSrc = read("../../routes/_authenticated/index.tsx");

const candidates: ImportMatchCandidate[] = [
  {
    id: "r1",
    name: "דנה כהן",
    externalRef: "EMP-101",
    email: "dana@x.co",
    active: true,
    teamId: "t1",
  },
  { id: "r2", name: "איתי לוי", externalRef: null, email: null, active: true, teamId: "t1" },
];

const mapping: Record<string, ImportFieldKey> = {
  "שם נציג": "name",
  אימייל: "email",
  צוות: "team",
  "ביצוע נוכחי": "currentResult",
  חודש: "updatedAt",
  "הזדמנויות חידוש": "renewalOpportunities",
  "חידושים שבוצעו": "completedRenewals",
};

const teams = [{ id: "t1", name: "חידושי רכב", kpiProfile: "renewals" as const }];

const row = (over: Record<string, unknown> = {}) => ({
  "שם נציג": "דנה כהן",
  אימייל: "",
  צוות: "חידושי רכב",
  "ביצוע נוכחי": 80,
  חודש: "2026-08",
  ...over,
});

// ------------------------------------------------------------- template (A)
describe("A — template and Hebrew aliases", () => {
  it("auto-maps the Hebrew alias set, including the month column", () => {
    const map = autoMap([
      "שם נציג",
      "אימייל",
      "צוות",
      "ביצוע נוכחי",
      "חודש",
      "הזדמנויות חידוש",
      "חידושים שבוצעו",
    ]);
    expect(map["שם נציג"]).toBe("name");
    expect(map["אימייל"]).toBe("email");
    expect(map["צוות"]).toBe("team");
    expect(map["ביצוע נוכחי"]).toBe("currentResult");
    expect(map["חודש"]).toBe("updatedAt");
    expect(map["הזדמנויות חידוש"]).toBe("renewalOpportunities");
    expect(map["חידושים שבוצעו"]).toBe("completedRenewals");
  });

  it("a reporting month is a legal period value — 'YYYY-MM' and 'MM/YYYY' become the first of the month", () => {
    expect(parseDate("2026-08")).toBe("2026-08-01");
    expect(parseDate("08/2026")).toBe("2026-08-01");
    expect(parseDate("2026-13")).toBeNull();
    expect(parseDate("00/2026")).toBeNull();
    expect(parseDate("לא תאריך")).toBeNull();
  });

  it("the downloadable template carries the full supported column set", () => {
    for (const col of [
      "שם הנציג",
      "מזהה נציג",
      "אימייל",
      "צוות",
      "ביצוע נוכחי",
      "תאריך עדכון",
      "מיועדות חודשיות",
      "חידושים שנסגרו",
    ]) {
      expect(dataImportSrc).toContain(`"${col}"`);
    }
  });

  it("identifier columns are match-only — never persisted by an import", () => {
    expect(MATCH_ONLY_FIELDS).toEqual(["externalRef", "email"]);
    expect(FIELD_LABEL.email).toContain("אימייל");
  });
});

// ----------------------------------------------------------- validation (B)
describe("B — validation and preview", () => {
  it("required columns are name, team, current result and a date/month", () => {
    expect(REQUIRED_FIELDS).toEqual(["name", "team", "currentResult", "updatedAt"]);
    // The UI blocks preview when any required field is unmapped.
    expect(dataImportSrc).toContain(
      "REQUIRED_FIELDS.filter((f) => !Object.values(mapping).includes(f))",
    );
    expect(dataImportSrc).toContain("חסרות עמודות חובה");
  });

  it("a valid matched row previews as an update", () => {
    const [r] = processRows([row()], mapping, [], teams, candidates);
    expect(r.matchRepId).toBe("r1");
    expect(r.action).toBe("update");
    expect(r.updatedAt).toBe("2026-08-01");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("an unknown representative is surfaced and NEVER silently created", () => {
    const [r] = processRows([row({ "שם נציג": "מישהו חדש" })], mapping, [], teams, candidates);
    expect(r.matchRepId).toBeNull();
    expect(r.action).toBe("skip");
    expect(r.issues.some((i) => i.message === UNMATCHED_NO_AUTOCREATE_MESSAGE)).toBe(true);
  });

  it("duplicate representative rows are flagged", () => {
    const rows = [row(), row({ "ביצוע נוכחי": 90 })];
    const [, second] = processRows(rows, mapping, [], teams, candidates);
    expect(second.issues.some((i) => i.message.includes("כפילות"))).toBe(true);
  });

  it("negative values are blocked: current result and renewal counts", () => {
    const [neg] = processRows([row({ "ביצוע נוכחי": -5 })], mapping, [], teams, candidates);
    expect(neg.issues.some((i) => i.severity === "error")).toBe(true);
    expect(neg.action).toBe("skip");

    const [negRenewal] = processRows(
      [row({ "הזדמנויות חידוש": -3 })],
      mapping,
      [],
      teams,
      candidates,
    );
    expect(
      negRenewal.issues.some((i) => i.severity === "error" && i.message.includes("שליליים")),
    ).toBe(true);
  });

  it("completed renewals above opportunities is a visible warning", () => {
    const [r] = processRows(
      [row({ "הזדמנויות חידוש": 10, "חידושים שבוצעו": 14 })],
      mapping,
      [],
      teams,
      candidates,
    );
    expect(
      r.issues.some(
        (i) => i.severity === "warning" && i.message.includes("גדולים ממספר המיועדות"),
      ),
    ).toBe(true);
  });

  it("an invalid month/period is a blocking error", () => {
    const [r] = processRows([row({ חודש: "מחר בערב" })], mapping, [], teams, candidates);
    expect(r.updatedAt).toBeNull();
    expect(r.issues.some((i) => i.severity === "error")).toBe(true);
    expect(r.action).toBe("skip");
  });

  it("rows with blocking errors are never applied", () => {
    // applyImport skips any row with error-severity issues before writing.
    expect(dataImportSrc).toContain('if (r.action === "skip" || rowErrors.length > 0)');
  });
});

// ----------------------------------------------------- matching precedence
describe("matching — external_ref, then email, then name", () => {
  it("external_ref beats email beats name", () => {
    const both: ImportMatchCandidate[] = [
      { id: "a", name: "אחר", externalRef: "REF-1", email: "b@x.co", active: true, teamId: null },
      { id: "b", name: "דנה כהן", externalRef: null, email: "a@x.co", active: true, teamId: null },
    ];
    expect(matchImportRow("דנה כהן", "REF-1", both, "a@x.co")?.candidate.id).toBe("a");
    expect(matchImportRow("דנה כהן", null, both, "a@x.co")?.matchedBy).toBe("email");
    expect(matchImportRow("דנה כהן", null, both, null)?.matchedBy).toBe("name");
  });

  it("email matching is case-insensitive and works end-to-end in processRows", () => {
    const [r] = processRows(
      [row({ "שם נציג": "שם אחר לגמרי", אימייל: "DANA@X.CO" })],
      mapping,
      [],
      teams,
      candidates,
    );
    expect(r.matchRepId).toBe("r1");
    expect(r.matchedBy).toBe("email");
  });

  it("candidate emails come from the linked login account, resolved server-side over the caller's own RLS scope", () => {
    expect(repAdminSrc).toContain('select("id, name, external_ref, active, team_id, user_id")');
    expect(repAdminSrc).toContain('from("profiles")');
    expect(repAdminSrc).toContain("user_email");
  });
});

// ------------------------------------------------------------- apply (C+F)
describe("C — apply behavior", () => {
  it("updates go through the audited metrics path with source import — never a target write", () => {
    expect(dataImportSrc).toContain('source: "import"');
    expect(dataImportSrc).toContain("current_result: r.currentResult ?? undefined");
    expect(dataImportSrc).toContain("monthly_target is never written from");
  });

  it("renewal kpi_values are written with the imported period as metric_date", () => {
    expect(dataImportSrc).toContain("metric_date: updatedAt");
    expect(dataImportSrc).toContain("renewal_opportunities: r.renewalOpportunities");
    expect(dataImportSrc).toContain("completed_renewals: r.completedRenewals");
    // Team attribution stays the database's derivation (existing policy).
    expect(dataImportSrc).toContain("team_id is deliberately NOT sent");
  });

  it("import_history records the applied period — only when the file agreed on one month", () => {
    expect(dataImportSrc).toContain("const appliedPeriod = appliedMonths.size === 1");
    expect(dataImportSrc).toContain("period: appliedPeriod");
    expect(importStoreSrc).toContain("period: entry.period ?? null");
    // Drift safety: an un-migrated live DB still gets its history row.
    expect(importStoreSrc).toContain(".catch(() => historyCloud.insert(baseRow as never");
  });

  it("kpi writes are audited server-side; manual updates stay a distinct audited source", () => {
    expect(kpiFnsSrc).toContain('"kpi.update"');
    expect(kpiFnsSrc).toContain("source: data.source");
    // Manual fallback remains its own path with its own source value.
    expect(dataImportSrc).toContain('source: "manual"');
    const manualDialog = read("../../components/ManualPerformanceDialog.tsx");
    expect(manualDialog).toContain('source: "manual"');
  });
});

// ---------------------------------------------------------- freshness (D)
describe("D — freshness comes from real import/KPI dates", () => {
  it("the server freshness read uses kpi_values and import_history — not representatives.updated_at", () => {
    const fn = dashboardFnsSrc.slice(
      dashboardFnsSrc.indexOf("getPerformanceDataFreshness"),
      dashboardFnsSrc.indexOf("getPerformanceDataFreshness") + 1600,
    );
    expect(fn).toContain('from("kpi_values")');
    expect(fn).toContain('from("import_history")');
    expect(fn).not.toContain('from("representatives")');
  });

  it("manager/admin copy: fresh, missing-import and stale states", () => {
    expect(homeCardsSrc).toContain("הנתונים עודכנו לאחרונה ב־");
    expect(homeCardsSrc).toContain("טרם בוצע ייבוא נתונים");
    // stale renders on the warning/danger tones with the last import date line.
    expect(homeCardsSrc).toContain("lastImportLabel");
  });

  it("RepresentativeHome still renders no freshness bar", () => {
    const repHome = homeSrc.slice(
      homeSrc.indexOf("function RepresentativeHome"),
      homeSrc.indexOf("function TopPerformersCard"),
    );
    expect(repHome).not.toContain("DataFreshnessBar");
  });
});

// -------------------------------------------------------- permissions (H)
describe("H — permissions are enforced server-side", () => {
  it("the import page is staff-only and the candidates endpoint rejects non-staff", () => {
    expect(dataImportSrc).toContain('beforeLoad: () => requireRole(["admin", "manager"])');
    expect(repAdminSrc).toContain('throw new Error("אין הרשאה לייבוא נתונים")');
  });

  it("each row write authorizes per representative — admin any, manager only their teams.manager_id scope", () => {
    expect(repAdminSrc).toContain('if (roles.includes("admin")) return { isAdmin: true };');
    expect(repAdminSrc).toContain("הוא אינו משויך לצוות שבניהולך");
    expect(kpiFnsSrc).toContain("assertCanWriteKpi");
  });

  it("a representative cannot import: route gate + server-side role checks, no client-only trust", () => {
    expect(repAdminSrc).toContain('roles.includes("manager")');
    expect(kpiFnsSrc).toContain('throw new Error("אין הרשאה לעדכן נתוני מדדים")');
  });
});

// ------------------------------------------------------------- boundaries
describe("boundaries — no hierarchy/worklist/CRM/call-outcome changes", () => {
  it("the changed modules carry no worklist/customer vocabulary", () => {
    for (const src of [importStoreSrc, read("../import-processing.ts")]) {
      for (const term of [
        "worklist",
        "call_outcome",
        "customer_id",
        "next customer",
        "hierarchy",
      ]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
