import { useApp } from "@/lib/store";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { resolveAppRole, type AppRole } from "@/lib/navigation-config";

/**
 * The one hook every role-aware component (AppShell, CommandPalette, home
 * page, ...) uses to find out "which role is this" — see resolveAppRole's
 * own doc for the Demo Mode mapping rationale. Never read state.role/roles
 * directly elsewhere; always go through this so every surface agrees.
 */
export function useResolvedRole(): AppRole {
  const { state } = useApp();
  const { isDemo } = useAppMode();
  const { isAdmin, isManager } = useAuth();
  return resolveAppRole({ isDemo, demoRole: state.role, isAdmin, isManager });
}
