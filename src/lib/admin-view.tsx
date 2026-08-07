import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ADMIN_VIEW_OPTIONS, type AdminViewMode } from "@/lib/navigation-config";

// Admin business-view switcher state — see the doc block in
// navigation-config.ts for what this is (and, more importantly, what it is
// not: it is not impersonation and touches nothing about auth or RLS).
//
// Per browser tab, like Demo Mode: a support session's viewing mode should
// not leak into tomorrow's login, but should survive a refresh mid-session.

const STORAGE_KEY = "pulse_admin_view_mode_v1";

type Ctx = {
  /** The selected presentation mode. Meaningful only for a real admin. */
  mode: AdminViewMode;
  setMode: (m: AdminViewMode) => void;
};

const C = createContext<Ctx | null>(null);

function isValidMode(v: string | null): v is AdminViewMode {
  return ADMIN_VIEW_OPTIONS.some((o) => o.value === v);
}

export function AdminViewProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AdminViewMode>("admin");

  // Restore after hydration only — SSR has no sessionStorage, and reading it
  // during render would make server and client markup disagree.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (isValidMode(stored)) setModeState(stored);
    } catch {
      // sessionStorage unavailable (private mode / SSR) — keep the default.
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      mode,
      setMode: (m) => {
        setModeState(m);
        try {
          sessionStorage.setItem(STORAGE_KEY, m);
        } catch {
          // Persistence is best-effort; the in-memory mode still applies.
        }
      },
    }),
    [mode],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}

/**
 * Safe without a provider (returns the default "admin" mode and a no-op
 * setter) because useResolvedRole calls this from every role-aware component,
 * including ones that render outside the app shell in tests.
 */
export function useAdminView(): Ctx {
  const ctx = useContext(C);
  if (!ctx) return { mode: "admin", setMode: () => {} };
  return ctx;
}
