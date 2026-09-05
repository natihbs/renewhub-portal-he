import { describe, it, expect } from "vitest";
import { resolveAuthData, isCurrentAuthResponse } from "@/lib/auth";

describe("resolveAuthData", () => {
  it("reports a RETURNED profiles error as recoverable, not as a missing role", () => {
    const out = resolveAuthData(
      { data: null, error: { message: "network" } },
      { data: [{ role: "admin" }], error: null },
    );
    expect(out.kind).toBe("error");
  });

  it("reports a RETURNED user_roles error rather than silently rendering representative", () => {
    const out = resolveAuthData(
      { data: { id: "u1" }, error: null },
      { data: null, error: { message: "permission denied" } },
    );
    expect(out.kind).toBe("error");
  });

  it("accepts a genuinely empty role list", () => {
    const out = resolveAuthData({ data: { id: "u1" }, error: null }, { data: [], error: null });
    expect(out).toMatchObject({ kind: "ok", roles: [] });
  });

  it("maps roles when both reads succeed", () => {
    const out = resolveAuthData(
      { data: { id: "u1" }, error: null },
      { data: [{ role: "manager" }, { role: "admin" }], error: null },
    );
    expect(out).toMatchObject({ kind: "ok", roles: ["manager", "admin"] });
  });
});

describe("stale response guard", () => {
  it("rejects a late response from a superseded request", () => {
    expect(isCurrentAuthResponse({ seq: 1, currentSeq: 2, userId: "u1", currentUserId: "u1" })).toBe(false);
  });

  it("rejects a response belonging to the previous user", () => {
    expect(isCurrentAuthResponse({ seq: 2, currentSeq: 2, userId: "u1", currentUserId: "u2" })).toBe(false);
  });

  it("rejects any response after sign-out", () => {
    expect(isCurrentAuthResponse({ seq: 2, currentSeq: 2, userId: "u1", currentUserId: null })).toBe(false);
  });

  it("accepts the newest response for the current user", () => {
    expect(isCurrentAuthResponse({ seq: 3, currentSeq: 3, userId: "u1", currentUserId: "u1" })).toBe(true);
  });
});
