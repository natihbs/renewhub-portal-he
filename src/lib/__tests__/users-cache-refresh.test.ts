// /users stale-display hardening: business_title and health are SERVER-derived
// (listUsers), so the only correct client behavior is to refetch — never to
// trust a snapshot cached while an admin was mid-way through configuring
// scopes. Two mechanisms, both exercised here against a real QueryClient:
//   1. every user-admin / team-admin / hierarchy mutation invalidates every
//      cache that displays user rows or resolved scope;
//   2. /users additionally refetches on every mount (refetchOnMount:"always"),
//      so even a snapshot some other screen marked fresh cannot survive
//      navigation without a correcting server round trip.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { invalidateUserAdminCaches } from "@/routes/_authenticated/users";
import { invalidateTeamAdminCaches } from "@/routes/_authenticated/teams";
import { effectiveBusinessTitle } from "../business-scope";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const usersSrc = read("../../routes/_authenticated/users.tsx");
const teamsSrc = read("../../routes/_authenticated/teams.tsx");

// Every query key a real component reads user-row / scope data from.
function seedUserCaches(qc: QueryClient) {
  const seeded = [
    ["admin", "users"], // /users table + AdminHome counters (business_title lives here)
    ["admin", "user-details", "u-liron"], // details drawer (business_title + health)
    ["admin", "user-delete-check", "u-liron"],
    ["admin", "audit"],
    ["representatives"], // store mirror -> WorkspaceProvider + home dashboards
    ["business-scope"], // caller's own resolved scope (header identity line)
  ];
  for (const key of seeded) qc.setQueryData(key, { stale: "pre-mutation snapshot" });
  return seeded;
}

describe("invalidateUserAdminCaches — user mutations stale every user-row consumer", () => {
  it("leaves no seeded cache un-invalidated (create/role/email/link flows all route here)", async () => {
    const qc = new QueryClient();
    const seeded = seedUserCaches(qc);
    await invalidateUserAdminCaches(qc);
    for (const key of seeded) {
      expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
  });

  it("users.tsx routes every dialog's onDone through it", () => {
    expect(usersSrc).toContain("export function invalidateUserAdminCaches");
    expect(usersSrc).toContain("return invalidateUserAdminCaches(qc);");
    // The old prefix-only body must not linger as a second, weaker path.
    expect(usersSrc).not.toContain('qc.invalidateQueries({ queryKey: ["admin"] });\n  }');
  });
});

describe("invalidateTeamAdminCaches — scope/hierarchy mutations stale /users too", () => {
  it("a business-scope mutation cannot leave a stale business_title anywhere", async () => {
    const qc = new QueryClient();
    seedUserCaches(qc);
    // The hierarchy card's refresh() routes setUserBusinessScope success
    // through onChanged = invalidateTeamAdminCaches — this is that path.
    await invalidateTeamAdminCaches(qc);
    expect(qc.getQueryState(["admin", "users"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["admin", "user-details", "u-liron"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["business-scope"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["representatives"])?.isInvalidated).toBe(true);
  });

  it("the hierarchy card awaits the shared invalidation on every scope/unit/attach success", () => {
    const card = teamsSrc.slice(teamsSrc.indexOf("function BusinessHierarchyCard"));
    expect(card).toContain("const refresh = async () => {");
    expect(card).toContain("await onChanged();");
    expect(teamsSrc).toContain("<BusinessHierarchyCard onChanged={invalidate} />");
    expect(teamsSrc).toContain("const invalidate = () => invalidateTeamAdminCaches(qc);");
  });
});

describe("/users never trusts a cached snapshot across navigation", () => {
  it('the users list query refetches on every mount ("always")', () => {
    const usersQ = usersSrc.slice(
      usersSrc.indexOf('queryKey: ["admin", "users"]'),
      usersSrc.indexOf('queryKey: ["admin", "audit"]'),
    );
    expect(usersQ).toContain('refetchOnMount: "always"');
  });

  it("no client-side title recomputation — business_title stays server-derived", () => {
    // The page renders u.business_title / d.user.business_title from listUsers
    // and never calls the derivation itself.
    expect(usersSrc).not.toContain("effectiveBusinessTitle(");
    expect(usersSrc).toContain("user.business_title");
  });
});

describe("expected titles once the fresh rows arrive (server derivation, unchanged)", () => {
  it('זיו שיפמן (manager + executive) → סמנכ"ל / מנהל ממ"ט · כלל הפעילות העסקית', () => {
    expect(
      effectiveBusinessTitle({
        roles: ["manager"],
        grants: [{ scopeType: "executive", unitName: null }],
      }),
    ).toBe('סמנכ"ל / מנהל ממ"ט · כלל הפעילות העסקית');
  });

  it("יונתן שמש (manager + activity אלמנטרי) → מנהל פעילות · אלמנטרי", () => {
    expect(
      effectiveBusinessTitle({
        roles: ["manager"],
        grants: [{ scopeType: "activity", unitName: "אלמנטרי" }],
      }),
    ).toBe("מנהל פעילות · אלמנטרי");
  });

  it("לירון ג׳ורנו (manager + center דירות וחידושים) → מנהל מוקד · דירות וחידושים", () => {
    expect(
      effectiveBusinessTitle({
        roles: ["manager"],
        grants: [{ scopeType: "center", unitName: "דירות וחידושים" }],
      }),
    ).toBe("מנהל מוקד · דירות וחידושים");
  });
});

describe("safety — cache hardening only", () => {
  it("no DB/RLS/role surface in the touched files", () => {
    for (const src of [usersSrc, teamsSrc]) {
      expect(src).not.toContain("ALTER ");
      expect(src).not.toContain('from("user_business_scopes")');
    }
    // Technical roles untouched.
    expect(usersSrc).toContain('<SelectItem value="admin">מנהל מערכת</SelectItem>');
    expect(usersSrc).toContain('<SelectItem value="representative">נציג</SelectItem>');
  });
});
