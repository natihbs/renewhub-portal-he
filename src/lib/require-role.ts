import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";

let cache: { userId: string; roles: AppRole[]; at: number } | null = null;

export async function getCurrentRoles(): Promise<{ userId: string | null; roles: AppRole[] }> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id ?? null;
  if (!userId) return { userId: null, roles: [] };
  if (cache && cache.userId === userId && Date.now() - cache.at < 30_000) {
    return { userId, roles: cache.roles };
  }
  const { data: rs } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((rs ?? []) as { role: AppRole }[]).map((r) => r.role);
  cache = { userId, roles, at: Date.now() };
  return { userId, roles };
}

export function clearRoleCache() { cache = null; }

export async function requireRole(allowed: AppRole[]) {
  const { userId, roles } = await getCurrentRoles();
  if (!userId) throw redirect({ to: "/auth" });
  if (!roles.some((r) => allowed.includes(r))) {
    throw redirect({ to: "/access-denied" });
  }
}
