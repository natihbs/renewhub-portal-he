import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";

export type AppMode = "demo" | "live";

/** Legacy persisted keys that used to force Demo Mode. They are purged on boot. */
const LEGACY_KEYS = ["renewhub_mode_v1", "appMode", "demoMode", "isDemo", "currentMode", "app-mode-store"];
/** Demo Mode is opt-in per browser tab only, never persisted across sessions. */
const DEMO_SESSION_KEY = "renewhub_demo_session";

type Ctx = {
  mode: AppMode;
  isDemo: boolean;
  /** True only when demo mode was explicitly requested by a developer/admin. */
  canUseDemo: boolean;
  exitDemo: () => void;
};

const ModeCtx = createContext<Ctx | null>(null);

function purgeLegacyModeState() {
  for (const k of LEGACY_KEYS) {
    try { localStorage.removeItem(k); } catch {}
    try { sessionStorage.removeItem(k); } catch {}
  }
}

export function AppModeProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const [demoRequested, setDemoRequested] = useState(false);

  useEffect(() => {
    purgeLegacyModeState();
    let requested = false;
    try {
      const params = new URLSearchParams(window.location.search);
      const param = params.get("demo");
      if (param === "true") {
        sessionStorage.setItem(DEMO_SESSION_KEY, "1");
        requested = true;
      } else if (param === "false") {
        sessionStorage.removeItem(DEMO_SESSION_KEY);
      } else {
        requested = sessionStorage.getItem(DEMO_SESSION_KEY) === "1";
      }
    } catch {}
    setDemoRequested(requested);
  }, []);

  const value = useMemo<Ctx>(() => {
    // Demo Mode is allowed only for an explicit request, and only in dev or for admins.
    const canUseDemo = demoRequested && (import.meta.env.DEV || isAdmin);
    // Everyone else — including every authenticated production user — is in Live Mode.
    const mode: AppMode = canUseDemo ? "demo" : "live";

    return {
      mode,
      isDemo: mode === "demo",
      canUseDemo,
      exitDemo: () => {
        try { sessionStorage.removeItem(DEMO_SESSION_KEY); } catch {}
        setDemoRequested(false);
      },
    };
  }, [demoRequested, isAdmin]);

  return <ModeCtx.Provider value={value}>{children}</ModeCtx.Provider>;
}

export function useAppMode() {
  const ctx = useContext(ModeCtx);
  if (!ctx) {
    return { mode: "live" as AppMode, isDemo: false, canUseDemo: false, exitDemo: () => {} };
  }
  return ctx;
}
