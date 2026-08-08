import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { IMPORT_DUE_LINE, NO_IMPORT_LINE, summariseMonthlyFreshness } from "@/lib/home-domain";

// ---------------------------------------------------------------------------
// Monthly import freshness (live-QA fix): August data imported on 08.08.2026
// carries kpi metric_date 01.08.2026 — a PERIOD MARKER, not an update
// timestamp. The bar must report the reporting period, the real import
// timestamp and the freshness state as three separate facts, and must not
// call current-month data "לא עדכני" just because the period is stored as the
// first of the month.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const homeCardsSrc = read("../../components/HomeCards.tsx");
const homeSrc = read("../../routes/_authenticated/index.tsx");
const homeDomainSrc = read("../home-domain.ts");
const dashboardFnsSrc = read("../dashboard.functions.ts");

const TODAY = "2026-08-08";

// ------------------------------------------------------------- the live case
describe("A — the live-QA case: current-month period imported today is fresh", () => {
  const s = summariseMonthlyFreshness({
    period: "2026-08",
    lastImportAt: "2026-08-08T07:30:00Z",
    lastImportStatus: "success",
    today: TODAY,
  });

  it('status is "עדכני", not "לא עדכני"', () => {
    expect(s.state).toBe("current");
    expect(s.stateLabel).toBe("עדכני");
    expect(s.tone).toBe("success");
    expect(s.stateLabel).not.toBe("לא עדכני");
  });

  it('shows "תקופת נתונים: אוגוסט 2026" instead of an "updated at" claim', () => {
    expect(s.lines).toContain("תקופת נתונים: אוגוסט 2026");
    expect(s.lines.join(" ")).not.toContain("עודכנו לאחרונה");
    expect(s.lines.join(" ")).not.toContain("01.08.2026");
  });

  it('shows the real import timestamp: "ייבוא אחרון: 08.08.2026"', () => {
    expect(s.lines).toContain("ייבוא אחרון: 08.08.2026");
  });

  it("a first-of-month period MARKER (kpi metric_date fallback) reads the same", () => {
    const marker = summariseMonthlyFreshness({
      period: "2026-08-01",
      lastImportAt: "2026-08-08T07:30:00Z",
      lastImportStatus: "success",
      today: TODAY,
    });
    expect(marker.state).toBe("current");
    expect(marker.lines).toContain("תקופת נתונים: אוגוסט 2026");
  });
});

// ------------------------------------------------------------- other states
describe("A/B — the remaining states", () => {
  it('no import at all → "ללא ייבוא" / "טרם בוצע ייבוא נתונים"', () => {
    const s = summariseMonthlyFreshness({
      period: null,
      lastImportAt: null,
      lastImportStatus: null,
      today: TODAY,
    });
    expect(s.state).toBe("no_import");
    expect(s.stateLabel).toBe("ללא ייבוא");
    expect(s.lines).toEqual([NO_IMPORT_LINE]);
    expect(NO_IMPORT_LINE).toBe("טרם בוצע ייבוא נתונים");
    expect(s.tone).toBe("muted");
  });

  it("old period → stale warning explaining the period is not current", () => {
    const s = summariseMonthlyFreshness({
      period: "2026-07",
      lastImportAt: "2026-07-05T10:00:00Z",
      lastImportStatus: "success",
      today: TODAY,
    });
    expect(s.state).toBe("stale_period");
    expect(s.stateLabel).toBe("לא עדכני");
    expect(s.tone).toBe("danger");
    expect(s.lines).toContain("תקופת נתונים אחרונה: יולי 2026");
    expect(s.lines).toContain(IMPORT_DUE_LINE);
    expect(IMPORT_DUE_LINE).toBe("נדרש ייבוא נתונים לחודש הנוכחי");
  });

  it("current period + old import → softer due-check warning, period stated as current", () => {
    const s = summariseMonthlyFreshness({
      period: "2026-08",
      lastImportAt: "2026-08-01T09:00:00Z",
      lastImportStatus: "success",
      today: TODAY,
    });
    expect(s.state).toBe("import_old");
    expect(s.stateLabel).toBe("דורש בדיקה");
    expect(s.tone).toBe("warning");
    // The period is stated as current — never "updated at the period date".
    expect(s.lines).toContain("תקופת נתונים: אוגוסט 2026");
    expect(s.lines).toContain("ייבוא אחרון: 01.08.2026");
    expect(s.lines.join(" ")).not.toContain("עודכנו לאחרונה");
  });

  it("a recent import within the check threshold stays fresh", () => {
    const s = summariseMonthlyFreshness({
      period: "2026-08",
      lastImportAt: "2026-08-06T09:00:00Z",
      lastImportStatus: "success",
      today: TODAY,
    });
    expect(s.state).toBe("current");
  });

  it("a failed last import is introduced as a failure, never as an update", () => {
    const s = summariseMonthlyFreshness({
      period: "2026-08",
      lastImportAt: "2026-08-08T07:30:00Z",
      lastImportStatus: "failed",
      today: TODAY,
    });
    expect(s.lines).toContain("ניסיון הייבוא האחרון נכשל: 08.08.2026");
  });

  it("an import whose reporting period is unknowable says so instead of guessing", () => {
    const s = summariseMonthlyFreshness({
      period: null,
      lastImportAt: "2026-08-08T07:30:00Z",
      lastImportStatus: "success",
      today: TODAY,
    });
    expect(s.state).toBe("unknown_period");
    expect(s.lines).toContain("תקופת הנתונים אינה ידועה");
  });
});

