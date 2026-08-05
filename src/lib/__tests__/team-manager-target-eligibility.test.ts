import { describe, it, expect } from "vitest";
import { isPrivilegedRoleSet, canManagerAssignTarget, canManagerRemoveTarget } from "@/lib/team-admin.functions";

// Regression coverage for the PR #18 review correction ("P1 - MANAGER MUST
// NOT ASSIGN OR REMOVE ADMIN/MANAGER ACCOUNTS"): the original setUserTeam
// only ever checked WHICH TEAMS a reassignment touched, never WHO was being
// moved — a manager could have assigned an unassigned admin/manager to their
// team, or removed one, as long as the team-scope check passed.
// representatives.user_id is the authoritative link (never a role name
// alone, never profiles.team_id by itself) — these are the exact eligibility
// rules setUserTeam now enforces for a manager actor, on both the add and
// remove sides.

describe("isPrivilegedRoleSet", () => {
  it("is true for admin", () => expect(isPrivilegedRoleSet(["admin"])).toBe(true));
  it("is true for manager", () => expect(isPrivilegedRoleSet(["manager"])).toBe(true));
  it("is true when a role set holds both representative and admin (never trust the presence of 'representative' alone)", () => {
    expect(isPrivilegedRoleSet(["representative", "admin"])).toBe(true);
  });
  it("is false for a plain representative", () => expect(isPrivilegedRoleSet(["representative"])).toBe(false));
  it("is false for no roles at all", () => expect(isPrivilegedRoleSet([])).toBe(false));
});

describe("canManagerAssignTarget — who a manager may ADD to their team", () => {
  it("allows an active, representative-linked, non-privileged account", () => {
    expect(canManagerAssignTarget({ roles: ["representative"], representativeActive: true })).toBe(true);
  });

  it("denies an admin account, even if somehow also representative-linked and active", () => {
    expect(canManagerAssignTarget({ roles: ["representative", "admin"], representativeActive: true })).toBe(false);
  });

  it("denies a manager account", () => {
    expect(canManagerAssignTarget({ roles: ["manager"], representativeActive: null })).toBe(false);
  });

  it("denies an account with no representative role at all", () => {
    expect(canManagerAssignTarget({ roles: [], representativeActive: null })).toBe(false);
  });

  it("denies a representative-role account with no linked representative record", () => {
    expect(canManagerAssignTarget({ roles: ["representative"], representativeActive: null })).toBe(false);
  });

  it("denies a representative-role account whose linked representative is inactive", () => {
    expect(canManagerAssignTarget({ roles: ["representative"], representativeActive: false })).toBe(false);
  });
});

describe("canManagerRemoveTarget — who a manager may REMOVE from their team", () => {
  it("allows a representative account, regardless of whether their representative link is still active (cleanup)", () => {
    expect(canManagerRemoveTarget({ roles: ["representative"] })).toBe(true);
  });

  it("denies an admin account", () => {
    expect(canManagerRemoveTarget({ roles: ["admin"] })).toBe(false);
  });

  it("denies a manager account", () => {
    expect(canManagerRemoveTarget({ roles: ["manager"] })).toBe(false);
  });

  it("denies an account with no representative role (never a generic 'any non-privileged user')", () => {
    expect(canManagerRemoveTarget({ roles: [] })).toBe(false);
  });

  it("is strictly more permissive than canManagerAssignTarget on the active-representative requirement (removal is not gated by it)", () => {
    const target = { roles: ["representative"] };
    expect(canManagerRemoveTarget(target)).toBe(true);
    expect(canManagerAssignTarget({ ...target, representativeActive: null })).toBe(false);
  });
});
