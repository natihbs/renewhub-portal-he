import type { AppRole } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

/**
 * Role resolution used by route guards.
 *
 * The important distinction — and the reason this file is not two lines — is
 * "the roles query said this user has no matching role" versus "we could not
 * find out". The first is a real authorization answer and must send the user
 * to /access-denied. The second is a transient failure (network blip,
 * NavigatorLockAcquireTimeoutError from supabase-js token refresh, …) and must
 * never masquerade as a verified empty role set, must never be cached, and
 * must never grant access either.
 */
export type RolesResult =
  | { status: "ok"; userId: string; roles: AppRole[] }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

export type RoleDeps = {
  getUserId: () => Promise<string | null>;
  fetchRoles: (userId: string) => Promise<AppRole[]>;
};

const defaultDeps: RoleDeps = {
  getUserId: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user?.id ?? null;
  },
  fetchRoles: async (userId) => {
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) throw error;
    return ((data ?? []) as { role: AppRole }[]).map((r) => r.role);
  },
};

let cache: { userId: string; roles: AppRole[]; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function clearRoleCache() {
  cache = null;
}

export async function getCurrentRoles(deps: RoleDeps = defaultDeps): Promise<RolesResult> {
  let userId: string | null;
  try {
    userId = await deps.getUserId();
  } catch {
    return { status: "unavailable" };
  }
  if (!userId) return { status: "unauthenticated" };

  if (cache && cache.userId === userId && Date.now() - cache.at < CACHE_TTL_MS) {
    return { status: "ok", userId, roles: cache.roles };
  }

  try {
    const roles = await deps.fetchRoles(userId);
    cache = { userId, roles, at: Date.now() };
    return { status: "ok", userId, roles };
  } catch {
    // Deliberately not cached: an unavailable answer is not an answer.
    return { status: "unavailable" };
  }
}

/** `null` = allowed. Otherwise the path the caller must redirect to. */
export function roleDecision(
  result: RolesResult,
  allowed: AppRole[],
): "/auth" | "/access-denied" | null {
  if (result.status === "unauthenticated") return "/auth";
  // Cannot establish identity/roles: send back through sign-in rather than
  // asserting a denial we did not verify. Never falls through to "allowed".
  if (result.status === "unavailable") return "/auth";
  return result.roles.some((r) => allowed.includes(r)) ? null : "/access-denied";
}
