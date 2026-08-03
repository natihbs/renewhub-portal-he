import { describe, expect, it } from "vitest";
import { computeWorkspaceOptions, ORG_WORKSPACE_LABEL, workspaceTeamId, type Workspace } from "@/lib/workspace-context";

const teams = [
  { id: "t1", name: "צוות רכב", managerId: "mgr-1" },
  { id: "t2", name: "צוות דירה", managerId: "mgr-1" },
  { id: "t3", name: "צוות אחר", managerId: "mgr-2" },
];

describe("computeWorkspaceOptions", () => {
  it("gives a System Administrator the entire organization plus every team", () => {
    const options = computeWorkspaceOptions({
      isAdmin: true, isManager: false, isRepresentative: false, isDemo: false, userId: "admin-1", teams,
    });
    expect(options).toEqual([
      { type: "org", label: ORG_WORKSPACE_LABEL },
      { type: "team", teamId: "t1", label: "צוות רכב" },
      { type: "team", teamId: "t2", label: "צוות דירה" },
      { type: "team", teamId: "t3", label: "צוות אחר" },
    ]);
  });

  it("gives a multi-team manager only the teams they manage, never entire-org", () => {
    const options = computeWorkspaceOptions({
      isAdmin: false, isManager: true, isRepresentative: false, isDemo: false, userId: "mgr-1", teams,
    });
    expect(options).toEqual([
      { type: "team", teamId: "t1", label: "צוות רכב" },
      { type: "team", teamId: "t2", label: "צוות דירה" },
    ]);
  });

  it("gives a single-team manager exactly one option (the caller renders this as a locked label, not a dropdown)", () => {
    const options = computeWorkspaceOptions({
      isAdmin: false, isManager: true, isRepresentative: false, isDemo: false, userId: "mgr-2", teams,
    });
    expect(options).toEqual([{ type: "team", teamId: "t3", label: "צוות אחר" }]);
  });

  it("never lets a manager switch into a team they don't manage, even if RLS would let them read it", () => {
    const options = computeWorkspaceOptions({
      isAdmin: false, isManager: true, isRepresentative: false, isDemo: false, userId: "someone-else", teams,
    });
    expect(options).toEqual([]);
  });

  it("gives a representative no switcher at all", () => {
    const options = computeWorkspaceOptions({
      isAdmin: false, isManager: false, isRepresentative: true, isDemo: false, userId: "rep-1", teams,
    });
    expect(options).toEqual([]);
  });

  it("gives Demo Mode no switcher, regardless of role", () => {
    const options = computeWorkspaceOptions({
      isAdmin: true, isManager: false, isRepresentative: false, isDemo: true, userId: "admin-1", teams,
    });
    expect(options).toEqual([]);
  });
});

describe("workspaceTeamId", () => {
  it("maps the org workspace to the existing 'all' filter value", () => {
    const ws: Workspace = { type: "org" };
    expect(workspaceTeamId(ws)).toBe("all");
  });

  it("maps a team workspace to its team id", () => {
    const ws: Workspace = { type: "team", teamId: "t1", teamName: "צוות רכב" };
    expect(workspaceTeamId(ws)).toBe("t1");
  });
});
