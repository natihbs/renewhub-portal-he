import { useApp } from "@/lib/store";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { resolveAppRole, applyAdminView, type AppRole } from "@/lib/navigation-config";
import { useAdminView } from "@/lib/admin-view";

/**
 * The user's REAL role, from auth (or the demo switcher in Demo Mode) — never
 * affected by the admin business-view switcher. This is what decides whether
 * the switcher itself renders and what any permission-adjacent UI should key
 * on. See resolveAppRole's own doc for the Demo Mode mapping rationale.
 */
export function useRealAppRole(): AppRole {
  const { state } = useApp();
  const { isDemo } = useAppMode();
  const { isAdmin, isManager } = useAuth();
  return resolveAppRole({ isDemo, demoRole: state.role, isAdmin, isManager });
}

/**
 * The one hook every role-aware component (AppShell, CommandPalette, home
 * page, ...) uses to find out "which role's PRESENTATION renders". For a real
 * admin this honors the business-view switcher (presentation only — auth,
 * RLS and permissions are untouched, see navigation-config.ts); for everyone
 * else it is identical to useRealAppRole. Never read state.role/roles
 * directly elsewhere; always go through this so every surface agrees.
 */
export function useResolvedRole(): AppRole {
  const real = useRealAppRole();
  const { mode } = useAdminView();
  return applyAdminView(real, mode);
}
