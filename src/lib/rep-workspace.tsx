import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type WorkspaceNote = { id: string; author: string; date: string; text: string };
export type WorkspaceTask = {
  id: string;
  title: string;
  due: string;
  priority: "low" | "medium" | "high";
  done: boolean;
};

type Store = {
  notes: Record<string, WorkspaceNote[]>;
  tasks: Record<string, WorkspaceTask[]>;
};

const KEY = "renewhub_workspace_v1";
const uid = () => Math.random().toString(36).slice(2, 10);

function loadStore(): Store {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return { notes: {}, tasks: {}, ...JSON.parse(raw) };
  } catch {}
  return { notes: {}, tasks: {} };
}

type Ctx = {
  openRepId: string | null;
  open: (repId: string) => void;
  close: () => void;
  getNotes: (repId: string) => WorkspaceNote[];
  addNote: (repId: string, text: string, author?: string) => void;
  updateNote: (repId: string, noteId: string, text: string) => void;
  deleteNote: (repId: string, noteId: string) => void;
  getTasks: (repId: string) => WorkspaceTask[];
  addTask: (repId: string, t: Omit<WorkspaceTask, "id" | "done">) => void;
  toggleTask: (repId: string, taskId: string) => void;
  deleteTask: (repId: string, taskId: string) => void;
};

const RepWorkspaceCtx = createContext<Ctx | null>(null);

export function RepWorkspaceProvider({ children }: { children: ReactNode }) {
  const [openRepId, setOpenRepId] = useState<string | null>(null);
  const [store, setStore] = useState<Store>({ notes: {}, tasks: {} });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { setStore(loadStore()); setHydrated(true); }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {}
  }, [store, hydrated]);

  const value = useMemo<Ctx>(() => ({
    openRepId,
    open: (id) => setOpenRepId(id),
    close: () => setOpenRepId(null),
    getNotes: (repId) => store.notes[repId] ?? [],
    addNote: (repId, text, author = "מנהל") => setStore((s) => ({
      ...s,
      notes: { ...s.notes, [repId]: [{ id: uid(), author, date: new Date().toISOString().slice(0, 10), text }, ...(s.notes[repId] ?? [])] },
    })),
    updateNote: (repId, noteId, text) => setStore((s) => ({
      ...s,
      notes: { ...s.notes, [repId]: (s.notes[repId] ?? []).map((n) => n.id === noteId ? { ...n, text } : n) },
    })),
    deleteNote: (repId, noteId) => setStore((s) => ({
      ...s,
      notes: { ...s.notes, [repId]: (s.notes[repId] ?? []).filter((n) => n.id !== noteId) },
    })),
    getTasks: (repId) => store.tasks[repId] ?? [],
    addTask: (repId, t) => setStore((s) => ({
      ...s,
      tasks: { ...s.tasks, [repId]: [...(s.tasks[repId] ?? []), { ...t, id: uid(), done: false }] },
    })),
    toggleTask: (repId, taskId) => setStore((s) => ({
      ...s,
      tasks: { ...s.tasks, [repId]: (s.tasks[repId] ?? []).map((t) => t.id === taskId ? { ...t, done: !t.done } : t) },
    })),
    deleteTask: (repId, taskId) => setStore((s) => ({
      ...s,
      tasks: { ...s.tasks, [repId]: (s.tasks[repId] ?? []).filter((t) => t.id !== taskId) },
    })),
  }), [openRepId, store]);

  return <RepWorkspaceCtx.Provider value={value}>{children}</RepWorkspaceCtx.Provider>;
}

export function useRepWorkspace() {
  const ctx = useContext(RepWorkspaceCtx);
  if (!ctx) throw new Error("useRepWorkspace outside provider");
  return ctx;
}
