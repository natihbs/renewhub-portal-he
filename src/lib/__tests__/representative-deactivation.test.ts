import { describe, it, expect } from "vitest";
import { canRequestLinkedAccountSync } from "@/lib/rep-admin.functions";

// Regression coverage for the P0 fix to setRepresentativeActive: the
// original handler updated representatives.active FIRST, then only checked
// afterward whether the actor was allowed to also touch the linked profile —
// so a rejected/malicious request from a manager still left the
// representative deactivated, with a misleading client-side error implying
// nothing happened. This is the pure permission gate now checked BEFORE any
// write is attempted (the writes themselves are one atomic RPC —
// set_representative_active_with_profile_sync, see
// 20260806090000_set_representative_active_with_profile_sync.sql).
//
// The transactional/rollback/idempotency/not-found behavior of the RPC
// itself was verified directly against a local Postgres instance (not
// vitest, which has no live database): applying the migration and calling
// the function confirmed (1) a normal admin deactivate-both commits both
// writes, (2) a representative with no linked user handles sync=true as a
// harmless no-op, (3) forcing the profile UPDATE to fail leaves the
// representative completely unchanged — no partial state, (4) repeating an
// already-applied change is idempotent, (5) a nonexistent rep_id raises
// before any write. See the migration file's own header comment for the
// exact scenarios exercised.

describe("canRequestLinkedAccountSync — the P0 fix's permission gate", () => {
  it("manager deactivating a representative only (no linked-account request) is allowed", () => {
    expect(canRequestLinkedAccountSync(false, false)).toBe(true);
    expect(canRequestLinkedAccountSync(false, undefined)).toBe(true);
  });

  it("manager requesting to also deactivate the linked login is rejected — the exact malicious/mistaken request this fix targets", () => {
    expect(canRequestLinkedAccountSync(false, true)).toBe(false);
  });

  it("admin may request the linked-account sync", () => {
    expect(canRequestLinkedAccountSync(true, true)).toBe(true);
  });

  it("admin not requesting the linked-account sync is trivially allowed", () => {
    expect(canRequestLinkedAccountSync(true, false)).toBe(true);
  });
});
