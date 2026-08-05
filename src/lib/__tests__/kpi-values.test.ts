import { describe, it, expect } from "vitest";
import {
  renewalTotalsForRep, renewalTotalsForMonth, renewalTotalsForDay,
  renewalTotalsForTeamHistorical, renewalTotalsForCurrentRoster, type KpiValueRow,
} from "@/lib/kpi-values";
import { calculateRenewalRate } from "@/lib/renewal-rate";

function row(over: Partial<KpiValueRow>): KpiValueRow {
  return {
    id: "k1", representative_id: "r1", team_id: "t1", metric_date: "2026-08-01",
    renewal_opportunities: null, completed_renewals: null, source_import_id: null,
    ...over,
  };
}

describe("renewalTotalsForRep — dated values, never derived from cumulative totals", () => {
  it("sums opportunities/completed within the given range for one rep", () => {
    const rows = [
      row({ id: "k1", metric_date: "2026-08-01", renewal_opportunities: 10, completed_renewals: 7 }),
      row({ id: "k2", metric_date: "2026-08-02", renewal_opportunities: 5, completed_renewals: 4 }),
      row({ id: "k3", representative_id: "other", metric_date: "2026-08-01", renewal_opportunities: 99, completed_renewals: 99 }),
    ];
    const totals = renewalTotalsForRep("r1", rows, { from: "2026-08-01", to: "2026-08-31" });
    expect(totals).toEqual({ opportunities: 15, completed: 11 });
  });

  it("returns null (not 0) fields when there is no row at all — 'never imported' vs 'genuinely zero'", () => {
    expect(renewalTotalsForRep("r1", [], { from: "2026-08-01" })).toEqual({ opportunities: null, completed: null });
  });

  it("is safe with rows that only have one of the two fields", () => {
    const rows = [row({ renewal_opportunities: 10, completed_renewals: null })];
    const totals = renewalTotalsForRep("r1", rows, { from: "2026-08-01", to: "2026-08-31" });
    expect(totals).toEqual({ opportunities: 10, completed: null });
  });
});

describe("renewalTotalsForMonth / renewalTotalsForDay — real dated snapshots, not cumulative derivation", () => {
  it("a daily figure only includes that day's row, not the whole month", () => {
    const rows = [
      row({ id: "k1", metric_date: "2026-08-01", renewal_opportunities: 10, completed_renewals: 8 }),
      row({ id: "k2", metric_date: "2026-08-02", renewal_opportunities: 3, completed_renewals: 1 }),
    ];
    expect(renewalTotalsForDay("r1", rows, "2026-08-02")).toEqual({ opportunities: 3, completed: 1 });
  });

  it("a monthly figure sums every dated row in that month", () => {
    const rows = [
      row({ id: "k1", metric_date: "2026-08-01", renewal_opportunities: 10, completed_renewals: 8 }),
      row({ id: "k2", metric_date: "2026-08-15", renewal_opportunities: 5, completed_renewals: 3 }),
      row({ id: "k3", metric_date: "2026-07-31", renewal_opportunities: 100, completed_renewals: 100 }), // previous month, excluded
    ];
    expect(renewalTotalsForMonth("r1", rows, new Date("2026-08-20"))).toEqual({ opportunities: 15, completed: 11 });
  });
});

describe("renewalTotalsForCurrentRoster — follows people, for explicitly-labeled current-roster views", () => {
  it("aggregates across every representative id given", () => {
    const rows = [
      row({ id: "k1", representative_id: "r1", metric_date: "2026-08-01", renewal_opportunities: 10, completed_renewals: 8 }),
      row({ id: "k2", representative_id: "r2", metric_date: "2026-08-01", renewal_opportunities: 6, completed_renewals: 2 }),
    ];
    const totals = renewalTotalsForCurrentRoster(["r1", "r2"], rows, { from: "2026-08-01", to: "2026-08-31" });
    expect(totals).toEqual({ opportunities: 16, completed: 10 });
  });

  it("never fabricates a rate when there are no dated values yet", () => {
    const totals = renewalTotalsForCurrentRoster(["r1", "r2"], []);
    const rate = calculateRenewalRate("renewals", totals.completed, totals.opportunities);
    expect(rate).toEqual({ available: false, reason: "no_opportunities" });
  });
});

// §P1 — the defect this whole attribution split exists to fix. kpi_values.team_id
// is a DB-derived, immutable snapshot of the rep's team when the row was
// written (see the kpi_values_team_attribution trigger), so a team's produced
// numbers must be summed by THAT column. The previous implementation summed by
// today's roster instead, which meant transferring a representative moved their
// entire renewal history to the new team on every screen at once.
describe("renewalTotalsForTeamHistorical — attribution does not follow transfers", () => {
  it("sums only rows attributed to the team, regardless of where the rep sits now", () => {
    const rows = [
      row({ id: "k1", representative_id: "r1", team_id: "teamA", metric_date: "2026-08-01", renewal_opportunities: 10, completed_renewals: 8 }),
      row({ id: "k2", representative_id: "r2", team_id: "teamA", metric_date: "2026-08-01", renewal_opportunities: 6, completed_renewals: 2 }),
      row({ id: "k3", representative_id: "r3", team_id: "teamB", metric_date: "2026-08-01", renewal_opportunities: 99, completed_renewals: 99 }),
    ];
    expect(renewalTotalsForTeamHistorical("teamA", rows, { from: "2026-08-01", to: "2026-08-31" }))
      .toEqual({ opportunities: 16, completed: 10 });
  });

  it("a transferred rep's past rows STAY with the team that recorded them", () => {
    // r1 produced 10/8 while on teamA, then moved to teamB and produced 5/4 there.
    const rows = [
      row({ id: "k1", representative_id: "r1", team_id: "teamA", metric_date: "2026-08-01", renewal_opportunities: 10, completed_renewals: 8 }),
      row({ id: "k2", representative_id: "r1", team_id: "teamB", metric_date: "2026-09-01", renewal_opportunities: 5, completed_renewals: 4 }),
    ];
    const range = { from: "2026-08-01", to: "2026-09-30" };
    expect(renewalTotalsForTeamHistorical("teamA", rows, range)).toEqual({ opportunities: 10, completed: 8 });
    expect(renewalTotalsForTeamHistorical("teamB", rows, range)).toEqual({ opportunities: 5, completed: 4 });

    // The current-roster helper deliberately behaves differently: it follows
    // the person, so it attributes ALL of r1's history wherever r1 is today.
    // That is exactly why it must only ever back an explicitly-labeled view.
    expect(renewalTotalsForCurrentRoster(["r1"], rows, range)).toEqual({ opportunities: 15, completed: 12 });
  });

  it("returns null fields (not 0) for a team with no attributed rows", () => {
    expect(renewalTotalsForTeamHistorical("teamZ", [], { from: "2026-08-01" }))
      .toEqual({ opportunities: null, completed: null });
  });
});
