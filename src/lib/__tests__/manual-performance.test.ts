import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MANUAL_UPDATE_REASONS,
  MANUAL_UPDATE_SUCCESS_MESSAGE,
  STALE_DATA_HINT,
} from "@/lib/performance-domain";

// ---------------------------------------------------------------------------
// "עדכון ביצועים ידני" — the audited manager fallback for the current-month
// performance figure. These tests pin the copy, the permission path, the
// current_result-only write, the audit shape, the inactive-rep block, and the
// simplified manager screens — plus the product boundary: this is not a CRM,
// queue, or call-outcome workflow.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const dialogSrc = read("../../components/ManualPerformanceDialog.tsx");
const repAdminSrc = read("../rep-admin.functions.ts");
const performanceSrc = read("../../routes/_authenticated/performance.tsx");
const homeSrc = read("../../routes/_authenticated/index.tsx");

describe("manual update reasons and copy", () => {
  it("offers exactly the four required reasons, in order", () => {
    expect(MANUAL_UPDATE_REASONS.map((r) => r.label)).toEqual([
      "ייבוא / Qlik לא התעדכן",
      "תיקון נתון שגוי",
      "עדכון זמני לבקרה",
      "אחר",
    ]);
  });

  it("uses stable ASCII values with Hebrew labels — values are audited, labels are shown", () => {
    for (const r of MANUAL_UPDATE_REASONS) {
      expect(r.value).toMatch(/^[a-z_]+$/);
      expect(r.label).toMatch(/[֐-׿]|Qlik/);
    }
  });

  it("pins the success toast and the stale-data hint verbatim", () => {
    expect(MANUAL_UPDATE_SUCCESS_MESSAGE).toBe("הביצוע עודכן ידנית");
    expect(STALE_DATA_HINT).toBe(
      "הנתונים מבוססים על הייבוא האחרון. אם הנתונים לא התעדכנו, ניתן להשתמש בעדכון ביצועים ידני.",
    );
  });
});

describe("permissions (source-pinned against the real server path)", () => {
  it("the dialog saves through updateRepresentativeMetrics — the audited, authorized path", () => {
    expect(dialogSrc).toContain("updateRepresentativeMetrics");
  });

  it("assertCanEdit admits an admin for any rep, a manager only via their RLS-scoped read, and nobody else", () => {
    expect(repAdminSrc).toContain('if (roles.includes("admin")) return { isAdmin: true };');
    expect(repAdminSrc).toContain(
      'if (!roles.includes("manager")) throw new Error("אין לך הרשאה לעדכן נציגים");',
    );
    // The manager check is the RLS-scoped read — teams.manager_id decides, not the client.
    expect(repAdminSrc).toContain("הוא אינו משויך לצוות שבניהולך");
  });

  it("the write authorizes against the real authenticated role — the admin view switcher never reaches the server", () => {
    // Presentation-mode state lives in sessionStorage on the client; the server
    // function file must not know it exists.
    expect(repAdminSrc).not.toContain("admin-view");
    expect(repAdminSrc).not.toContain("AdminViewMode");
    expect(dialogSrc).not.toContain("useAdminView");
  });
});

describe("current_result only — targets stay on /targets", () => {
  it("the dialog sends current_result and never a target, name, or team change", () => {
    expect(dialogSrc).toContain("current_result: Math.round(parsed)");
    expect(dialogSrc).not.toContain("monthly_target");
    expect(dialogSrc).not.toContain("team_id");
    expect(dialogSrc).toContain('source: "manual"');
  });

  it("the dialog says so to the user, in Hebrew", () => {
    expect(dialogSrc).toContain("יעדים אישיים וצוותיים מנוהלים בעמוד היעדים");
  });
});

describe("audit shape", () => {
  it("records reason, note and the numeric delta alongside old/new, screen and actor path", () => {
    expect(repAdminSrc).toContain("manual_reason: data.manual_reason ?? null");
    expect(repAdminSrc).toContain("manual_note: data.manual_note ?? null");
    expect(repAdminSrc).toContain("current_result_delta:");
    expect(repAdminSrc).toContain("source_screen: data.source_screen ?? null");
    // old/new already recorded via before/after blocks:
    expect(repAdminSrc).toContain("current_result: before.current_result");
  });

  it("rejects a reason outside the fixed list", () => {
    expect(repAdminSrc).toContain('throw new Error("סיבת עדכון לא חוקית")');
  });

  it("manual updates surface in the admin activity feed", () => {
    const dashboardFns = read("../dashboard.functions.ts");
    expect(dashboardFns).toContain('"rep.metrics_update"');
  });
});

describe("inactive representative stays blocked", () => {
  it("the source-aware policy and its Hebrew block message are untouched", () => {
    expect(repAdminSrc).toContain("INACTIVE_REP_METRIC_EDIT_BLOCKED_MESSAGE");
    expect(repAdminSrc).toContain("לא ניתן לעדכן נתוני ביצוע שוטפים");
  });

  it("the dialog uses source manual — the exact source the inactive policy blocks", () => {
    expect(dialogSrc).toContain('source: "manual"');
  });
});

describe("simplified manager screens still carry the core", () => {
  it("ManagerHome: freshness, team card and pace stay primary; secondary sections are collapsed", () => {
    const managerHome = homeSrc.slice(
      homeSrc.indexOf("function ManagerHome"),
      homeSrc.indexOf("function RepresentativeHome"),
    );
    const order = ["DataFreshnessBar", "TeamCard", "TeamPaceCard", "CollapsibleSection"].map(
      (token) => managerHome.indexOf(token),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Nothing removed — every previous section still renders inside a fold.
    for (const kept of [
      "MorningRoutine",
      "InsightsCard",
      "TopPerformersCard",
      "TeamFeedbackCard",
      "TeamCompetitionsCard",
      "AnnouncementsCard",
      "RecentActivityCard",
      "ContentShortcutsRow",
    ]) {
      expect(managerHome).toContain(kept);
    }
    expect(managerHome).toContain("עדכון ביצועים ידני");
  });

  it("/performance: manual update is a prominent header action AND a per-row action, with the stale hint", () => {
    expect(performanceSrc).toContain('sourceScreen="performance-header"');
    expect(performanceSrc).toContain('sourceScreen="performance-row"');
    expect(performanceSrc).toContain("STALE_DATA_HINT");
    expect(performanceSrc).toContain("CollapsibleSection");
  });
});

describe("product boundary — no CRM/queue/call-outcome surface", () => {
  it("the new files carry no worklist/queue/customer-workflow vocabulary", () => {
    for (const src of [dialogSrc, read("../../components/ui/collapsible-section.tsx")]) {
      for (const term of ["worklist", "queue", "call_outcome", "customer_id", "next customer"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
