import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useCloudCollection } from "@/lib/cloud-hooks";

export type CommsKind = "morning" | "evening" | "competition" | "congrats" | "coaching" | "listening";

/**
 * Single source of truth for the valid kind set — mirrored by a DB CHECK
 * constraint on comms_messages.kind / comms_templates.kind (see
 * supabase/migrations/20260803200000_comms_kind_constraint.sql). The DB
 * guarantees every row satisfies this today, but nothing here should ever
 * trust that blindly a second time removed from the write path — see
 * isCommsKind, used at every render-time lookup in communications.tsx.
 */
export const COMMS_KINDS: readonly CommsKind[] = ["morning", "evening", "competition", "congrats", "coaching", "listening"];

export function isCommsKind(value: string): value is CommsKind {
  return (COMMS_KINDS as readonly string[]).includes(value);
}

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

type MessageRow = { id: string; kind: string; title: string; body: string; created_at: string };
type TemplateRow = { id: string; kind: string; name: string; body: string; created_at: string };

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

const CommsCtx = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);

export function CommsProvider({ children }: { children: ReactNode }) {
  const messages = useCloudCollection<MessageRow>("comms_messages", { order: { column: "created_at" } });
  const templatesCloud = useCloudCollection<TemplateRow>("comms_templates", {
    order: { column: "created_at" },
  });
  const [demoHistory, setDemoHistory] = useState<CommsMessage[]>([]);
  const [demoTemplates, setDemoTemplates] = useState<CommsTemplate[]>([]);

  const value = useMemo<Ctx>(() => {
    if (!messages.live) {
      return {
        history: demoHistory,
        templates: demoTemplates,
        saveMessage: (m) => {
          const msg: CommsMessage = { ...m, id: uid(), createdAt: new Date().toISOString() };
          setDemoHistory((h) => [msg, ...h].slice(0, 100));
          return msg;
        },
        updateMessage: (id, patch) =>
          setDemoHistory((h) => h.map((m) => (m.id === id ? { ...m, ...patch } : m))),
        removeMessage: (id) => setDemoHistory((h) => h.filter((m) => m.id !== id)),
        duplicateMessage: (id) =>
          setDemoHistory((h) => {
            const src = h.find((m) => m.id === id);
            if (!src) return h;
            return [{ ...src, id: uid(), createdAt: new Date().toISOString(), title: `${src.title} (עותק)` }, ...h];
          }),
        saveTemplate: (t) =>
          setDemoTemplates((all) => [{ ...t, id: uid(), createdAt: new Date().toISOString() }, ...all]),
        removeTemplate: (id) => setDemoTemplates((all) => all.filter((t) => t.id !== id)),
      };
    }

    const history: CommsMessage[] = messages.rows.map((r) => ({
      id: r.id,
      kind: r.kind as CommsKind,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
    }));
    const templates: CommsTemplate[] = templatesCloud.rows.map((r) => ({
      id: r.id,
      kind: r.kind as CommsKind,
      name: r.name,
      body: r.body,
      createdAt: r.created_at,
    }));

    return {
      history,
      templates,
      saveMessage: (m) => {
        void messages.insert({ kind: m.kind, title: m.title, body: m.body }, "created_by");
        return { ...m, id: uid(), createdAt: new Date().toISOString() };
      },
      updateMessage: (id, patch) => void messages.update(id, { ...patch }),
      removeMessage: (id) => void messages.remove(id),
      duplicateMessage: (id) => {
        const src = history.find((m) => m.id === id);
        if (!src) return;
        void messages.insert(
          { kind: src.kind, title: `${src.title} (עותק)`, body: src.body },
          "created_by",
        );
      },
      saveTemplate: (t) =>
        void templatesCloud.insert({ kind: t.kind, name: t.name, body: t.body }, "created_by"),
      removeTemplate: (id) => void templatesCloud.remove(id),
    };
  }, [messages, templatesCloud, demoHistory, demoTemplates]);

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
