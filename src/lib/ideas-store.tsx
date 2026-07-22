import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Idea = {
  id: string;
  text: string;
  category: "רעיון" | "באג" | "שיפור" | "אחר";
  date: string;
};

const KEY = "renewhub_ideas_v1";
const uid = () => Math.random().toString(36).slice(2, 10);

type Ctx = {
  ideas: Idea[];
  addIdea: (i: Omit<Idea, "id" | "date">) => void;
  removeIdea: (id: string) => void;
  clearIdeas: () => void;
};

const IdeasCtx = createContext<Ctx | null>(null);

export function IdeasProvider({ children }: { children: ReactNode }) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setIdeas(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(ideas)); } catch {}
  }, [ideas, hydrated]);

  const value = useMemo<Ctx>(() => ({
    ideas,
    addIdea: (i) => setIdeas((s) => [{ ...i, id: uid(), date: new Date().toISOString() }, ...s]),
    removeIdea: (id) => setIdeas((s) => s.filter((x) => x.id !== id)),
    clearIdeas: () => setIdeas([]),
  }), [ideas]);

  return <IdeasCtx.Provider value={value}>{children}</IdeasCtx.Provider>;
}

export function useIdeas() {
  const ctx = useContext(IdeasCtx);
  if (!ctx) throw new Error("useIdeas outside provider");
  return ctx;
}
