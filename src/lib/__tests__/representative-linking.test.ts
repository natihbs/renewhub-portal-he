import { describe, it, expect } from "vitest";
import { checkLinkTargetRoleEligibility } from "@/lib/rep-admin.functions";

// Regression coverage for the P0 fix to representative account linking:
// createRepresentative and updateRepresentative used to write
// representatives.user_id directly, bypassing the role-eligibility check
// that the dedicated linkRepresentativeUser workflow enforced — an admin
// could link a rep record to another admin's or manager's login account
// through the create/edit form, which assertCanLinkUser would have blocked
// on the dedicated linking workflow. checkLinkTargetRoleEligibility is now
// the single rule, enforced unconditionally inside
// linkRepresentativeToUserCore (the only place representatives.user_id is
// ever written) rather than duplicated per call site.
//
// The concurrency-safety half of this fix — two callers racing to link the
// same representative, one with a stale belief about its current link being
// rejected rather than silently overwritten — is enforced by the
// link_representative_to_user RPC's row lock (FOR UPDATE) plus its
// _expected_current_user_id check. This was verified directly against a
// local Postgres instance, not vitest (which has no live database):
// applying the migration and calling the function confirmed a second caller
// whose expected prior link no longer matches the row's actual current link
// is rejected with ERRCODE P0003, and the first caller's link is never
// silently clobbered. See
// 20260806091500_link_representative_to_user.sql's header comment for the
// exact scenarios exercised.

describe("checkLinkTargetRoleEligibility — the P0 fix's single authoritative eligibility rule", () => {
  it("a representative-only account is eligible", () => {
    expect(checkLinkTargetRoleEligibility(["representative"])).toEqual({
      eligible: true,
      reason: null,
    });
  });

  it("an admin account is rejected as privileged — the exact bypass this fix closes", () => {
    expect(checkLinkTargetRoleEligibility(["admin"])).toEqual({
      eligible: false,
      reason: "privileged",
    });
  });

  it("a manager account is rejected as privileged", () => {
    expect(checkLinkTargetRoleEligibility(["manager"])).toEqual({
      eligible: false,
      reason: "privileged",
    });
  });

  it("an account holding both representative and admin roles is still rejected as privileged", () => {
    expect(checkLinkTargetRoleEligibility(["representative", "admin"])).toEqual({
      eligible: false,
      reason: "privileged",
    });
  });

  it("an account with no representative role is rejected as the wrong role", () => {
    expect(checkLinkTargetRoleEligibility([])).toEqual({ eligible: false, reason: "wrong_role" });
  });
});

// ---------------------------------------------------------------------------
// Migration-drift regression (the live incident this guards against): linking
// failed in production with PGRST202 — "Could not find the function
// public.link_representative_to_user(...) in the schema cache" — because the
// connected database was behind the repo's migrations. Two defenses:
//
// 1. Signature pinning: the argument names the TypeScript rpc() calls send
//    must exist, verbatim, in the SQL migration that creates each function.
//    PostgREST resolves functions by named arguments, so a renamed SQL arg
//    (or a renamed TS key) produces exactly the incident's error even with
//    the function present. Reading both sources pins them together.
// 2. The raw PGRST202 text must never reach the admin — it is translated to
//    a clear Hebrew statement pointing at the repair runbook.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateDbFunctionLookupError } from "@/lib/rep-admin.functions";

const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");
const FUNCTIONS_SRC = readFileSync(resolve(__dirname, "../rep-admin.functions.ts"), "utf8");

/** Named args of the single .rpc("<fn>", {...}) call in rep-admin.functions.ts. */
function tsRpcArgNames(fnName: string): string[] {
  const at = FUNCTIONS_SRC.indexOf(`.rpc("${fnName}"`);
  expect(at, `exactly one rpc call site for ${fnName}`).toBeGreaterThan(-1);
  const body = FUNCTIONS_SRC.slice(
    at,
    FUNCTIONS_SRC.indexOf(")", FUNCTIONS_SRC.indexOf(".single()", at)),
  );
  return [...body.matchAll(/(_[a-z_]+):/g)].map((m) => m[1]);
}

/** Declared argument names of CREATE FUNCTION public.<fn>(...) in its migration. */
function sqlArgNames(migrationFile: string, fnName: string): string[] {
  const sql = readFileSync(resolve(MIGRATIONS_DIR, migrationFile), "utf8");
  const at = sql.indexOf(`FUNCTION public.${fnName}(`);
  expect(at, `${fnName} defined in ${migrationFile}`).toBeGreaterThan(-1);
  const head = sql.slice(at, sql.indexOf(")", at));
  return [...head.matchAll(/(_[a-z_]+)\s+(?:uuid|text|boolean|integer|numeric|date)/g)].map(
    (m) => m[1],
  );
}

const RPC_CONTRACTS: { fn: string; migration: string }[] = [
  {
    fn: "link_representative_to_user",
    migration: "20260806091500_link_representative_to_user.sql",
  },
  {
    fn: "set_representative_active_with_profile_sync",
    migration: "20260806090000_set_representative_active_with_profile_sync.sql",
  },
  {
    fn: "update_representative_metrics_with_team_sync",
    migration: "20260806112000_update_representative_metrics_with_team_sync.sql",
  },
  { fn: "toggle_rep_task_done", migration: "20260806111500_toggle_rep_task_done.sql" },
];

describe("RPC signature pinning — TS named args must match the SQL migration exactly", () => {
  for (const { fn, migration } of RPC_CONTRACTS) {
    it(`${fn}: every TS arg exists in SQL and every SQL arg is sent by TS`, () => {
      const ts = tsRpcArgNames(fn).sort();
      const sql = sqlArgNames(migration, fn).sort();
      expect(ts.length).toBeGreaterThan(0);
      expect(ts).toEqual(sql);
    });
  }

  it("pins the exact incident signature: link_representative_to_user's four named args", () => {
    expect(
      sqlArgNames(
        "20260806091500_link_representative_to_user.sql",
        "link_representative_to_user",
      ).sort(),
    ).toEqual(["_check_expected", "_expected_current_user_id", "_rep_id", "_user_id"]);
  });
});

describe("translateDbFunctionLookupError — schema-cache drift becomes clear Hebrew", () => {
  const pgrst202 = {
    code: "PGRST202",
    message:
      "Could not find the function public.link_representative_to_user(_check_expected, _expected_current_user_id, _rep_id, _user_id) in the schema cache",
  };

  it("translates the exact production error into Hebrew that names the function and the fix", () => {
    const msg = translateDbFunctionLookupError(pgrst202, "link_representative_to_user");
    expect(msg).not.toBeNull();
    expect(msg).toContain("link_representative_to_user");
    expect(msg).toContain("REPAIR_RUNBOOK");
    expect(msg).toMatch(/[֐-׿]/);
    expect(msg).not.toContain("schema cache");
  });

  it("recognizes the message shape even without the code", () => {
    expect(
      translateDbFunctionLookupError({ message: pgrst202.message }, "toggle_rep_task_done"),
    ).not.toBeNull();
  });

  it("returns null for real business errors so their specific messages survive", () => {
    for (const error of [
      { code: "P0002", message: "not found" },
      { code: "P0004", message: "already linked" },
      { code: "23505", message: "duplicate key" },
      { message: "network timeout" },
    ]) {
      expect(translateDbFunctionLookupError(error, "link_representative_to_user")).toBeNull();
    }
  });
});
