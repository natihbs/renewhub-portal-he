import { describe, expect, it, beforeEach, vi } from "vitest";
import { resolveAuthenticatedGuard } from "@/lib/authenticated-guard";
import { getCurrentRoles, roleDecision, clearRoleCache } from "@/lib/role-resolution";
import { resolveInternalLink, isKnownInternalPath } from "@/lib/internal-route";
import { resolveShellMode, BARE_ROUTES } from "@/lib/shell-mode";

const USER = { id: "u1" };

function deps(over: Partial<Parameters<typeof resolveAuthenticatedGuard<typeof USER>>[0]> = {}) {
  return {
    getUser: async () => ({ user: USER as typeof USER | null, error: null as unknown }),
    getProfile: async () => ({ must_change_password: false, active: true }),
    signOut: async () => {},
    ...over,
  };
}

describe("_authenticated guard", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it("allows an active, up-to-date user", async () => {
    await expect(resolveAuthenticatedGuard(deps())).resolves.toEqual({ kind: "allow", user: USER });
  });

  it("redirects to /auth when there is no user", async () => {
    const out = await resolveAuthenticatedGuard(
      deps({ getUser: async () => ({ user: null, error: null }) }),
    );
    expect(out).toEqual({ kind: "redirect", to: "/auth" });
  });

  it("redirects to /auth when getUser reports an auth error", async () => {
    const out = await resolveAuthenticatedGuard(
      deps({ getUser: async () => ({ user: USER, error: new Error("bad jwt") }) }),
    );
    expect(out).toEqual({ kind: "redirect", to: "/auth" });
  });

  it("signs out and redirects an inactive profile", async () => {
    const signOut = vi.fn(async () => {});
    const out = await resolveAuthenticatedGuard(
      deps({ getProfile: async () => ({ active: false, must_change_password: false }), signOut }),
    );
    expect(out).toEqual({ kind: "redirect", to: "/auth" });
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("redirects to /reset-password when a password change is required", async () => {
    const out = await resolveAuthenticatedGuard(
      deps({ getProfile: async () => ({ active: true, must_change_password: true }) }),
    );
    expect(out).toEqual({ kind: "redirect", to: "/reset-password" });
  });

  it("does not let a thrown session failure escape (lock timeout / network)", async () => {
    const out = await resolveAuthenticatedGuard(
      deps({
        getUser: async () => {
          throw new Error("NavigatorLockAcquireTimeoutError");
        },
      }),
    );
    expect(out).toEqual({ kind: "redirect", to: "/auth" });
  });

  it("does not let a thrown profile-query failure escape", async () => {
    const out = await resolveAuthenticatedGuard(
      deps({
        getProfile: async () => {
          throw new Error("Failed to fetch");
        },
      }),
    );
    expect(out).toEqual({ kind: "redirect", to: "/auth" });
  });

  it("still redirects to /auth if sign-out of an inactive user throws", async () => {
    const out = await resolveAuthenticatedGuard(
      deps({
        getProfile: async () => ({ active: false }),
        signOut: async () => {
          throw new Error("offline");
        },
      }),
    );
    expect(out).toEqual({ kind: "redirect", to: "/auth" });
  });
});

describe("role resolution", () => {
  beforeEach(() => {
    clearRoleCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const ok = { getUserId: async () => "u1", fetchRoles: async () => ["admin" as const] };

  it("allows a user holding an allowed role", async () => {
    expect(roleDecision(await getCurrentRoles(ok), ["admin"])).toBeNull();
  });

  it("denies a verified user without the role", async () => {
    const res = await getCurrentRoles({
      ...ok,
      fetchRoles: async () => ["representative" as const],
    });
    expect(roleDecision(res, ["admin"])).toBe("/access-denied");
  });

  it("sends a signed-out visitor to /auth", async () => {
    const res = await getCurrentRoles({ ...ok, getUserId: async () => null });
    expect(res.status).toBe("unauthenticated");
    expect(roleDecision(res, ["admin"])).toBe("/auth");
  });

  it("does NOT treat a failed roles query as an empty role set", async () => {
    const res = await getCurrentRoles({
      ...ok,
      fetchRoles: async () => {
        throw new Error("network");
      },
    });
    expect(res.status).toBe("unavailable");
    expect(roleDecision(res, ["admin"])).not.toBe("/access-denied");
    expect(roleDecision(res, ["admin"])).toBe("/auth");
  });

  it("does NOT treat a thrown getUser as an empty role set", async () => {
    const res = await getCurrentRoles({
      ...ok,
      getUserId: async () => {
        throw new Error("lock timeout");
      },
    });
    expect(res.status).toBe("unavailable");
    expect(roleDecision(res, ["admin"])).toBe("/auth");
  });

  it("never grants access on uncertainty", async () => {
    const res = await getCurrentRoles({
      ...ok,
      fetchRoles: async () => {
        throw new Error("x");
      },
    });
    expect(roleDecision(res, ["admin", "manager", "representative"])).not.toBeNull();
  });

  it("does not cache a failed roles query", async () => {
    const fetchRoles = vi
      .fn(async (_userId: string): Promise<"admin"[]> => ["admin"])
      .mockRejectedValueOnce(new Error("network"));
    expect((await getCurrentRoles({ ...ok, fetchRoles })).status).toBe("unavailable");

    const second = await getCurrentRoles({ ...ok, fetchRoles });
    expect(second).toEqual({ status: "ok", userId: "u1", roles: ["admin"] });
    expect(fetchRoles).toHaveBeenCalledTimes(2);
  });

  it("caches a successful roles query for the TTL window", async () => {
    const fetchRoles = vi.fn(async () => ["manager" as const]);
    await getCurrentRoles({ ...ok, fetchRoles });
    const again = await getCurrentRoles({ ...ok, fetchRoles });
    expect(again).toEqual({ status: "ok", userId: "u1", roles: ["manager"] });
    expect(fetchRoles).toHaveBeenCalledTimes(1);
    clearRoleCache();
    await getCurrentRoles({ ...ok, fetchRoles });
    expect(fetchRoles).toHaveBeenCalledTimes(2);
  });
});

describe("shell mode", () => {
  it("is bare on every route until hydration completes", () => {
    for (const p of ["/", "/performance", "/auth", "/teams"]) {
      expect(resolveShellMode(p, false)).toBe("bare");
    }
  });

  it("keeps bare routes bare after hydration", () => {
    for (const p of BARE_ROUTES) expect(resolveShellMode(p, true)).toBe("bare");
  });

  it("gives chrome to authenticated routes after hydration", () => {
    for (const p of ["/", "/performance", "/teams", "/users"]) {
      expect(resolveShellMode(p, true)).toBe("chrome");
    }
  });
});

describe("internal link resolution", () => {
  it("accepts every destination the notifications and morning routine use", () => {
    for (const p of [
      "/",
      "/performance",
      "/data-import",
      "/feedback",
      "/competitions",
      "/admin",
      "/targets",
      "/knowledge",
    ]) {
      expect(resolveInternalLink(p)).toEqual({ to: p });
      expect(isKnownInternalPath(p)).toBe(true);
    }
  });

  it("maps a bare anchor onto the home page", () => {
    expect(resolveInternalLink("#underwriting")).toEqual({ to: "/", hash: "underwriting" });
    expect(resolveInternalLink("#calls")).toEqual({ to: "/", hash: "calls" });
  });

  it("keeps a hash on a known path", () => {
    expect(resolveInternalLink("/performance#top")).toEqual({ to: "/performance", hash: "top" });
  });

  it("rejects unknown, external and malformed hrefs", () => {
    for (const p of [
      "/nope",
      "/performance/extra",
      "https://evil.test",
      "//evil.test",
      "performance",
      "",
      "   ",
      "#",
      "/feedback?id=1",
      null,
      undefined,
    ]) {
      expect(resolveInternalLink(p as string | null | undefined)).toBeNull();
    }
  });

  it("tolerates a trailing slash on a known path", () => {
    expect(resolveInternalLink("/teams/")).toEqual({ to: "/teams" });
  });
});
