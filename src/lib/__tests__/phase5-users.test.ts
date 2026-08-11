// Phase 5 — /users as a people & access management workspace.
//
// The derivations under test are counts and list controls over rows listUsers
// already returned. Two rules govern them and are asserted here directly:
//   * health is never redefined — computeUserHealth stays the only algorithm
//     and these counts merely tally its output;
//   * a business title is DISPLAY only — it is searchable, and it is never a
//     technical role, never a filter value, never stored.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  auditDetailChips,
  filterAndSortUsers,
  hasAuditDetails,
  hasEverLoggedIn,
  summarizeUsers,
  USERS_SORT_OPTIONS,
  USERS_SUMMARY_SCOPE_LABEL,
  type UsersFilterRow,
  type UsersFilterState,
  type UsersOverviewInput,
} from "@/lib/users-overview";
import { isSelfActivation } from "@/lib/keyboard-activation";

const usersPage = readFileSync(resolve(__dirname, "../../routes/_authenticated/users.tsx"), "utf8");

// ------------------------------------------------------------- summary band

const U = (over: Partial<UsersOverviewInput>): UsersOverviewInput => ({
  active: true,
  roles: [],
  last_login_at: null,
  auth_last_sign_in_at: null,
  representative_link: null,
  health: { status: "healthy" },
  ...over,
});

const PEOPLE: UsersOverviewInput[] = [
  // an admin who logs in
  U({ roles: ["admin"], last_login_at: "2026-08-01" }),
  // a scoped manager, flagged for attention, never signed in
  U({ roles: ["manager"], health: { status: "attention" } }),
  // a linked representative
  U({
    roles: ["representative"],
    representative_link: { id: "r1" },
    auth_last_sign_in_at: "2026-07-30",
  }),
  // a representative account with NO link — the actionable gap
  U({ roles: ["representative"], health: { status: "issue" } }),
  // a deactivated representative account, linked
  U({ active: false, roles: ["representative"], representative_link: { id: "r2" } }),
];

describe("summarizeUsers — counts over the rows the admin can see", () => {
  const s = summarizeUsers(PEOPLE);

  it("counts total, active and inactive accounts", () => {
    expect(s.total).toBe(5);
    expect(s.active).toBe(4);
    expect(s.inactive).toBe(1);
  });

  it("tallies the SERVER-computed health states without redefining them", () => {
    expect(s.healthy).toBe(3);
    expect(s.attention).toBe(1);
    expect(s.issue).toBe(1);
    expect(s.healthy + s.attention + s.issue).toBe(s.total);
  });

  it("counts accounts that have never logged in, from either login stamp", () => {
    expect(s.neverLoggedIn).toBe(3);
    expect(hasEverLoggedIn({ last_login_at: "2026-01-01", auth_last_sign_in_at: null })).toBe(true);
    expect(hasEverLoggedIn({ last_login_at: null, auth_last_sign_in_at: "2026-01-01" })).toBe(true);
    expect(hasEverLoggedIn({ last_login_at: null, auth_last_sign_in_at: null })).toBe(false);
  });

  it("counts the technical permission distribution", () => {
    expect(s.byRole).toEqual({ admin: 1, manager: 1, representative: 3 });
  });

  it("counts representative links only over accounts where a link is expected", () => {
    // The admin and the manager are NOT counted as missing a link — that is
    // not a gap, and counting them would invent a problem.
    expect(s.representativeAccounts).toBe(3);
    expect(s.representativesLinked).toBe(2);
    expect(s.representativesUnlinked).toBe(1);
  });

  it("an empty scope produces zeros, never NaN and never a fabricated total", () => {
    expect(summarizeUsers([])).toEqual({
      total: 0,
      active: 0,
      inactive: 0,
      healthy: 0,
      attention: 0,
      issue: 0,
      neverLoggedIn: 0,
      byRole: { admin: 0, manager: 0, representative: 0 },
      representativeAccounts: 0,
      representativesLinked: 0,
      representativesUnlinked: 0,
    });
  });

  it("states the population it describes", () => {
    expect(USERS_SUMMARY_SCOPE_LABEL).toBe("סיכום כלל המשתמשים בהיקף");
    expect(usersPage).toContain("{USERS_SUMMARY_SCOPE_LABEL}");
    // The band counts the workspace-scoped rows, NOT the filtered subset.
    expect(usersPage).toContain("summarizeUsers(scopeUsers)");
  });
});

