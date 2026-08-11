// Phase 4 pre-PR hardening.
//
// Three rules that the structural redesign of /teams and /targets must not be
// able to lose again:
//   1. the team CARD's keyboard activation belongs to the card alone — every
//      nested control (row actions, and their portalled confirmation dialogs)
//      keeps its own keyboard behavior;
//   2. the five /teams list controls behave exactly as they did when they lived
//      inline in the route — and there is NO business-unit filter on this page;
//   3. a representative with no personal target still sees their TEAM's real
//      target; a missing personal target hides nothing and fabricates no 0%.
//
// (1) and (2) are behavioral tests over pure functions. (3) is source-pinned:
// the repo's Vitest environment is plain Node with no DOM/render harness, so a
// rendering test is not available here — the assertions therefore target the
// RULE (which branch exposes the team target) rather than markup or styling.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterAndSortTeams,
  NO_MANAGER_FILTER,
  type TeamsFilterRow,
  type TeamsFilterState,
} from "@/lib/teams-overview";
import { isCardSelfActivation } from "@/routes/_authenticated/teams";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
const teamsPage = read("../../routes/_authenticated/teams.tsx");
const targetsPage = read("../../routes/_authenticated/targets.tsx");

// ============================================================ 1. team card

describe("TeamCardSurface keyboard activation — the card, and only the card", () => {
  // The card is the currentTarget of its own handler; a nested button (or a
  // button inside its AlertDialog, which bubbles through the React tree even
  // though it renders in a portal) arrives as a DIFFERENT target.
  const CARD = { id: "card" };
  const NESTED_BUTTON = { id: "delete-button" };

  it("Enter on the focused card opens the details sheet", () => {
    expect(isCardSelfActivation({ key: "Enter", target: CARD, currentTarget: CARD })).toBe(true);
  });

  it("Space on the focused card opens the details sheet", () => {
    expect(isCardSelfActivation({ key: " ", target: CARD, currentTarget: CARD })).toBe(true);
  });

  it("Enter on a nested action does NOT invoke the card handler", () => {
    expect(isCardSelfActivation({ key: "Enter", target: NESTED_BUTTON, currentTarget: CARD })).toBe(
      false,
    );
  });

  it("Space on a nested action does NOT invoke the card handler", () => {
    expect(isCardSelfActivation({ key: " ", target: NESTED_BUTTON, currentTarget: CARD })).toBe(
      false,
    );
  });

  it("a confirmation dialog's button bubbling up from a portal is still nested", () => {
    // Radix renders AlertDialogContent through a portal, but React events
    // bubble along the REACT tree — the confirm/cancel button therefore reaches
    // the card handler with target !== currentTarget, and must be ignored so
    // the confirmation actually runs.
    const CONFIRM = { id: "alert-dialog-action" };
    expect(isCardSelfActivation({ key: "Enter", target: CONFIRM, currentTarget: CARD })).toBe(
      false,
    );
    expect(isCardSelfActivation({ key: " ", target: CONFIRM, currentTarget: CARD })).toBe(false);
  });

  it("keys that are not Enter/Space never activate, even on the card itself", () => {
    for (const key of ["Tab", "Escape", "ArrowDown", "a", "Spacebar"]) {
      expect(isCardSelfActivation({ key, target: CARD, currentTarget: CARD })).toBe(false);
    }
  });

  it("the card handler is gated on that rule, and mouse propagation is still stopped", () => {
    // The guard must come BEFORE preventDefault, or a nested button's
    // activation would be swallowed even though the sheet stays closed.
    expect(teamsPage).toContain("if (!isCardSelfActivation(e)) return;");
    expect(teamsPage).toContain("onClick={(e) => e.stopPropagation()}");
    // No blanket keyboard suppression was added around the nested controls.
    expect(teamsPage).not.toContain("onKeyDown={(e) => e.stopPropagation()}");
  });
});

// ======================================================= 2. /teams controls

type Row = TeamsFilterRow & { id: string; businessUnitId: string | null };

const MANAGER_NAMES = new Map([
  ["m-dana", "דנה כהן"],
  ["m-yossi", "יוסי לוי"],
]);
const resolveManagerName = (id: string) => MANAGER_NAMES.get(id) ?? "—";

