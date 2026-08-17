// PHASE 6 presentation polish — the scope-wide Home must not contradict
// itself.
//
// A business-scope manager's Home (center / activity / executive) shows the
// COMPLETE resolved scope: the hero says so, and the boards list every covered
// unit. Three page elements were still captioning or narrowing that page by a
// single selected team: the top workspace selector, the data-freshness bar and
// the recent-activity feed. These tests pin the fix — and pin that everyone
// else's behavior did not move: a plain team manager, a representative, the
// admin (in every view mode), and every non-Home route.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workspaceSelectorBehavior } from "../navigation-config";
import {
  centersWithoutTeamsLabel,
  repsMissingPersonalTargetLabel,
  SCOPE_SELECTED_TEAM_SECTION_TITLE,
} from "../scope-home";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const homeSrc = read("../../routes/_authenticated/index.tsx");
const shellSrc = read("../../components/layout/AppShell.tsx");
const cardsSrc = read("../../components/ScopeHomeCards.tsx");

// ------------------------------------------------- Home workspace selector

describe("workspace selector on the scope-wide Home", () => {
  // B / C / D — the selector is not presented as the page scope on "/".
  for (const kind of ["center", "activity", "executive"] as const) {
    it(`${kind} manager's Home hides the selector`, () => {
      expect(
        workspaceSelectorBehavior({
          realRole: "manager",
          viewRole: "manager",
          pathname: "/",
          businessScopeKind: kind,
        }),
      ).toBe("hidden");
    });
  }

  // A — a plain team manager keeps the existing team-specific Home.
  it("a team manager's Home keeps the existing selector behavior", () => {
    for (const kind of ["team_manager", null, undefined] as const) {
      expect(
        workspaceSelectorBehavior({
          realRole: "manager",
          viewRole: "manager",
          pathname: "/",
          businessScopeKind: kind,
        }),
      ).toBe("existing");
    }
  });

  // G — every operational route keeps the selector for scoped managers.
  it("scoped managers keep the selector everywhere EXCEPT Home", () => {
    for (const pathname of ["/performance", "/targets", "/teams", "/feedback", "/data-import"]) {
      expect(
        workspaceSelectorBehavior({
          realRole: "manager",
          viewRole: "manager",
          pathname,
          businessScopeKind: "executive",
        }),
      ).toBe("existing");
    }
  });

  it("a representative is untouched", () => {
    expect(
      workspaceSelectorBehavior({
        realRole: "representative",
        viewRole: "representative",
        pathname: "/",
        businessScopeKind: "representative",
      }),
    ).toBe("existing");
  });

  // Admin behavior is unchanged in every mode — and a presentation view mode
  // can never borrow a business scope: the admin branch runs first, whatever
  // scope kind is passed in.
  it("admin behavior is unchanged, even with a scope kind supplied", () => {
    const base = { realRole: "admin" as const, businessScopeKind: "executive" };
    expect(workspaceSelectorBehavior({ ...base, viewRole: "admin", pathname: "/" })).toBe("hidden");
    expect(workspaceSelectorBehavior({ ...base, viewRole: "admin", pathname: "/users" })).toBe(
      "existing",
    );
    expect(workspaceSelectorBehavior({ ...base, viewRole: "manager", pathname: "/" })).toBe(
      "teams-only",
    );
    expect(workspaceSelectorBehavior({ ...base, viewRole: "representative", pathname: "/" })).toBe(
      "hidden",
    );
  });

  it("the switcher feeds the rule the SERVER-resolved scope of the real account", () => {
    expect(shellSrc).toContain("businessScopeKind: scope?.kind ?? null");
    // The kind comes from useBusinessScope — the resolved scope — not from a
    // view mode or a client-side label.
    expect(shellSrc).toContain("const { scope } = useBusinessScope();");
  });
});

// ------------------------------------------- Home freshness/activity scope

