// Post-merge QA fixes in /users after PR #43:
//   A. Edit dialog: the role field is the TECHNICAL permission level
//      ("הרשאת מערכת" with option "מנהל"), separate from the derived business
//      title shown below it.
//   B. User health: a manager with a business-scope grant (מוקד / פעילות /
//      סמנכ"ל) is a VALID setup even with no profile team and no direct
//      teams.manager_id rows — scope counts only for role=manager.
//   C. Linked representatives: the responsible manager is DERIVED from the
//      rep team's teams.manager_id; the edit dialog shows it read-only and
//      the server never persists a manual value for a linked rep.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeUserHealth } from "../user-health";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const usersPageSrc = read("../../routes/_authenticated/users.tsx");
const fnsSrc = read("../user-admin.functions.ts");
const healthSrc = read("../user-health.ts");
const editDialogSrc = usersPageSrc.slice(usersPageSrc.indexOf("function EditUserDialog"));

describe("Part B — health of business-scope managers", () => {
  const scopedManagerBase = {
    roles: ["manager"],
    team_id: null,
    representative_link: null,
    managed_team_ids: [] as string[],
  };

  it("is healthy for a manager with a center scope, no profile team, no direct teams (לירון)", () => {
    const h = computeUserHealth({ ...scopedManagerBase, has_business_scope: true });
    expect(h.status).toBe("healthy");
    expect(h.emoji).toBe("🟢");
    expect(h.reasons).toEqual([]);
  });

  it("is healthy for a manager with an activity/executive scope the same way (יונתן)", () => {
    // The signal is boolean on purpose: center, activity and executive grants
    // all confer real managerial reach, so they gate identically.
    const h = computeUserHealth({ ...scopedManagerBase, has_business_scope: true });
    expect(h.status).toBe("healthy");
  });

  it("keeps a manager with NO scope and no teams at attention", () => {
    const h = computeUserHealth({ ...scopedManagerBase, has_business_scope: false });
    expect(h.status).toBe("attention");
    expect(h.reasons).toContain("המשתמש אינו משויך לצוות");
    expect(h.reasons).toContain(
      "מנהל צוות שאינו מנהל אף צוות — יש להגדירו כמנהל הצוות בעמוד הצוותים",
    );
  });

  it("treats an omitted has_business_scope exactly like false (existing callers unchanged)", () => {
    const h = computeUserHealth({ ...scopedManagerBase });
    expect(h.status).toBe("attention");
  });

  it("does NOT let a stray scope grant make a representative healthy", () => {
    const h = computeUserHealth({
      roles: ["representative"],
      team_id: null,
      representative_link: null,
      has_business_scope: true,
    });
    expect(h.status).toBe("attention");
    expect(h.reasons).toContain("המשתמש אינו משויך לצוות");
    expect(h.reasons).toContain("לא קיים נציג מקושר לחשבון המשתמש");
  });

  it("does NOT let a stray scope grant change an admin's health", () => {
    const withScope = computeUserHealth({
      roles: ["admin"],
      team_id: null,
      representative_link: null,
      has_business_scope: true,
    });
    const withoutScope = computeUserHealth({
      roles: ["admin"],
      team_id: null,
      representative_link: null,
    });
    expect(withScope.status).toBe(withoutScope.status);
    expect(withScope.reasons).toEqual(withoutScope.reasons);
  });

  it("keeps a direct team manager healthy exactly as before (חן)", () => {
    const h = computeUserHealth({
      roles: ["manager"],
      team_id: "t1",
      representative_link: null,
      managed_team_ids: ["t1"],
    });
    expect(h.status).toBe("healthy");
  });

  it("still flags a manager with a profile team who manages nothing and has no scope", () => {
    const h = computeUserHealth({
      roles: ["manager"],
      team_id: "t1",
      representative_link: null,
      managed_team_ids: [],
    });
    expect(h.status).toBe("issue");
  });

  it("keeps scope gating manager-only in the source (mirrors the SQL is_manager guard)", () => {
    expect(healthSrc).toContain("has_business_scope?: boolean");
    expect(healthSrc).toContain("isManagerOnly && input.has_business_scope === true");
  });
});

describe("Part B — server functions feed the scope signal", () => {
  it("listUsers passes has_business_scope from the already-loaded scope grants", () => {
    expect(fnsSrc).toContain("has_business_scope: (scopeGrantsByUser.get(p.id) ?? []).length > 0");
  });

  it("getUserDetails passes the same signal (and managed teams) to computeUserHealth", () => {
    expect(fnsSrc).toContain(
      "has_business_scope: (scopeGrantsByUser.get(data.user_id) ?? []).length > 0",
    );
  });
});

