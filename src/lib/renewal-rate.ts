// Renewal rate for a renewals-profile team, per the clarified business model:
// each representative receives a monthly ASSIGNED RENEWAL BOOK ("מיועדות
// חודשיות"), and closes some of it ("חידושים שנסגרו").
//
//   renewal rate = closed renewals / assigned renewals
//
// For kpi_profile = "renewals" the official monthly goals ARE the assigned
// book: representative_goals.target_value is the rep's מיועדות and
// team_goals.target_value is the team's total; representatives.current_result
// is the closed count. calculateAssignedRenewalRate below is therefore the
// SOURCE OF TRUTH for every displayed renewal rate. (The earlier rule that a
// rate "must never come from target/result" predated this clarification and
// applied to GENERIC sales targets — for a renewals team the target IS the
// denominator by definition.)
//
// Imported kpi_values (renewal_opportunities / completed_renewals) remain an
// additional imported KPI record — kept, importable and audited — but a
// missing kpi_values row never hides a renewal rate the goals and results
// already determine: calculateRenewalRate stays for that imported dataset,
// while screens display the assigned-based rate.

import type { KpiProfile, Tone } from "./performance-domain";

export type RenewalRateUnavailableReason =
  | "profile_not_supported"
  | "no_opportunities"
  | "no_completed_data";

export type RenewalRateResult =
  | { available: true; pct: number }
  | { available: false; reason: RenewalRateUnavailableReason };

export const RENEWAL_RATE_UNAVAILABLE_LABEL: Record<RenewalRateUnavailableReason, string> = {
  profile_not_supported: "אחוז חידוש אינו רלוונטי לצוות זה",
  no_opportunities: "אין עדיין נתוני הזדמנויות חידוש לצוות זה",
  no_completed_data: "אין עדיין נתוני חידושים שהושלמו לצוות זה",
};

/** Below this, a renewal rate reads as needing attention rather than healthy — the single source of truth, never re-typed at each call site. */
export const RENEWAL_RATE_GOOD_THRESHOLD = 80;

/** Tone for displaying an available renewal rate — undefined only when the rate isn't available at all (the caller decides what "unavailable" looks like). */
export function renewalRateTone(rate: RenewalRateResult | AssignedRenewalRateResult): Tone | undefined {
  if (!rate.available) return undefined;
  return rate.pct >= RENEWAL_RATE_GOOD_THRESHOLD ? "success" : "warning";
}

/**
 * Only ever returns a value when the team's KPI profile explicitly supports it AND
 * both real inputs are present. A team not marked "renewals", or missing either
 * input, gets an honest "unavailable" result instead of a guess or a zero.
 */
// ---------------------------------------------------------------------------
// Assigned-based renewal rate — the displayed source of truth
// ---------------------------------------------------------------------------

export const ASSIGNED_RENEWALS_LABEL = "מיועדות חודשיות";
export const CLOSED_RENEWALS_LABEL = "חידושים שנסגרו";
export const PERSONAL_RENEWAL_RATE_LABEL = "אחוז חידוש אישי";

export type AssignedRenewalRateResult =
  | { available: true; pct: number; assigned: number; completed: number }
  | { available: false; reason: "profile_not_supported" | "no_assigned" };

export const ASSIGNED_RENEWAL_RATE_UNAVAILABLE_LABEL: Record<
  "profile_not_supported" | "no_assigned",
  string
> = {
  profile_not_supported: "אחוז חידוש אינו רלוונטי לצוות זה",
  no_assigned: "לא הוגדרו מיועדות חודשיות לחודש זה — אחוז חידוש יחושב לאחר הגדרת היעד",
};

/**
 * closed / assigned, available whenever the profile is "renewals" and an
 * assigned denominator exists (> 0). "לא זמין" is ONLY the no-denominator
 * case — a team with a monthly goal and results always gets its rate, with
 * or without imported kpi_values.
 */
export function calculateAssignedRenewalRate(
  profile: KpiProfile,
  completed: number,
  assigned: number | null,
): AssignedRenewalRateResult {
  if (profile !== "renewals") return { available: false, reason: "profile_not_supported" };
  if (assigned == null || assigned <= 0) return { available: false, reason: "no_assigned" };
  return { available: true, pct: (completed / assigned) * 100, assigned, completed };
}

export function calculateRenewalRate(
  profile: KpiProfile,
  completedRenewals: number | null,
  renewalOpportunities: number | null,
): RenewalRateResult {
  if (profile !== "renewals") return { available: false, reason: "profile_not_supported" };
  if (renewalOpportunities == null || renewalOpportunities <= 0) {
    return { available: false, reason: "no_opportunities" };
  }
  if (completedRenewals == null) return { available: false, reason: "no_completed_data" };
  return { available: true, pct: (completedRenewals / renewalOpportunities) * 100 };
}