const ROWS: Row[] = [
  {
    id: "alpha",
    name: "אלפא",
    department: "Retail",
    description: "צוות ותיק",
    manager_id: "m-dana",
    active: true,
    kpi_profile: "renewals",
    created_at: "2024-01-05",
    member_count: 5,
    businessUnitId: "center-1",
  },
  {
    id: "beta",
    name: "בטא",
    department: null,
    description: null,
    manager_id: "m-yossi",
    active: false,
    kpi_profile: "generic_sales",
    created_at: "2024-03-01",
    member_count: 9,
    businessUnitId: "center-2",
  },
  {
    id: "gamma",
    name: "גמא",
    department: "חידושים",
    description: null,
    manager_id: null,
    active: true,
    // A null profile must behave as the default profile, not as "no profile".
    kpi_profile: null,
    created_at: "2024-02-10",
    member_count: 2,
    businessUnitId: null,
  },
];

const ALL: TeamsFilterState = {
  search: "",
  statusFilter: "all",
  managerFilter: "all",
  profileFilter: "all",
  sortBy: "name",
};
const run = (patch: Partial<TeamsFilterState>) =>
  filterAndSortTeams(ROWS, { ...ALL, ...patch }, resolveManagerName).map((t) => t.id);

describe("/teams search", () => {
  it("matches the team name", () => {
    expect(run({ search: "אלפא" })).toEqual(["alpha"]);
  });

  it("matches the department, case-insensitively and on trimmed input", () => {
    expect(run({ search: "  retail " })).toEqual(["alpha"]);
  });

  it("matches the description", () => {
    expect(run({ search: "ותיק" })).toEqual(["alpha"]);
  });

  it("matches the RESOLVED manager name, not the manager id", () => {
    expect(run({ search: "יוסי" })).toEqual(["beta"]);
    expect(run({ search: "m-yossi" })).toEqual([]);
  });

  it("returns nothing for a term that matches no field", () => {
    expect(run({ search: "לא קיים" })).toEqual([]);
  });

  it("an empty search filters nothing out", () => {
    expect(run({ search: "   " })).toHaveLength(ROWS.length);
  });
});

describe("/teams status filter", () => {
  it("active shows only active teams", () => {
    expect(run({ statusFilter: "active" })).toEqual(["alpha", "gamma"]);
  });
  it("inactive shows only deactivated teams", () => {
    expect(run({ statusFilter: "inactive" })).toEqual(["beta"]);
  });
  it("all shows both", () => {
    expect(run({ statusFilter: "all" })).toHaveLength(3);
  });
});

describe("/teams manager filter", () => {
  it('"ללא מנהל" shows only teams with no teams.manager_id', () => {
    expect(run({ managerFilter: NO_MANAGER_FILTER })).toEqual(["gamma"]);
  });

  it("a specific manager shows only the teams that manager owns", () => {
    expect(run({ managerFilter: "m-dana" })).toEqual(["alpha"]);
    expect(run({ managerFilter: "m-yossi" })).toEqual(["beta"]);
  });

  it("the unmanaged sentinel is a filter VALUE, shared with the page", () => {
    expect(NO_MANAGER_FILTER).toBe("__none__");
    expect(teamsPage).toContain("const NONE = NO_MANAGER_FILTER;");
  });
});

describe("/teams KPI profile filter", () => {
  it("renewals shows only renewals teams", () => {
    expect(run({ profileFilter: "renewals" })).toEqual(["alpha"]);
  });

  it("generic_sales includes a team whose profile is null (the default)", () => {
    expect(run({ profileFilter: "generic_sales" })).toEqual(["beta", "gamma"]);
  });
});

describe("/teams sorting", () => {
  it("by name uses Hebrew collation, ascending", () => {
    expect(run({ sortBy: "name" })).toEqual(["alpha", "beta", "gamma"]);
  });

  it("by creation date shows the newest first", () => {
    expect(run({ sortBy: "created" })).toEqual(["beta", "gamma", "alpha"]);
  });

  it("by member count shows the largest first", () => {
    expect(run({ sortBy: "members" })).toEqual(["beta", "alpha", "gamma"]);
  });

  it("never mutates or reorders the caller's array", () => {
    const before = ROWS.map((t) => t.id);
    filterAndSortTeams(ROWS, { ...ALL, sortBy: "members" }, resolveManagerName);
    expect(ROWS.map((t) => t.id)).toEqual(before);
  });
});

