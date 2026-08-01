import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useCloudCollection } from "@/lib/cloud-hooks";

export type Idea = {
  id: string;
  text: string;
  category: "רעיון" | "באג" | "שיפור" | "אחר";
  date: string;
};

type IdeaRow = {
  id: string;
  text: string;
  category: string;
  created_at: string;
};

type Ctx = {
  ideas: Idea[];
  addIdea: (i: Omit<Idea, "id" | "date">) => void;
  removeIdea: (id: string) => void;
  clearIdeas: () => void;
};

const IdeasCtx = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);

export function IdeasProvider({ children }: { children: ReactNode }) {
  const cloud = useCloudCollection<IdeaRow>("ideas", { order: { column: "created_at" } });
  const [demoIdeas, setDemoIdeas] = useState<Idea[]>([]);

  const value = useMemo<Ctx>(() => {
    if (!cloud.live) {
      return {
        ideas: demoIdeas,
        addIdea: (i) => setDemoIdeas((s) => [{ ...i, id: uid(), date: new Date().toISOString() }, ...s]),
        removeIdea: (id) => setDemoIdeas((s) => s.filter((x) => x.id !== id)),
        clearIdeas: () => setDemoIdeas([]),
      };
    }
    const ideas: Idea[] = cloud.rows.map((r) => ({
      id: r.id,
      text: r.text,
      category: (r.category as Idea["category"]) ?? "רעיון",
      date: r.created_at,
    }));
    return {
      ideas,
      addIdea: (i) => void cloud.insert({ text: i.text, category: i.category }, "created_by"),
      removeIdea: (id) => void cloud.remove(id),
      clearIdeas: () => {
        for (const i of ideas) void cloud.remove(i.id);
      },
    };
  }, [cloud, demoIdeas]);

  return <IdeasCtx.Provider value={value}>{children}</IdeasCtx.Provider>;
}

export function useIdeas() {
  const ctx = useContext(IdeasCtx);
  if (!ctx) throw new Error("useIdeas outside provider");
  return ctx;
}