// ------------------------------------------------------------ list controls

const R = (over: Partial<UsersFilterRow>): UsersFilterRow => ({
  full_name: "—",
  email: null,
  team_id: null,
  manager_id: null,
  created_at: "2024-01-01",
  active: true,
  roles: [],
  last_login_at: null,
  auth_last_sign_in_at: null,
  representative_link: null,
  health: { status: "healthy" },
  ...over,
});

const ROWS: UsersFilterRow[] = [
  R({
    full_name: "אבי אדמין",
    email: "avi@example.com",
    roles: ["admin"],
    created_at: "2024-03-01",
    last_login_at: "2026-08-05",
    health: { status: "healthy" },
  }),
  R({
    full_name: "לירון מוקד",
    email: "liron@example.com",
    roles: ["manager"],
    team_id: "t1",
    business_title: "מנהל מוקד · דירות וחידושים",
    created_at: "2024-01-15",
    health: { status: "attention" },
  }),
  R({
    full_name: "דנה נציגה",
    email: "dana@example.com",
    roles: ["representative"],
    team_id: "t2",
    manager_id: "m1",
    active: false,
    created_at: "2024-02-20",
    auth_last_sign_in_at: "2026-01-02",
    health: { status: "issue" },
  }),
];

const ALL: UsersFilterState = {
  search: "",
  roleFilter: "all",
  teamFilter: "all",
  statusFilter: "all",
  healthFilter: "all",
  sortBy: "name",
};
const NAMES = {
  teamName: (id: string) => ({ t1: "צוות חידושים", t2: "צוות מכירות" })[id] ?? "",
  managerName: (id: string) => ({ m1: "יוסי לוי" })[id] ?? "",
};
const run = (patch: Partial<UsersFilterState>) =>
  filterAndSortUsers(ROWS, { ...ALL, ...patch }, NAMES).map((r) => r.full_name);

describe("/users search — the same five fields as before", () => {
  it("matches the full name", () => {
    expect(run({ search: "אבי" })).toEqual(["אבי אדמין"]);
  });
  it("matches the email, case-insensitively", () => {
    expect(run({ search: "DANA@" })).toEqual(["דנה נציגה"]);
  });
  it("matches the resolved team name", () => {
    expect(run({ search: "צוות מכירות" })).toEqual(["דנה נציגה"]);
  });
  it("matches the responsible manager's name", () => {
    expect(run({ search: "יוסי" })).toEqual(["דנה נציגה"]);
  });
  it("matches the derived business title and its unit", () => {
    expect(run({ search: "מנהל מוקד" })).toEqual(["לירון מוקד"]);
    expect(run({ search: "דירות" })).toEqual(["לירון מוקד"]);
  });
  it("an empty search filters nothing out", () => {
    expect(run({ search: "  " })).toHaveLength(3);
  });
});

describe("/users filters", () => {
  it("filters by the TECHNICAL role, never by a business title", () => {
    expect(run({ roleFilter: "manager" })).toEqual(["לירון מוקד"]);
    expect(run({ roleFilter: "admin" })).toEqual(["אבי אדמין"]);
    // A business title is not a role value and selects nothing.
    expect(run({ roleFilter: "מנהל מוקד · דירות וחידושים" })).toEqual([]);
  });

  it("filters by account status", () => {
    expect(run({ statusFilter: "active" })).toEqual(["אבי אדמין", "לירון מוקד"]);
    expect(run({ statusFilter: "inactive" })).toEqual(["דנה נציגה"]);
  });

  it("filters by each health state", () => {
    expect(run({ healthFilter: "healthy" })).toEqual(["אבי אדמין"]);
    expect(run({ healthFilter: "attention" })).toEqual(["לירון מוקד"]);
    expect(run({ healthFilter: "issue" })).toEqual(["דנה נציגה"]);
  });

  it("scopes by the shared Workspace team, not by a page-local control", () => {
    expect(run({ teamFilter: "t1" })).toEqual(["לירון מוקד"]);
    expect(run({ teamFilter: "t2" })).toEqual(["דנה נציגה"]);
    expect(run({ teamFilter: "all" })).toHaveLength(3);
    // The page still takes the value from the Workspace Context helper.
    expect(usersPage).toContain("const teamFilter = workspaceTeamId(workspace);");
  });

  it("filters intersect", () => {
    expect(run({ roleFilter: "representative", statusFilter: "active" })).toEqual([]);
  });
});