describe("/teams filters combine, and carry no hierarchy filter", () => {
  it("filters intersect before sorting", () => {
    expect(run({ statusFilter: "active", profileFilter: "generic_sales" })).toEqual(["gamma"]);
    // "אלפא" is an ACTIVE team, so the inactive filter must empty the result.
    expect(run({ search: "אלפא", statusFilter: "inactive" })).toEqual([]);
  });

  it("the business unit is never a filter input — teams from every unit stay", () => {
    // /teams is an administration surface: it lists every team the caller may
    // read, regardless of center/activity attachment (including unattached
    // ones). There is no business-unit control and none may be inferred.
    expect(run({})).toEqual(["alpha", "beta", "gamma"]);
    expect(new Set(ROWS.map((t) => t.businessUnitId)).size).toBe(3);
  });

  it("the page still renders exactly the five original controls", () => {
    for (const label of [
      "חיפוש צוותים",
      "סינון לפי סטטוס",
      "סינון לפי מנהל",
      "סינון לפי פרופיל KPI",
      "מיון",
    ]) {
      expect(teamsPage).toContain(`aria-label="${label}"`);
    }
    // The command bar drives the same five pieces of state as before.
    expect(teamsPage).toContain("{ search, statusFilter, managerFilter, profileFilter, sortBy }");
  });
});

// ============================================== 3. representative targets

describe("representative /targets — a missing personal target hides nothing", () => {
  // The read-only representative view, isolated from the manager view below it.
  const view = targetsPage.slice(
    targetsPage.indexOf("function RepresentativeTargetsView()"),
    targetsPage.indexOf("function ManagerAdminTargetsView()"),
  );
  // The branch taken when the representative has NO personal target.
  const noPersonalBranch = view.slice(view.indexOf("hasPersonal ? ("));

  it("isolating the view and its no-personal-target branch actually worked", () => {
    expect(view).toContain("const hasPersonal = myGoal.targetValue !== null;");
    expect(noPersonalBranch.length).toBeGreaterThan(0);
    expect(noPersonalBranch).toContain(") : (");
  });

  it("states the missing personal target instead of showing a number", () => {
    expect(view).toContain("לא הוגדר יעד אישי");
  });

  it("still renders the TEAM's real target when the personal target is missing", () => {
    const elseBranch = noPersonalBranch.slice(noPersonalBranch.indexOf(") : ("));
    expect(elseBranch).toContain("יעד הצוות");
    // The actual official value — not a placeholder, not a copy of the personal
    // target, and not suppressed along with it.
    expect(elseBranch).toContain("formatNum(teamGoal.targetValue as number)");
    // "no team target" is stated only when the TEAM really has none.
    expect(elseBranch).toContain("hasTeam ? (");
    expect(elseBranch).toContain("לא הוגדר יעד חודשי לצוות");
  });

  it("the team target depends on the team's goal alone, never on the personal one", () => {
    expect(view).toContain("const hasTeam = teamGoal.targetValue !== null;");
    expect(view).not.toContain("hasPersonal && hasTeam");
    expect(view).not.toContain("hasTeam && hasPersonal");
  });

  it("fabricates no percentage when there is no personal target", () => {
    // pct/gap are computed only under hasPersonal, so a missing target can
    // never surface as 0%.
    expect(view).toContain(
      "const personalPct = hasPersonal ? calculateAchievement(me.currentResult, myGoal.targetValue as number) : null;",
    );
    expect(view).toContain("personalPct !== null ?");
    expect(view).not.toContain("formatPct(personalPct ?? 0)");
  });

  it("stays read-only — no mutation, no server function, no input", () => {
    expect(view).not.toContain("useMutation");
    expect(view).not.toContain("useServerFn");
    expect(view).not.toContain("<Input");
  });
});
