import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Schedule = {
  id: string;
  repId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  topic: string;
  status: "planned" | "completed" | "cancelled";
};

type State = {
  schedules: Schedule[];
};

const KEY = "renewhub_listening_v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

function seed(): State {
  return {
    schedules: [
      { id: uid(), repId: "r1", date: isoDate(), time: "10:30", topic: "האזנה יזומה - חידושי רכב", status: "planned" },
      { id: uid(), repId: "r3", date: isoDate(), time: "12:00", topic: "מעקב שיפור - סגירה", status: "planned" },
      { id: uid(), repId: "r9", date: addDays(1), time: "09:30", topic: "האזנה שבועית", status: "planned" },
      { id: uid(), repId: "r11", date: addDays(2), time: "11:00", topic: "האזנה מעמיקה - התנגדויות", status: "planned" },
      { id: uid(), repId: "r7", date: addDays(3), time: "14:00", topic: "האזנה שבועית", status: "planned" },
    ],
  };
}

type Ctx = State & {
  addSchedule: (s: Omit<Schedule, "id" | "status"> & { status?: Schedule["status"] }) => void;
  updateSchedule: (id: string, p: Partial<Schedule>) => void;
  removeSchedule: (id: string) => void;
  completeSchedule: (id: string) => void;
};

const C = createContext<Ctx | null>(null);

export function ListeningProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(seed);
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

  const value = useMemo<Ctx>(() => ({
    ...state,
    addSchedule: (s) => setState((st) => ({
      ...st,
      schedules: [{ id: uid(), status: s.status ?? "planned", ...s }, ...st.schedules],
    })),
    updateSchedule: (id, p) => setState((st) => ({
      ...st,
      schedules: st.schedules.map((s) => s.id === id ? { ...s, ...p } : s),
    })),
    removeSchedule: (id) => setState((st) => ({
      ...st,
      schedules: st.schedules.filter((s) => s.id !== id),
    })),
    completeSchedule: (id) => setState((st) => ({
      ...st,
      schedules: st.schedules.map((s) => s.id === id ? { ...s, status: "completed" } : s),
    })),
  }), [state]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useListening() {
  const ctx = useContext(C);
  if (!ctx) throw new Error("useListening outside provider");
  return ctx;
}
