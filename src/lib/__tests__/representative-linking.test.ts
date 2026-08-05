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
    expect(checkLinkTargetRoleEligibility(["representative"])).toEqual({ eligible: true, reason: null });
  });

  it("an admin account is rejected as privileged — the exact bypass this fix closes", () => {
    expect(checkLinkTargetRoleEligibility(["admin"])).toEqual({ eligible: false, reason: "privileged" });
  });

  it("a manager account is rejected as privileged", () => {
    expect(checkLinkTargetRoleEligibility(["manager"])).toEqual({ eligible: false, reason: "privileged" });
  });

  it("an account holding both representative and admin roles is still rejected as privileged", () => {
    expect(checkLinkTargetRoleEligibility(["representative", "admin"])).toEqual({ eligible: false, reason: "privileged" });
  });

  it("an account with no representative role is rejected as the wrong role", () => {
    expect(checkLinkTargetRoleEligibility([])).toEqual({ eligible: false, reason: "wrong_role" });
  });
});
