// A real renewal rate is a distinct metric from target achievement:
//   renewal rate = completed renewals / renewal opportunities
// It must never be derived from monthly_target/current_result — those measure
// achievement against an arbitrary target, not what fraction of renewal
// opportunities actually renewed.
//
// Today no table stores per-rep renewal-opportunity / completed-renewal counts (that
// belongs to the later KPI Values work — see the KPI Engine Architecture Audit), so
// this is intentionally never wired into a screen yet. It exists now, fully tested,
// so a future import/data source can plug in without another correctness pass — and
// so nothing in the meantime can accidentally show a fabricated renewal rate.

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
export function renewalRateTone(rate: RenewalRateResult): Tone | undefined {
  if (!rate.available) return undefined;
  return rate.pct >= RENEWAL_RATE_GOOD_THRESHOLD ? "success" : "warning";
}

/**
 * Only ever returns a value when the team's KPI profile explicitly supports it AND
 * both real inputs are present. A team not marked "renewals", or missing either
 * input, gets an honest "unavailable" result instead of a guess or a zero.
 */
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
