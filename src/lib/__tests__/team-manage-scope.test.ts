import { describe, it, expect } from "vitest";
import { canManageTeamRow } from "@/routes/_authenticated/teams";

// Regression coverage for the P2b fix: "ניהול צוותים" used to be effectively
// read-only for every manager, since canManage was only ever true for admins.
// canManageTeamRow is the pure rule the UI now uses to decide, per team row,
// whether the signed-in user gets real edit affordances (description, KPI
// profile, members) — admin everywhere, a manager only for the team they
// personally manage. The real security boundary is server-side
// (assertCanManageTeam in team-admin.functions.ts); this only ever gates
// which controls render, so it's covered directly and independently of any
// network call.

describe("canManageTeamRow", () => {
  it("an admin can manage any team, regardless of who manages it", () => {
    expect(canManageTeamRow(
      { manager_id: "someone-else" },
      { isAdmin: true, isManager: false, currentUserId: "admin-1" },
    )).toBe(true);
  });

  it("a manager can manage their own team", () => {
    expect(canManageTeamRow(
      { manager_id: "mgr-1" },
      { isAdmin: false, isManager: true, currentUserId: "mgr-1" },
    )).toBe(true);
  });

  it("a manager is denied on a team managed by someone else", () => {
    expect(canManageTeamRow(
      { manager_id: "mgr-2" },
      { isAdmin: false, isManager: true, currentUserId: "mgr-1" },
    )).toBe(false);
  });

  it("a manager is denied on a team with no manager assigned at all", () => {
    expect(canManageTeamRow(
      { manager_id: null },
      { isAdmin: false, isManager: true, currentUserId: "mgr-1" },
    )).toBe(false);
  });

  it("a representative (neither admin nor manager) is always denied", () => {
    expect(canManageTeamRow(
      { manager_id: "rep-1" },
      { isAdmin: false, isManager: false, currentUserId: "rep-1" },
    )).toBe(false);
  });

  it("is denied when currentUserId is unresolved (never optimistically grants access)", () => {
    expect(canManageTeamRow(
      { manager_id: "mgr-1" },
      { isAdmin: false, isManager: true, currentUserId: null },
    )).toBe(false);
  });
});