describe("/users sorting — all eight modes survive the table's removal", () => {
  it("offers every mode the sortable table headers used to", () => {
    expect(USERS_SORT_OPTIONS.map((o) => o.value)).toEqual([
      "name",
      "email",
      "role",
      "team",
      "status",
      "health",
      "last_login",
      "created",
    ]);
  });

  it("sorts by name, email and team", () => {
    expect(run({ sortBy: "name" })).toEqual(["אבי אדמין", "דנה נציגה", "לירון מוקד"]);
    expect(run({ sortBy: "email" })).toEqual(["אבי אדמין", "דנה נציגה", "לירון מוקד"]);
    expect(run({ sortBy: "team" })).toEqual(["אבי אדמין", "לירון מוקד", "דנה נציגה"]);
  });

  it("sorts admins first by role, and severity first by health", () => {
    expect(run({ sortBy: "role" })).toEqual(["אבי אדמין", "לירון מוקד", "דנה נציגה"]);
    expect(run({ sortBy: "health" })).toEqual(["דנה נציגה", "לירון מוקד", "אבי אדמין"]);
  });

  it("sorts active first by status, newest first by creation and last login", () => {
    expect(run({ sortBy: "status" })).toEqual(["אבי אדמין", "לירון מוקד", "דנה נציגה"]);
    expect(run({ sortBy: "created" })).toEqual(["אבי אדמין", "דנה נציגה", "לירון מוקד"]);
    // Never-logged-in rows sort last; both login stamps are considered.
    expect(run({ sortBy: "last_login" })).toEqual(["אבי אדמין", "דנה נציגה", "לירון מוקד"]);
  });

  it("never mutates the caller's array", () => {
    const before = ROWS.map((r) => r.full_name);
    filterAndSortUsers(ROWS, { ...ALL, sortBy: "health" }, NAMES);
    expect(ROWS.map((r) => r.full_name)).toEqual(before);
  });
});

describe("/users pagination is preserved", () => {
  it("still pages the filtered list 25 at a time", () => {
    expect(usersPage).toContain("const PAGE_SIZE = 25;");
    expect(usersPage).toContain("filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)");
    expect(usersPage).toContain("{filtered.length > PAGE_SIZE && (");
  });
});

// -------------------------------------------------------------- interaction

describe("person surface keyboard activation — the card, and only the card", () => {
  const CARD = { id: "person-card" };
  const MENU_TRIGGER = { id: "actions-trigger" };

  it("Enter/Space on the focused card opens the details drawer", () => {
    expect(isSelfActivation({ key: "Enter", target: CARD, currentTarget: CARD })).toBe(true);
    expect(isSelfActivation({ key: " ", target: CARD, currentTarget: CARD })).toBe(true);
  });

  it("Enter/Space on the nested actions control does NOT open the drawer", () => {
    expect(isSelfActivation({ key: "Enter", target: MENU_TRIGGER, currentTarget: CARD })).toBe(
      false,
    );
    expect(isSelfActivation({ key: " ", target: MENU_TRIGGER, currentTarget: CARD })).toBe(false);
  });

  it("a dropdown item bubbling up from its portal is still nested", () => {
    // Radix renders DropdownMenuContent through a portal, but React events
    // bubble along the REACT tree — the item reaches the card handler with
    // target !== currentTarget and must be ignored so the action runs.
    const ITEM = { id: "menu-item-delete" };
    expect(isSelfActivation({ key: "Enter", target: ITEM, currentTarget: CARD })).toBe(false);
  });

  it("other keys never activate", () => {
    for (const key of ["Tab", "Escape", "ArrowDown", "a"]) {
      expect(isSelfActivation({ key, target: CARD, currentTarget: CARD })).toBe(false);
    }
  });

  it("both people surfaces gate on the rule, and mouse propagation is stopped", () => {
    // The card AND the dense list row — the row's old handler fired on any
    // Enter that bubbled up, including from the actions menu.
    expect((usersPage.match(/if \(!isSelfActivation\(e\)\) return;/g) ?? []).length).toBe(2);
    expect(usersPage).toContain("onClick={(e) => e.stopPropagation()}");
    expect(usersPage).not.toContain('if (e.key === "Enter") onOpenDetails();');
    // No blanket suppression of nested keyboard events.
    expect(usersPage).not.toContain("onKeyDown={(e) => e.stopPropagation()}");
  });
});

// ---------------------------------------------------------------- audit log

