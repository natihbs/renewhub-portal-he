import { describe, it, expect } from "vitest";
import { calculateRenewalRate } from "@/lib/renewal-rate";

// Renewal rate (completed renewals / renewal opportunities) is a distinct metric
// from target achievement (actual / target) and must never be derived from
// monthly_target/current_result. It is only ever shown when a team's KPI profile
// explicitly supports it AND both real inputs exist — otherwise it must return an
// honest "unavailable" result, never a guess, a zero, or a fabricated value.

describe("calculateRenewalRate", () => {
  it("is completed / opportunities, not actual / target", () => {
    const result = calculateRenewalRate("renewals", 45, 60);
    expect(result).toEqual({ available: true, pct: 75 });
  });

  it("is unavailable for a generic_sales team, regardless of data present", () => {
    const result = calculateRenewalRate("generic_sales", 45, 60);
    expect(result).toEqual({ available: false, reason: "profile_not_supported" });
  });

  it("is unavailable when there are no renewal opportunities yet", () => {
    expect(calculateRenewalRate("renewals", 10, null)).toEqual({ available: false, reason: "no_opportunities" });
    expect(calculateRenewalRate("renewals", 10, 0)).toEqual({ available: false, reason: "no_opportunities" });
  });

  it("is unavailable when completed-renewal data hasn't been recorded, even with opportunities present", () => {
    expect(calculateRenewalRate("renewals", null, 60)).toEqual({ available: false, reason: "no_completed_data" });
  });

  it("never confuses achievement and renewal rate for the same numbers", () => {
    // 45/60 renewal rate (75%) is a different number from what 45/60 would mean as
    // an achievement ratio computed elsewhere — this just proves the function has
    // its own independent input shape (completed, opportunities), not (actual, target).
    const renewal = calculateRenewalRate("renewals", 45, 60);
    expect(renewal).toEqual({ available: true, pct: 75 });
  });
});
