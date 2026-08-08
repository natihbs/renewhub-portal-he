import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ASSIGNED_RENEWAL_RATE_UNAVAILABLE_LABEL,
  ASSIGNED_RENEWALS_LABEL,
  CLOSED_RENEWALS_LABEL,
  PERSONAL_RENEWAL_RATE_LABEL,
  calculateAssignedRenewalRate,
  renewalRateTone,
} from "@/lib/renewal-rate";
import { autoMap } from "@/lib/import-store";

// ---------------------------------------------------------------------------
// Renewals business definition (live-QA clarification): in a renewals team
// each representative receives a monthly ASSIGNED RENEWAL BOOK — "מיועדות
// חודשיות" — and closes part of it ("חידושים שנסגרו"). The official monthly
// goals ARE the assigned book, current_result IS the closed count, and
//   renewal rate = current_result / target_value.
// A missing kpi_values row must never hide a rate the goals and results
// already determine.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const homeSrc = read("../../routes/_authenticated/index.tsx");
const perfSrc = read("../../routes/_authenticated/performance.tsx");
const repWorkspaceSrc = read("../../components/RepWorkspace.tsx");
const commsSrc = read("../../routes/_authenticated/communications.tsx");
const dataImportSrc = read("../../routes/_authenticated/data-import.tsx");
const renewalRateSrc = read("../renewal-rate.ts");

// -------------------------------------------------------------- rate math (A)
describe("A — assigned-based renewal rate is the source of truth", () => {
  it("the live-QA team case: 1,000 assigned, 380 closed → 38%", () => {
    const rate = calculateAssignedRenewalRate("renewals", 380, 1000);
    expect(rate.available).toBe(true);
    if (rate.available) {
      expect(rate.pct).toBe(38);
      expect(rate.assigned).toBe(1000);
      expect(rate.completed).toBe(380);
    }
  });

  it("the Berta case: representative with 250 assigned and 125 closed → 50%", () => {
    const rate = calculateAssignedRenewalRate("renewals", 125, 250);
    expect(rate.available && rate.pct).toBe(50);
  });

  it("needs no kpi_values at all — goals plus current_result are sufficient inputs", () => {
    // The function signature carries only profile/completed/assigned; nothing
    // about imported KPI rows can gate it.
    expect(renewalRateSrc).toContain(
      "export function calculateAssignedRenewalRate(\n  profile: KpiProfile,\n  completed: number,\n  assigned: number | null,\n)",
    );
  });

  it('no assigned denominator (null or 0) is the ONLY "לא זמין" case for a renewals team', () => {
    expect(calculateAssignedRenewalRate("renewals", 380, null)).toEqual({
      available: false,
      reason: "no_assigned",
    });
    expect(calculateAssignedRenewalRate("renewals", 380, 0)).toEqual({
      available: false,
      reason: "no_assigned",
    });
    expect(ASSIGNED_RENEWAL_RATE_UNAVAILABLE_LABEL.no_assigned).toContain("מיועדות חודשיות");
  });

  it("a non-renewals profile never gets a renewal rate", () => {
    expect(calculateAssignedRenewalRate("generic_sales", 380, 1000)).toEqual({
      available: false,
      reason: "profile_not_supported",
    });
  });

  it("zero closed out of a real book is an honest 0%, not unavailable", () => {
    const rate = calculateAssignedRenewalRate("renewals", 0, 1000);
    expect(rate.available && rate.pct).toBe(0);
    expect(renewalRateTone(rate)).toBe("warning");
  });
});

// ------------------------------------------------------------ wiring (A + D)
describe("screens compute the rate from goals + current_result", () => {
  it("ManagerHome: team assigned = teamGoal.targetValue, closed = sum of scoped reps", () => {
    expect(homeSrc).toContain("scopedReps.reduce((a, r) => a + r.currentResult, 0)");
    expect(homeSrc).toContain('calculateAssignedRenewalRate("renewals", completed, assigned)');
    expect(homeSrc).not.toContain("renewalTotalsForTeamHistorical");
  });

  it("/performance: selected team and per-team breakdown use team_goals + rep sums", () => {
    expect(perfSrc).toContain("renewalTeamGoals.goalsByTeamId.get(teamFilter)");
    expect(perfSrc).toContain('calculateAssignedRenewalRate("renewals", completed, assigned)');
    expect(perfSrc).not.toContain("renewalTotalsForTeamHistorical");
  });

  it("RepWorkspace: personal rate = current_result / personal goal", () => {
    expect(repWorkspaceSrc).toContain(
      "calculateAssignedRenewalRate(kpiProfile, rep.currentResult, target ?? null)",
    );
    expect(repWorkspaceSrc).not.toContain("renewalTotalsForMonth");
  });

  it("communications generator uses the already-computed team target/result", () => {
    expect(commsSrc).toContain('calculateAssignedRenewalRate("renewals", t.result, t.target)');
    expect(commsSrc).not.toContain("renewalTotalsForTeamHistorical");
  });
});