describe("audit details — concise where safe, raw where not", () => {
  it("renders flat scalar entries as key: value chips", () => {
    expect(auditDetailChips({ role: "manager", active: true, count: 3 })).toEqual([
      "role: manager",
      "active: true",
      "count: 3",
    ]);
  });

  it("reports a list by its shape and never guesses at a nested value", () => {
    expect(auditDetailChips({ teams: ["a", "b"], nested: { x: 1 } })).toEqual([
      "teams: 2 פריטים",
      "nested: …",
    ]);
  });

  it("shows an explicit dash for null/empty rather than inventing meaning", () => {
    expect(auditDetailChips({ previous: null, note: "" })).toEqual(["previous: —", "note: —"]);
  });

  it("caps the inline chips and leaves the raw JSON reachable", () => {
    const many = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    expect(auditDetailChips(many)).toHaveLength(4);
    expect(hasAuditDetails(many)).toBe(true);
    expect(usersPage).toContain("JSON.stringify(entry.details, null, 2)");
  });

  it("has nothing to show for empty or non-object details", () => {
    expect(auditDetailChips(null)).toEqual([]);
    expect(auditDetailChips("done")).toEqual([]);
    expect(hasAuditDetails({})).toBe(false);
    expect(hasAuditDetails(null)).toBe(false);
  });

  it("invents no human sentence for an unknown action", () => {
    // The action itself is rendered verbatim; there is no lookup table that
    // could put words in an unknown event's mouth.
    expect(usersPage).toContain("{entry.action}");
    expect(usersPage).not.toContain("ACTION_LABEL");
  });
});

// ----------------------------------------------------------- safety pins

describe("regression — permissions, safeguards and semantics are untouched", () => {
  it("keeps the last-active-admin protection", () => {
    expect(usersPage).toContain(
      'const isLastActiveAdmin = user.active && user.roles.includes("admin") && activeAdminsCount <= 1;',
    );
    expect(usersPage).toContain("disabled={isSelf || (user.active && isLastActiveAdmin)}");
    expect(usersPage).toContain("לא ניתן להסיר את התפקיד מהמנהל הפעיל האחרון.");
  });

  it("keeps every self-protection", () => {
    expect(usersPage).toContain('const roleLocked = isSelf && user.roles.includes("admin");');
    expect(usersPage).toContain("disabled={isSelf}");
    expect(usersPage).toContain("לא ניתן לשנות את התפקיד של החשבון שלך.");
  });

  it("keeps the deletion dependency check and the typed-email confirmation", () => {
    expect(usersPage).toContain("getUserDeleteCheck");
    expect(usersPage).toContain("check.blockers.length === 0");
    expect(usersPage).toContain("confirm_email: confirmEmail");
    expect(usersPage).toContain("מומלץ להשבית את המשתמש במקום למחוק אותו לצמיתות");
  });

  it("keeps the business title display-only and the role enum untouched", () => {
    expect(usersPage).toContain("user.business_title ?? roleLabel[user.roles[0]]");
    expect(usersPage).toContain("CREATE_ROLE_OPTIONS.map((o) => (");
    expect(usersPage).not.toContain("setUserBusinessScope");
    expect(usersPage).not.toContain('from("user_business_scopes")');
    // The three technical roles, unchanged.
    expect(usersPage).toContain('<SelectItem value="admin">מנהל מערכת</SelectItem>');
    expect(usersPage).toContain('<SelectItem value="manager">מנהל</SelectItem>');
    expect(usersPage).toContain('<SelectItem value="representative">נציג</SelectItem>');
  });

  it("keeps the profile-team vs team-manager distinction explicit", () => {
    expect(usersPage).toContain("שיוך פרופיל בלבד");
    expect(usersPage).toContain("אינו מוגדר כמנהל של אף צוות");
  });

  it("keeps representative link/unlink semantics and the derived manager rule", () => {
    expect(usersPage).toContain("linkRepresentativeUser");
    expect(usersPage).toContain("rep_id: user.representative_link!.id, user_id: null");
    expect(usersPage).toContain(
      '...(isLinkedRep ? {} : { manager_id: managerId === "none" ? null : managerId })',
    );
  });

  it("keeps one awaited cache-invalidation path", () => {
    expect(usersPage).toContain("export function invalidateUserAdminCaches");
    expect(usersPage).toContain("return invalidateUserAdminCaches(qc);");
    expect(usersPage).toContain('refetchOnMount: "always"');
  });
});