// ------------------------------------------------------------- data sources (C)
describe("C — period vs import timestamp come from the right fields", () => {
  it("the server read prefers import_history.period and keeps created_at as the import moment", () => {
    const fn = dashboardFnsSrc.slice(
      dashboardFnsSrc.indexOf("getPerformanceDataFreshness"),
      dashboardFnsSrc.indexOf("getPerformanceDataFreshness") + 2400,
    );
    expect(fn).toContain('"created_at, status, period"');
    expect(fn).toContain("lastImportPeriod");
    expect(fn).not.toContain('from("representatives")');
  });

  it("the server read tolerates a live DB without the additive period column", () => {
    const fn = dashboardFnsSrc.slice(
      dashboardFnsSrc.indexOf("getPerformanceDataFreshness"),
      dashboardFnsSrc.indexOf("getPerformanceDataFreshness") + 2400,
    );
    // The drift fallback re-reads without the period column.
    expect(fn).toContain('"created_at, status"');
  });

  it("the bar prefers import_history.period and treats metric_date only as a period marker", () => {
    expect(homeCardsSrc).toContain("q.data?.lastImportPeriod ?? q.data?.sourceDataDate ?? null");
  });

  it("metric_date is never rendered as a last-updated timestamp", () => {
    expect(homeCardsSrc).not.toContain("הנתונים עודכנו לאחרונה ב־");
  });

  it("the domain summary never counts period-marker days as data age", () => {
    // Day-counting applies only to the IMPORT timestamp, not to the period.
    expect(homeDomainSrc).toContain("daysBetweenIso(input.lastImportAt.slice(0, 10), input.today)");
    expect(homeDomainSrc).not.toContain("daysBetweenIso(input.period");
  });
});

// ------------------------------------------------------------- boundaries (D/E)
describe("D/E — surface and scope boundaries", () => {
  it("RepresentativeHome still renders no DataFreshnessBar", () => {
    const repHome = homeSrc.slice(
      homeSrc.indexOf("function RepresentativeHome"),
      homeSrc.indexOf("function TopPerformersCard"),
    );
    expect(repHome).not.toContain("DataFreshnessBar");
  });

  it("manager and admin homes keep the bar", () => {
    expect(homeSrc).toContain("<DataFreshnessBar");
  });

  it("no role/hierarchy/worklist/CRM/call-outcome vocabulary entered the changed modules", () => {
    for (const src of [homeCardsSrc, homeDomainSrc, dashboardFnsSrc]) {
      for (const term of ["worklist", "call_outcome", "customer_id", "hierarchy"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
