import { describe, it, expect } from "vitest";
import { paceInfo, NO_TIME_REMAINING_LABEL } from "@/lib/performance-domain";
import { deriveFreshnessStatus, type FreshnessSourceResult } from "@/lib/morning-store";
import { isMetricEditAllowedForInactiveRep } from "@/lib/rep-admin.functions";
import { matchImportRow, type ImportMatchCandidate } from "@/lib/import-processing";

// ---------------------------------------------------------------------------
// §P3 — zero working days remaining
// ---------------------------------------------------------------------------
// paceInfo used to compute perDay as
//     Math.ceil((target - actual) / Math.max(1, workdaysRemaining))
// so on the last working day of the month, with workdaysRemaining already 0,
// it divided by a synthetic 1 and displayed a confident, arithmetically
// impossible daily rate ("142/יום") for a period that was already over.
describe("paceInfo — no working days remaining is a distinct state, not a fake rate", () => {
  it("returns a real achievable rate while the period is still active", () => {
    const p = paceInfo(100, 40, 20, 10, 10);
    expect(p.periodState).toBe("active");
    expect(p.perDay).toBe(6); // ceil(60 / 10)
  });

  it("returns null perDay and no_time_remaining when zero working days are left", () => {
    const p = paceInfo(100, 40, 20, 20, 0);
    expect(p.periodState).toBe("no_time_remaining");
    expect(p.perDay).toBeNull();
  });

  it("treats a negative remaining count as expired too, never as one synthetic day", () => {
    const p = paceInfo(100, 40, 20, 21, -1);
    expect(p.periodState).toBe("no_time_remaining");
    expect(p.perDay).toBeNull();
  });

  it("still reports expired when the target was already met — the period is over either way", () => {
    const p = paceInfo(100, 120, 20, 20, 0);
    expect(p.periodState).toBe("no_time_remaining");
    expect(p.perDay).toBeNull();
  });

  it("exactly one remaining day is still active and yields the full outstanding gap", () => {
    const p = paceInfo(100, 40, 20, 19, 1);
    expect(p.periodState).toBe("active");
    expect(p.perDay).toBe(60);
  });

  it("has an honest label available for the expired state", () => {
    expect(NO_TIME_REMAINING_LABEL).toContain("לא נותרו ימי עבודה");
  });
});

// ---------------------------------------------------------------------------
// §P0 — Morning Routine freshness status
// ---------------------------------------------------------------------------
// The old simulateRefresh() wrote refresh_status = "complete" unconditionally,
// without refetching anything, and could not fail. The status must now be
// EARNED: derived from real per-source outcomes.
describe("deriveFreshnessStatus — 'complete' must be earned, never assumed", () => {
  const ok = (key: string): FreshnessSourceResult => ({ key: key as FreshnessSourceResult["key"], ok: true });
  const bad = (key: string): FreshnessSourceResult => ({ key: key as FreshnessSourceResult["key"], ok: false, error: "boom" });

  it("every source refreshed -> complete", () => {
    expect(deriveFreshnessStatus([ok("representatives"), ok("kpi_values"), ok("feedback")])).toBe("complete");
  });

  it("one source failed -> partial, never complete", () => {
    expect(deriveFreshnessStatus([ok("representatives"), bad("kpi_values"), ok("feedback")])).toBe("partial");
  });

  it("all sources failed -> failed", () => {
    expect(deriveFreshnessStatus([bad("representatives"), bad("kpi_values")])).toBe("failed");
  });

  it("a single failing source is enough to deny 'complete' — the exact stale-data case", () => {
    const many = [ok("representatives"), ok("representative_goals"), ok("team_goals"), ok("feedback"), bad("kpi_values")];
    expect(deriveFreshnessStatus(many)).not.toBe("complete");
    expect(deriveFreshnessStatus(many)).toBe("partial");
  });

  it("checking nothing is not success", () => {
    expect(deriveFreshnessStatus([])).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Product policy — editing an INACTIVE representative's metrics
// ---------------------------------------------------------------------------
// Deactivation is not deletion: history stays correctable. What it must stop
// is new day-to-day operational activity being recorded against someone who
// is no longer working — reactivation is the route for that.
describe("isMetricEditAllowedForInactiveRep — source-aware, not blanket allow/deny", () => {
  it("a normal manual operational edit is blocked", () => {
    expect(isMetricEditAllowedForInactiveRep("manual")).toBe(false);
  });

  it("a plain import is blocked — it must route through the explicit reactivate choice", () => {
    expect(isMetricEditAllowedForInactiveRep("import")).toBe(false);
  });

  it("an explicit historical correction is allowed (and audited)", () => {
    expect(isMetricEditAllowedForInactiveRep("historical_correction")).toBe(true);
  });

  it("import reconciliation (e.g. import undo restoring prior values) is allowed", () => {
    expect(isMetricEditAllowedForInactiveRep("import_reconciliation")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §P1 — import matching must see INACTIVE representatives
// ---------------------------------------------------------------------------
// Matching against the active-only mirror meant a row naming a deactivated
// representative matched nothing, fell through to "create", and produced a
// duplicate active record with zeroed history.
describe("matchImportRow — precedence and inactive visibility", () => {
  const active: ImportMatchCandidate = { id: "r-active", name: "דנה כהן", externalRef: "E-100", active: true, teamId: "t1" };
  const inactive: ImportMatchCandidate = { id: "r-inactive", name: "יוסי לוי", externalRef: "E-200", active: false, teamId: "t1" };
  const candidates = [active, inactive];

  it("matches an active representative by exact normalized name", () => {
    const m = matchImportRow("דנה כהן", null, candidates);
    expect(m?.candidate.id).toBe("r-active");
    expect(m?.matchedBy).toBe("name");
  });

  it("DETECTS a deactivated representative instead of returning no match", () => {
    const m = matchImportRow("יוסי לוי", null, candidates);
    expect(m?.candidate.id).toBe("r-inactive");
    expect(m?.candidate.active).toBe(false);
  });

  it("external_ref wins over name — it survives a rename, and is UNIQUE where non-null", () => {
    // File says the name is "שם אחר לגמרי" but carries E-200, which belongs to
    // the inactive rep. The identifier must win.
    const m = matchImportRow("שם אחר לגמרי", "E-200", candidates);
    expect(m?.candidate.id).toBe("r-inactive");
    expect(m?.matchedBy).toBe("external_ref");
  });

  it("same name with a DIFFERENT external ref resolves by the ref, not the name", () => {
    const m = matchImportRow("דנה כהן", "E-200", candidates);
    expect(m?.candidate.id).toBe("r-inactive");
    expect(m?.matchedBy).toBe("external_ref");
  });

  it("falls back to name when the row's external ref matches nobody", () => {
    const m = matchImportRow("דנה כהן", "E-UNKNOWN", candidates);
    expect(m?.candidate.id).toBe("r-active");
    expect(m?.matchedBy).toBe("name");
  });

  it("returns null when nothing matches — the only case that may legitimately create", () => {
    expect(matchImportRow("מישהו חדש", null, candidates)).toBeNull();
  });

  it("an empty/whitespace external ref does not match a candidate with a real ref", () => {
    const m = matchImportRow("מישהו חדש", "   ", candidates);
    expect(m).toBeNull();
  });
});