describe("Home data scope matches the Home page scope", () => {
  // E — freshness is scope-wide for a scoped manager, team-bound otherwise.
  it("freshness: scoped manager → null team scope; team manager → selected team", () => {
    expect(homeSrc).toContain(
      "<DataFreshnessBar teamId={scopedManager ? null : workspaceTeamId} />",
    );
  });

  // F — the activity feed cannot silently follow a hidden selected team.
  it("recent activity: scoped manager Homes request the scope-wide feed", () => {
    // structureFirst rail (activity + executive) is always scoped.
    expect(homeSrc).toContain("<RecentActivityCard teamId={null} />");
    // The shared rail serves the center manager (scoped → null) AND the plain
    // team manager (undefined → follow the workspace, exactly as before).
    expect(homeSrc).toContain("<RecentActivityCard teamId={scopedManager ? null : undefined} />");
  });

  it("the override prop distinguishes 'scope-wide' (null) from 'follow workspace' (undefined)", () => {
    expect(homeSrc).toContain("{ teamId: teamIdOverride }: { teamId?: string | null } = {}");
    const flat = homeSrc.replace(/\s+/g, " ");
    expect(flat).toContain(
      'teamIdOverride !== undefined ? teamIdOverride : workspace.type === "team" ? workspace.teamId : null',
    );
  });

  it("the admin Home feed is untouched (no override passed)", () => {
    // AdminHome still renders the bare card — undefined → workspace-driven.
    const adminHome = homeSrc.slice(
      homeSrc.indexOf("function AdminHome"),
      homeSrc.indexOf("function ManagerHome"),
    );
    expect(adminHome).toContain("<RecentActivityCard />");
    expect(adminHome).not.toContain("<RecentActivityCard teamId=");
  });
});

// ------------------------------------------------------- team drill-down

describe("team drill-down survives the hidden selector", () => {
  // H — the boards still set the workspace team, and the selected-team panel
  // still reads it.
  it("hierarchy boards still select a team into the workspace", () => {
    expect(homeSrc).toContain("onSelectTeam={setWorkspaceTeam}");
    expect(homeSrc).toContain("SCOPE_SELECTED_TEAM_SECTION_TITLE");
    expect(SCOPE_SELECTED_TEAM_SECTION_TITLE).toBe("פירוט הצוות הנבחר");
    // The row-level drill-down button on the boards is intact.
    expect(cardsSrc).toContain("פירוט");
  });
});

// ------------------------------------------------------------ count labels

describe("count-label grammar", () => {
  // I — personal-target wording, singular and plural.
  it("representatives missing a personal target", () => {
    expect(repsMissingPersonalTargetLabel(1)).toBe("1 נציג ללא יעד אישי");
    expect(repsMissingPersonalTargetLabel(9)).toBe("9 נציגים ללא יעד אישי");
  });

  // J — centers-without-teams wording, singular and plural.
  it("centers without teams", () => {
    expect(centersWithoutTeamsLabel(1)).toBe("1 מוקד ללא צוותים");
    expect(centersWithoutTeamsLabel(2)).toBe("2 מוקדים ללא צוותים");
  });

  it("every surface that counts missing PERSONAL targets says so", () => {
    // The three ambiguous "‹n› ללא יעד" badges now go through the helper —
    // team row, center surface and executive activity surface alike.
    expect(cardsSrc).toContain("repsMissingPersonalTargetLabel(row.missingTargets)");
    expect(cardsSrc).toContain(
      "repsMissingPersonalTargetLabel(center.missingRepresentativeTargets)",
    );
    expect(cardsSrc).toContain(
      "repsMissingPersonalTargetLabel(activity.missingRepresentativeTargets)",
    );
    expect(cardsSrc).toContain("centersWithoutTeamsLabel(activity.centersWithoutTeams)");
    // The bare ambiguous form is gone from these cards.
    expect(cardsSrc).not.toMatch(/\{[a-zA-Z.]+\} ללא יעד\n/);
  });
});
