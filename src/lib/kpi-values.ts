// Client-side shape and aggregation for public.kpi_values — the dated,
// activity-specific values table (see the migration for why this is a separate
// dated table rather than more columns on representatives). Renewal rate must
// always be read from here (completed_renewals / renewal_opportunities), never
// derived from monthly_target/current_result.

export type KpiValueRow = {
  id: string;
  representative_id: string;
  team_id: string | null;
  metric_date: string; // YYYY-MM-DD
  renewal_opportunities: number | null;
  completed_renewals: number | null;
  source_import_id: string | null;
};

export type RenewalTotals = {
  opportunities: number | null;
  completed: number | null;
};

/** First day of the current calendar month, as YYYY-MM-DD (matches monthly_target's implicit monthly cadence). */
export function currentMonthStart(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Today, as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Sums renewal_opportunities/completed_renewals for one representative across the
 * given date range (inclusive `from`, inclusive `to`). Returns `null` for a field
 * (not 0) when there is no real row covering the range at all, so a caller can
 * tell "genuinely zero" apart from "never imported" — the same distinction
 * calculateRenewalRate relies on to avoid fabricating a rate.
 */
export function renewalTotalsForRep(
  repId: string,
  rows: KpiValueRow[],
  range: { from: string; to?: string } = { from: currentMonthStart() },
): RenewalTotals {
  const to = range.to ?? "9999-12-31";
  const list = rows.filter((r) => r.representative_id === repId && r.metric_date >= range.from && r.metric_date <= to);
  if (list.length === 0) return { opportunities: null, completed: null };
  const withOpportunities = list.filter((r) => r.renewal_opportunities != null);
  const withCompleted = list.filter((r) => r.completed_renewals != null);
  return {
    opportunities: withOpportunities.length > 0 ? withOpportunities.reduce((s, r) => s + (r.renewal_opportunities ?? 0), 0) : null,
    completed: withCompleted.length > 0 ? withCompleted.reduce((s, r) => s + (r.completed_renewals ?? 0), 0) : null,
  };
}

/** Current-month totals for a representative — the default period used across Performance/Dashboard/Communications. */
export function renewalTotalsForMonth(repId: string, rows: KpiValueRow[], now = new Date()): RenewalTotals {
  return renewalTotalsForRep(repId, rows, { from: currentMonthStart(now) });
}

/** A single day's totals — for a real daily summary, never derived from the cumulative month. */
export function renewalTotalsForDay(repId: string, rows: KpiValueRow[], day = todayIso()): RenewalTotals {
  return renewalTotalsForRep(repId, rows, { from: day, to: day });
}

/** Sums totals for every representative on a team (by id) across the given rows/range. */
export function renewalTotalsForTeam(
  repIds: string[],
  rows: KpiValueRow[],
  range: { from: string; to?: string } = { from: currentMonthStart() },
): RenewalTotals {
  const perRep = repIds.map((id) => renewalTotalsForRep(id, rows, range));
  const withOpportunities = perRep.filter((t) => t.opportunities != null);
  const withCompleted = perRep.filter((t) => t.completed != null);
  return {
    opportunities: withOpportunities.length > 0 ? withOpportunities.reduce((s, t) => s + (t.opportunities ?? 0), 0) : null,
    completed: withCompleted.length > 0 ? withCompleted.reduce((s, t) => s + (t.completed ?? 0), 0) : null,
  };
}