describe("Part A — edit dialog role field is the technical permission", () => {
  it('labels the field "הרשאת מערכת"', () => {
    expect(editDialogSrc).toContain("<Label>הרשאת מערכת</Label>");
    expect(editDialogSrc).not.toContain("<Label>תפקיד</Label>");
  });

  it('offers "מנהל" (not "מנהל צוות") for the manager technical role', () => {
    expect(editDialogSrc).toContain('<SelectItem value="manager">מנהל</SelectItem>');
    expect(editDialogSrc).not.toContain('<SelectItem value="manager">מנהל צוות</SelectItem>');
  });

  it("keeps the exact technical role values — no new enum values", () => {
    expect(editDialogSrc).toContain('<SelectItem value="admin">מנהל מערכת</SelectItem>');
    expect(editDialogSrc).toContain('<SelectItem value="representative">נציג</SelectItem>');
    expect(fnsSrc).toContain('type AppRole = "admin" | "manager" | "representative"');
    expect(fnsSrc).not.toContain("ALTER TYPE");
  });

  it("keeps the derived business title + hierarchy helper under the field", () => {
    expect(editDialogSrc).toContain("תפקיד עסקי נוכחי: {user.business_title}");
    expect(editDialogSrc).toContain("{EDIT_SCOPE_HELPER_TEXT}");
  });
});

describe("Part A polish — list role filter uses the technical permission wording", () => {
  // The list lives before EditUserDialog in the file — check that slice so the
  // edit dialog's own role select never satisfies these pins by accident.
  const listSrc = usersPageSrc.slice(0, usersPageSrc.indexOf("function EditUserDialog"));

  it('labels the filter "הרשאת מערכת" with option "מנהל" (not "מנהל צוות")', () => {
    expect(listSrc).toContain('placeholder="הרשאת מערכת"');
    expect(listSrc).toContain('<SelectItem value="all">כל ההרשאות</SelectItem>');
    expect(listSrc).toContain('<SelectItem value="manager">מנהל</SelectItem>');
    expect(usersPageSrc).not.toContain('<SelectItem value="manager">מנהל צוות</SelectItem>');
    expect(usersPageSrc).not.toContain("כל התפקידים");
  });

  it("still filters by the TECHNICAL role value", () => {
    expect(listSrc).toContain("u.roles.includes(roleFilter as AppRole)");
  });

  it("searches business_title so scoped managers are findable by title or unit", () => {
    expect(listSrc).toContain('${u.business_title ?? ""}');
  });
});

describe("Part C — linked representative responsible manager is derived", () => {
  it("shows a read-only derived display labeled by its source", () => {
    expect(editDialogSrc).toContain("<Label>מנהל אחראי נגזר מצוות הנציג</Label>");
    expect(editDialogSrc).toContain("לא הוגדר מנהל צוות");
    expect(editDialogSrc).toContain("לנציג מקושר, המנהל האחראי נקבע לפי מנהל הצוות של הנציג");
  });

  it("keeps the editable manager select for everyone else", () => {
    expect(editDialogSrc).toContain('{role !== "admin" && !isLinkedRep && (');
    expect(editDialogSrc).toContain("<Label>מנהל אחראי</Label>");
  });

  it("omits manager_id from the update payload for a linked rep", () => {
    expect(editDialogSrc).toContain(
      '...(isLinkedRep ? {} : { manager_id: managerId === "none" ? null : managerId }),',
    );
  });

  it("derives the display from the rep's team manager (teams.manager_id)", () => {
    expect(editDialogSrc).toContain(
      'const isLinkedRep = role === "representative" && !!user.representative_link;',
    );
    expect(editDialogSrc).toContain("linkedRepTeam?.manager_id");
  });

  it("server-side: updateUser drops a manual manager_id for a linked representative", () => {
    expect(fnsSrc).toContain("if (isLinkedRep) delete profileUpdate.manager_id;");
    expect(fnsSrc).toContain('if (roleForManagerCheck === "representative")');
  });

  it("does not touch the sync functions or team ownership", () => {
    expect(fnsSrc).toContain("linkRepresentativeToUserCore");
    expect(fnsSrc).not.toContain('from("teams").update');
  });
});

describe("safety regressions", () => {
  it("users surface still never writes business scopes or hierarchy", () => {
    expect(usersPageSrc).not.toContain('from("user_business_scopes")');
    expect(usersPageSrc).not.toContain("setUserBusinessScope");
  });

  it("PR #43 email editing flow is intact", () => {
    expect(fnsSrc).toContain("export const updateUserEmail");
    expect(fnsSrc).toContain("emailToIlikePattern");
    expect(editDialogSrc).toContain("updateUserEmail");
  });

  it("no CRM/worklist vocabulary leaked in", () => {
    for (const term of ["crm", "worklist", "queue", "policy_number", "call_outcome"]) {
      expect(usersPageSrc.toLowerCase()).not.toContain(term);
      expect(healthSrc.toLowerCase()).not.toContain(term);
    }
  });
});
