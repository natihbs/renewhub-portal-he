import { redirect, isRedirect } from "@tanstack/react-router";
import type { AppRole } from "@/lib/auth";
import { getCurrentRoles, roleDecision, clearRoleCache } from "@/lib/role-resolution";

export { getCurrentRoles, clearRoleCache };

export async function requireRole(allowed: AppRole[]) {
  let target: "/auth" | "/access-denied" | null;
  try {
    target = roleDecision(await getCurrentRoles(), allowed);
  } catch (error) {
    if (isRedirect(error)) throw error;
    // Never let a transient failure reach the root error boundary.
    console.error("[Pulse] requireRole failed to resolve roles", error);
    target = "/auth";
  }
  if (target) throw redirect({ to: target });
}