// ------------------------------------------------------------ terminology (B/D)
describe("B/D — business terminology", () => {
  it("the shared labels are the business words", () => {
    expect(ASSIGNED_RENEWALS_LABEL).toBe("מיועדות חודשיות");
    expect(CLOSED_RENEWALS_LABEL).toBe("חידושים שנסגרו");
    expect(PERSONAL_RENEWAL_RATE_LABEL).toBe("אחוז חידוש אישי");
  });

  it("renewal cards on home and /performance speak the business language", () => {
    expect(homeSrc).toContain("ASSIGNED_RENEWALS_LABEL");
    expect(homeSrc).toContain("CLOSED_RENEWALS_LABEL");
    expect(perfSrc).toContain("ASSIGNED_RENEWALS_LABEL");
    expect(perfSrc).toContain("CLOSED_RENEWALS_LABEL");
    expect(repWorkspaceSrc).toContain("ASSIGNED_RENEWALS_LABEL");
    // The opportunity-language labels are gone from the renewal cards.
    expect(homeSrc).not.toContain("הזדמנויות חידוש");
    expect(perfSrc).not.toContain("הזדמנויות חידוש");
    expect(repWorkspaceSrc).not.toContain("הזדמנויות חידוש");
    expect(repWorkspaceSrc).not.toContain("חידושים שבוצעו");
  });

  it("representative screens use the personal renewals wording for renewals teams", () => {
    // Conditional on the team's kpi_profile — generic teams keep their labels.
    expect(homeSrc).toContain('isRenewals ? ASSIGNED_RENEWALS_LABEL : "היעד שלי"');
    expect(homeSrc).toContain('isRenewals ? CLOSED_RENEWALS_LABEL : "ביצוע נוכחי"');
    expect(homeSrc).toContain("PERSONAL_RENEWAL_RATE_LABEL");
    expect(perfSrc).toContain('isRenewals ? ASSIGNED_RENEWALS_LABEL : "יעד אישי"');
    expect(perfSrc).toContain('isRenewals ? CLOSED_RENEWALS_LABEL : "ביצוע נוכחי"');
    expect(perfSrc).toContain("PERSONAL_RENEWAL_RATE_LABEL");
  });

  it("the generated communications renewal section uses the business words", () => {
    expect(commsSrc).toContain("מיועדות חודשיות");
    expect(commsSrc).toContain("חידושים שנסגרו");
    expect(commsSrc).toContain("אחוז חידוש");
  });
});

// ---------------------------------------------------------------- import (C)
describe("C — import terminology with backward-compatible aliases", () => {
  it("the preferred Hebrew columns auto-map, and the month column still wins its own header", () => {
    const map = autoMap([
      "שם נציג",
      "צוות",
      "ביצוע נוכחי",
      "חודש",
      "מיועדות חודשיות",
      "חידושים שנסגרו",
    ]);
    // "מיועדות חודשיות" contains "חודש" — the renewal field must win it while
    // the plain month header still maps to the date field.
    expect(map["מיועדות חודשיות"]).toBe("renewalOpportunities");
    expect(map["חידושים שנסגרו"]).toBe("completedRenewals");
    expect(map["חודש"]).toBe("updatedAt");
  });

  it("every backward-compatible alias still maps", () => {
    expect(autoMap(["הזדמנויות חידוש"])["הזדמנויות חידוש"]).toBe("renewalOpportunities");
    expect(autoMap(["כמות מיועדות"])["כמות מיועדות"]).toBe("renewalOpportunities");
    expect(autoMap(["מיועדות"])["מיועדות"]).toBe("renewalOpportunities");
    expect(autoMap(["renewal_opportunities"])["renewal_opportunities"]).toBe(
      "renewalOpportunities",
    );
    expect(autoMap(["חידושים שבוצעו"])["חידושים שבוצעו"]).toBe("completedRenewals");
    expect(autoMap(["completed_renewals"])["completed_renewals"]).toBe("completedRenewals");
  });

  it("the downloadable template prefers the business column names", () => {
    expect(dataImportSrc).toContain('"מיועדות חודשיות"');
    expect(dataImportSrc).toContain('"חידושים שנסגרו"');
  });
});

// ------------------------------------------------------------- boundaries
describe("boundaries — scopes and product surface unchanged", () => {
  it("manager scope stays teams.manager_id and representative scope stays personal", () => {
    const repAdminSrc = read("../rep-admin.functions.ts");
    expect(repAdminSrc).toContain("הוא אינו משויך לצוות שבניהולך");
    const wsSrc = read("../workspace-context.tsx");
    expect(wsSrc).toContain("t.managerId === userId");
  });

  it("no role/hierarchy/worklist/CRM/call-outcome vocabulary in the changed modules", () => {
    for (const src of [renewalRateSrc, commsSrc]) {
      for (const term of ["worklist", "call_outcome", "customer_id", "hierarchy"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
