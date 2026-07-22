import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type RefreshStatus = "complete" | "partial" | "failed";

export type ManagerCall = {
  id: string;
  repId: string;
  subject: string;
  scheduledAt: string; // ISO
  status: "planned" | "completed" | "overdue";
  summary?: string;
  followUpAt?: string;
};

export type UnderwritingStatus = "חדש" | "בטיפול" | "ממתין לחיתום" | "ממתין לנציג" | "הושלם";
export type UnderwritingPriority = "low" | "medium" | "high";

export type UnderwritingIssue = {
  id: string;
  repId: string;
  subject: string;
  priority: UnderwritingPriority;
  openedAt: string;
  status: UnderwritingStatus;
  owner: string;
  dueAt: string;
};

type MorningState = {
  lastRefreshAt: string | null;
  refreshStatus: RefreshStatus;
  dataAsOf: string; // YYYY-MM-DD
  yesterdayRenewalPct: number;
  monthlyAvgRenewalPct: number;
  managerCalls: ManagerCall[];
  underwriting: UnderwritingIssue[];
  checklistByDate: Record<string, Record<string, boolean>>;
  savedUpdateTemplate: string | null;
};

const KEY = "renewhub_morning_v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);

function seed(): MorningState {
  const now = new Date();
  now.setHours(7, 40, 0, 0);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return {
    lastRefreshAt: now.toISOString(),
    refreshStatus: "complete",
    dataAsOf: isoDate(yesterday),
    yesterdayRenewalPct: 71,
    monthlyAvgRenewalPct: 68,
    managerCalls: [
      { id: uid(), repId: "", subject: "שיחת ליווי - התנגדויות מחיר", scheduledAt: new Date(Date.now() + 3600e3).toISOString(), status: "planned" },
      { id: uid(), repId: "", subject: "שיחת משוב אחרי האזנה", scheduledAt: new Date(Date.now() - 26 * 3600e3).toISOString(), status: "overdue" },
      { id: uid(), repId: "", subject: "מעקב יעדי חודש", scheduledAt: new Date(Date.now() - 3 * 3600e3).toISOString(), status: "completed", summary: "הוצבו יעדים שבועיים" },
    ],
    underwriting: [
      { id: uid(), repId: "", subject: "אישור חריג במסלול רכב", priority: "high", openedAt: isoDate(yesterday), status: "ממתין לחיתום", owner: "חיתום", dueAt: isoDate(new Date(Date.now() + 24 * 3600e3)) },
      { id: uid(), repId: "", subject: "עדכון תנאי דירה - הצפה", priority: "medium", openedAt: isoDate(yesterday), status: "בטיפול", owner: "מנהל צוות", dueAt: isoDate(new Date(Date.now() + 3 * 24 * 3600e3)) },
      { id: uid(), repId: "", subject: "בקשת הנחה חריגה", priority: "low", openedAt: isoDate(new Date(Date.now() - 3 * 24 * 3600e3)), status: "ממתין לנציג", owner: "נציג", dueAt: isoDate(new Date(Date.now() + 2 * 24 * 3600e3)) },
    ],
    checklistByDate: {},
    savedUpdateTemplate: null,
  };
}

type Ctx = MorningState & {
  simulateRefresh: (status?: RefreshStatus) => void;
  addManagerCall: (c: Omit<ManagerCall, "id" | "status"> & { status?: ManagerCall["status"] }) => void;
  updateManagerCall: (id: string, p: Partial<ManagerCall>) => void;
  removeManagerCall: (id: string) => void;
  addUnderwriting: (u: Omit<UnderwritingIssue, "id" | "openedAt"> & { openedAt?: string }) => void;
  updateUnderwriting: (id: string, p: Partial<UnderwritingIssue>) => void;
  removeUnderwriting: (id: string) => void;
  toggleChecklist: (task: string) => void;
  isChecked: (task: string) => boolean;
  saveTemplate: (text: string) => void;
};

const MCtx = createContext<Ctx | null>(null);

export function MorningProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MorningState>(seed);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState({ ...seed(), ...JSON.parse(raw) });
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state, hydrated]);

  const today = isoDate();

  const value = useMemo<Ctx>(() => ({
    ...state,
    simulateRefresh: (status = "complete") => setState((s) => ({
      ...s,
      lastRefreshAt: new Date().toISOString(),
      refreshStatus: status,
      dataAsOf: isoDate(new Date(Date.now() - 24 * 3600e3)),
    })),
    addManagerCall: (c) => setState((s) => ({
      ...s,
      managerCalls: [{ id: uid(), status: c.status ?? "planned", ...c }, ...s.managerCalls],
    })),
    updateManagerCall: (id, p) => setState((s) => ({
      ...s,
      managerCalls: s.managerCalls.map((c) => c.id === id ? { ...c, ...p } : c),
    })),
    removeManagerCall: (id) => setState((s) => ({
      ...s,
      managerCalls: s.managerCalls.filter((c) => c.id !== id),
    })),
    addUnderwriting: (u) => setState((s) => ({
      ...s,
      underwriting: [{ id: uid(), openedAt: u.openedAt ?? isoDate(), ...u }, ...s.underwriting],
    })),
    updateUnderwriting: (id, p) => setState((s) => ({
      ...s,
      underwriting: s.underwriting.map((u) => u.id === id ? { ...u, ...p } : u),
    })),
    removeUnderwriting: (id) => setState((s) => ({
      ...s,
      underwriting: s.underwriting.filter((u) => u.id !== id),
    })),
    toggleChecklist: (task) => setState((s) => {
      const day = s.checklistByDate[today] ?? {};
      return {
        ...s,
        checklistByDate: { ...s.checklistByDate, [today]: { ...day, [task]: !day[task] } },
      };
    }),
    isChecked: (task) => !!state.checklistByDate[today]?.[task],
    saveTemplate: (text) => setState((s) => ({ ...s, savedUpdateTemplate: text })),
  }), [state, today]);

  return <MCtx.Provider value={value}>{children}</MCtx.Provider>;
}

export function useMorning() {
  const ctx = useContext(MCtx);
  if (!ctx) throw new Error("useMorning outside provider");
  return ctx;
}
