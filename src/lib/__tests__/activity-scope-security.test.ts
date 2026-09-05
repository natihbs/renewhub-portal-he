import { describe, it, expect } from "vitest";
import {
  resolveActivityScope,
  queryScopedActivity,
  ACTIVITY_TEAM_FORBIDDEN_MESSAGE,
  ACTIVITY_TEAM_INVALID_MESSAGE,
} from "@/lib/activity-scope";

const TEAM_A = "11111111-1111-4111-8111-111111111111";
const TEAM_B = "22222222-2222-4222-8222-222222222222";
const REP_A = "33333333-3333-4333-8333-333333333333";

/** Records the PostgREST calls a handler makes and replays a canned page. */
function fakeClient(page: { data: any[]; count: number }) {
  const calls: any = { or: null as string | null, range: null as [number, number] | null, ordered: [] as any[] };
  const builder: any = {
    select: (_c: string, o: any) => ((calls.select = o), builder),
    in: (_c: string, v: string[]) => ((calls.in = v), builder),
    or: (f: string) => ((calls.or = f), builder),
    order: (c: string, o: any) => (calls.ordered.push([c, o]), builder),
    range: (from: number, to: number) => {
      calls.range = [from, to];
      return Promise.resolve({ data: page.data, count: page.count, error: null });
    },
  };
  return { client: { from: () => builder }, calls };
}

describe("activity feed authorization", () => {
  it("rejects a team outside the caller's canonical scope", () => {
    expect(() =>
      resolveActivityScope({
        isAdmin: false,
        authorizedTeamIds: [TEAM_A],
        scopedRepIds: [],
        requestedTeamId: TEAM_B,
      }),
    ).toThrow(ACTIVITY_TEAM_FORBIDDEN_MESSAGE);
  });

  it("rejects a malformed team id before any read", () => {
    expect(() =>
      resolveActivityScope({
        isAdmin: true,
        authorizedTeamIds: [TEAM_A],
        scopedRepIds: [],
        requestedTeamId: "'; drop--",
      }),
    ).toThrow(ACTIVITY_TEAM_INVALID_MESSAGE);
  });

  it("accepts a granted (non-owned) team — center/activity/executive grants count", () => {
    const scope = resolveActivityScope({
      isAdmin: false,
      authorizedTeamIds: [TEAM_A, TEAM_B],
      scopedRepIds: [REP_A],
      requestedTeamId: TEAM_B,
    });
    expect(scope).toEqual({ kind: "scoped", repIds: [REP_A], teamIds: [TEAM_B] });
  });

  it("a manager with no scope reads nothing at all", async () => {
    const scope = resolveActivityScope({
      isAdmin: false,
      authorizedTeamIds: [],
      scopedRepIds: [],
      requestedTeamId: null,
    });
    expect(scope.kind).toBe("none");
    const { client, calls } = fakeClient({ data: [], count: 0 });
    expect(await queryScopedActivity(client, { scope, actions: ["a"], limit: 8 })).toEqual({
      rows: [],
      total: 0,
    });
    expect(calls.range).toBeNull();
  });
});

describe("activity feed filtering before pagination", () => {
  const scope = resolveActivityScope({
    isAdmin: false,
    authorizedTeamIds: [TEAM_A],
    scopedRepIds: [REP_A],
    requestedTeamId: null,
  });

  it("pushes the scope into the query and pages with range, not a JS slice", async () => {
    const { client, calls } = fakeClient({ data: [], count: 0 });
    await queryScopedActivity(client, { scope, actions: ["a", "b"], limit: 8, offset: 16 });
    expect(calls.select).toEqual({ count: "exact" });
    expect(calls.or).toContain(`details->>representative_id.in.(${REP_A})`);
    expect(calls.or).toContain(`details->>team_id.in.(${TEAM_A})`);
    expect(calls.range).toEqual([16, 23]);
    expect(calls.ordered).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("keeps a team's events visible behind 400+ unrelated newer events, with an exact count", async () => {
    // The database applied the scope filter, so the page holds only in-scope
    // rows even though 500 newer foreign events exist; count is the real total.
    const page = Array.from({ length: 8 }, (_, i) => ({
      id: `row-${i}`,
      action: "a",
      actor_id: null,
      actor_email: null,
      details: { team_id: TEAM_A },
      created_at: "2026-01-01",
    }));
    const { client } = fakeClient({ data: page, count: 37 });
    const res = await queryScopedActivity(client, { scope, actions: ["a"], limit: 8 });
    expect(res.rows).toHaveLength(8);
    expect(res.total).toBe(37);
  });

  it("drops a row the query should never have returned", async () => {
    const { client } = fakeClient({
      data: [
        { id: "x", action: "a", actor_id: null, actor_email: null, details: { team_id: TEAM_B }, created_at: "" },
      ],
      count: 1,
    });
    const res = await queryScopedActivity(client, { scope, actions: ["a"], limit: 8 });
    expect(res.rows).toEqual([]);
  });
});
