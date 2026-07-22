import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppMode = "demo" | "live";
const KEY = "renewhub_mode_v1";

type Ctx = {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  isDemo: boolean;
};

const ModeCtx = createContext<Ctx | null>(null);

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>("demo");
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "demo" || v === "live") setModeState(v);
    } catch {}
  }, []);
  const setMode = (m: AppMode) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch {}
  };
  const value = useMemo(() => ({ mode, setMode, isDemo: mode === "demo" }), [mode]);
  return <ModeCtx.Provider value={value}>{children}</ModeCtx.Provider>;
}

export function useAppMode() {
  const ctx = useContext(ModeCtx);
  if (!ctx) {
    // Graceful fallback — avoids crash if consumed outside provider (e.g. during HMR).
    return { mode: "demo" as AppMode, setMode: () => {}, isDemo: true };
  }
  return ctx;
}
