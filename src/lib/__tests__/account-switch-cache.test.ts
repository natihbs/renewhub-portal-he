// Account-switch cache isolation. Reproduces the live bug: sign in as a center
// manager, sign out, sign in as a team manager in the SAME tab — the header
// must never announce "מנהל מוקד" for the second account, and no full page
// refresh may be required to correct it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import {
  ANONYMOUS_QUERY_IDENTITY,
  USER_SCOPED_QUERY_PREFIXES,
  businessScopeQueryKey,
  queryIdentity,
  shouldResetUserScopedCache,
} from "@/lib/user-scoped-query";
import { accountIdentity } from "@/lib/account-identity";

const hooks = readFileSync(resolve(__dirname, "../business-scope-hooks.ts"), "utf8");

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

describe("business-scope query key is account-scoped", () => {
  it("two different users never share a cache key", () => {
    expect(businessScopeQueryKey(USER_A)).not.toEqual(businessScopeQueryKey(USER_B));
  });

  it("the same user is stable across renders", () => {
    expect(businessScopeQueryKey(USER_A)).toEqual(businessScopeQueryKey(USER_A));
  });

  it("signed-out is its own identity, not a shared bucket with any user", () => {
    expect(businessScopeQueryKey(null)).toEqual(["business-scope", null]);
    expect(businessScopeQueryKey(null)).not.toEqual(businessScopeQueryKey(USER_A));
    expect(queryIdentity(undefined)).toBe(ANONYMOUS_QUERY_IDENTITY);
  });

  it("keeps the 'business-scope' prefix so existing invalidations still match", () => {
    expect(businessScopeQueryKey(USER_A)[0]).toBe("business-scope");
  });

  it("the hook builds its key from the signed-in user, not a static string", () => {
    expect(hooks).toContain('queryKey: ["business-scope", userId] as const');
    expect(hooks).not.toContain('queryKey: ["business-scope"]');
    // A sign-out mid-flight cannot associate a payload with the new key.
    expect(hooks).toContain("userId ? await load() : null");
  });
});

describe("account switch: user B never reads user A's scope", () => {
  it("A's cached center scope is invisible under B's key", () => {
    const qc = new QueryClient();
    qc.setQueryData(businessScopeQueryKey(USER_A), { kind: "center", title: "מנהל מוקד · דירות" });
    expect(qc.getQueryData(businessScopeQueryKey(USER_B))).toBeUndefined();
  });

  it("sign-out removes the previous account's business scope from the cache", () => {
    const qc = new QueryClient();
    qc.setQueryData(businessScopeQueryKey(USER_A), { kind: "center", title: "מנהל מוקד · דירות" });
    // What QueryIdentityBoundary does on an identity transition.
    for (const prefix of USER_SCOPED_QUERY_PREFIXES) qc.removeQueries({ queryKey: [prefix] });
    expect(qc.getQueryData(businessScopeQueryKey(USER_A))).toBeUndefined();
  });

  it("the header label for B is מנהל צוות with no refresh — never A's מנהל מוקד", () => {
    const qc = new QueryClient();
    qc.setQueryData(businessScopeQueryKey(USER_A), { kind: "center", title: "מנהל מוקד · דירות" });
    for (const prefix of USER_SCOPED_QUERY_PREFIXES) qc.removeQueries({ queryKey: [prefix] });

    // B signs in: nothing cached yet -> neutral "מנהל", never "מנהל מוקד".
    const pending = accountIdentity({ roles: ["manager"], scope: null });
    expect(pending.compact).toBe("מנהל");
    expect(pending.compact).not.toBe("מנהל מוקד");

    // B's own scope lands under B's key, in the same session (no refresh).
    qc.setQueryData(businessScopeQueryKey(USER_B), { kind: "team_manager", title: "מנהל צוות" });
    const scope = qc.getQueryData(businessScopeQueryKey(USER_B)) as {
      kind: "team_manager";
      title: string;
    };
    expect(accountIdentity({ roles: ["manager"], scope }).compact).toBe("מנהל צוות");
  });
});

describe("cache reset lifecycle", () => {
  it("the first observed identity is not a transition (no refetch loop)", () => {
    expect(shouldResetUserScopedCache(null, USER_A)).toBe(false);
    expect(shouldResetUserScopedCache(undefined, ANONYMOUS_QUERY_IDENTITY)).toBe(false);
  });

  it("a re-render with the same identity does not reset", () => {
    expect(shouldResetUserScopedCache(USER_A, USER_A)).toBe(false);
  });

  it("sign-out, sign-in and account switch all reset", () => {
    expect(shouldResetUserScopedCache(USER_A, ANONYMOUS_QUERY_IDENTITY)).toBe(true);
    expect(shouldResetUserScopedCache(ANONYMOUS_QUERY_IDENTITY, USER_B)).toBe(true);
    expect(shouldResetUserScopedCache(USER_A, USER_B)).toBe(true);
  });

  it("only user-scoped prefixes are purged — unrelated caches are left alone", () => {
    const qc = new QueryClient();
    qc.setQueryData(["ui", "sidebar"], { open: true });
    qc.setQueryData(businessScopeQueryKey(USER_A), { kind: "center", title: "x" });
    qc.setQueryData(["cloud", "kpi_values", {}], [{ id: "1" }]);
    for (const prefix of USER_SCOPED_QUERY_PREFIXES) qc.removeQueries({ queryKey: [prefix] });
    expect(qc.getQueryData(["ui", "sidebar"])).toEqual({ open: true });
    expect(qc.getQueryData(["cloud", "kpi_values", {}])).toBeUndefined();
  });
});

describe("accountIdentity semantics are unchanged", () => {
  it("maps every managerial scope exactly as before", () => {
    const cases = [
      ["team_manager", "מנהל צוות"],
      ["center", "מנהל מוקד"],
      ["activity", "מנהל פעילות"],
      ["executive", 'סמנכ"ל / מנהל ממ"ט'],
    ] as const;
    for (const [kind, label] of cases) {
      expect(accountIdentity({ roles: ["manager"], scope: { kind, title: "" } }).compact).toBe(
        label,
      );
    }
    expect(accountIdentity({ roles: ["manager"], scope: null }).compact).toBe("מנהל");
  });
});
