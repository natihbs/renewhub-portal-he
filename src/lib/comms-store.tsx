import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CommsKind = "morning" | "evening" | "competition" | "congrats" | "coaching" | "listening";

export const KIND_LABEL: Record<CommsKind, string> = {
  morning: "עדכון בוקר",
  evening: "סיכום ערב",
  competition: "עדכון תחרות",
  congrats: "מסר ברכה אישי",
  coaching: "משוב אימון",
  listening: "משוב האזנה",
};

export type CommsMessage = {
  id: string;
  kind: CommsKind;
  title: string;
  body: string;
  createdAt: string;
};

export type CommsTemplate = {
  id: string;
  kind: CommsKind;
  name: string;
  body: string;
  createdAt: string;
};

type Ctx = {
  history: CommsMessage[];
  templates: CommsTemplate[];
  saveMessage: (m: Omit<CommsMessage, "id" | "createdAt">) => CommsMessage;
  updateMessage: (id: string, patch: Partial<Pick<CommsMessage, "title" | "body">>) => void;
  removeMessage: (id: string) => void;
  duplicateMessage: (id: string) => void;
  saveTemplate: (t: Omit<CommsTemplate, "id" | "createdAt">) => void;
  removeTemplate: (id: string) => void;
};

const HISTORY_KEY = "renewhub_comms_history_v1";
const TEMPLATES_KEY = "renewhub_comms_templates_v1";

const CommsCtx = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);

export function CommsProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<CommsMessage[]>([]);
  const [templates, setTemplates] = useState<CommsTemplate[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const h = localStorage.getItem(HISTORY_KEY);
      if (h) setHistory(JSON.parse(h));
      const t = localStorage.getItem(TEMPLATES_KEY);
      if (t) setTemplates(JSON.parse(t));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
  }, [history, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates)); } catch {}
  }, [templates, hydrated]);

  const saveMessage = useCallback<Ctx["saveMessage"]>((m) => {
    const msg: CommsMessage = { ...m, id: uid(), createdAt: new Date().toISOString() };
    setHistory((h) => [msg, ...h].slice(0, 100));
    return msg;
  }, []);
  const updateMessage = useCallback<Ctx["updateMessage"]>((id, patch) => {
    setHistory((h) => h.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);
  const removeMessage = useCallback((id: string) => setHistory((h) => h.filter((m) => m.id !== id)), []);
  const duplicateMessage = useCallback((id: string) => {
    setHistory((h) => {
      const src = h.find((m) => m.id === id);
      if (!src) return h;
      return [{ ...src, id: uid(), createdAt: new Date().toISOString(), title: `${src.title} (עותק)` }, ...h];
    });
  }, []);
  const saveTemplate = useCallback<Ctx["saveTemplate"]>((t) => {
    setTemplates((all) => [{ ...t, id: uid(), createdAt: new Date().toISOString() }, ...all]);
  }, []);
  const removeTemplate = useCallback((id: string) => setTemplates((all) => all.filter((t) => t.id !== id)), []);

  const value = useMemo<Ctx>(
    () => ({ history, templates, saveMessage, updateMessage, removeMessage, duplicateMessage, saveTemplate, removeTemplate }),
    [history, templates, saveMessage, updateMessage, removeMessage, duplicateMessage, saveTemplate, removeTemplate]
  );

  return <CommsCtx.Provider value={value}>{children}</CommsCtx.Provider>;
}

export function useComms() {
  const ctx = useContext(CommsCtx);
  if (!ctx) throw new Error("useComms outside provider");
  return ctx;
}

/** Replace {{var}} tokens with values. */
export function renderTemplate(tpl: string, vars: Record<string, string | number>) {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}
