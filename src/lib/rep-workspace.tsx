import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { useAuth } from "@/lib/auth";

export type WorkspaceNote = { id: string; author: string; date: string; text: string };
export type WorkspaceTask = {
  id: string;
  title: string;
  due: string;
  priority: "low" | "medium" | "high";
  done: boolean;
};

type NoteRow = {
  id: string;
  representative_id: string;
  author_name: string;
  text: string;
  created_at: string;
};
type TaskRow = {
  id: string;
  representative_id: string;
  title: string;
  due_on: string | null;
  priority: string;
  done: boolean;
};

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
const uid = () => Math.random().toString(36).slice(2, 10);

type DemoStore = { notes: Record<string, WorkspaceNote[]>; tasks: Record<string, WorkspaceTask[]> };

export function RepWorkspaceProvider({ children }: { children: ReactNode }) {
  const [openRepId, setOpenRepId] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoStore>({ notes: {}, tasks: {} });
  const { profile } = useAuth();

  const notes = useCloudCollection<NoteRow>("rep_notes", { order: { column: "created_at" } });
  const tasks = useCloudCollection<TaskRow>("rep_tasks", { order: { column: "created_at" } });

  const value = useMemo<Ctx>(() => {
    const base = { openRepId, open: (id: string) => setOpenRepId(id), close: () => setOpenRepId(null) };

    if (!notes.live) {
      return {
        ...base,
        getNotes: (repId) => demo.notes[repId] ?? [],
        addNote: (repId, text, author = "מנהל") =>
          setDemo((s) => ({
            ...s,
            notes: {
              ...s.notes,
              [repId]: [
                { id: uid(), author, date: new Date().toISOString().slice(0, 10), text },
                ...(s.notes[repId] ?? []),
              ],
            },
          })),
        updateNote: (repId, noteId, text) =>
          setDemo((s) => ({
            ...s,
            notes: { ...s.notes, [repId]: (s.notes[repId] ?? []).map((n) => (n.id === noteId ? { ...n, text } : n)) },
          })),
        deleteNote: (repId, noteId) =>
          setDemo((s) => ({
            ...s,
            notes: { ...s.notes, [repId]: (s.notes[repId] ?? []).filter((n) => n.id !== noteId) },
          })),
        getTasks: (repId) => demo.tasks[repId] ?? [],
        addTask: (repId, t) =>
          setDemo((s) => ({
            ...s,
            tasks: { ...s.tasks, [repId]: [...(s.tasks[repId] ?? []), { ...t, id: uid(), done: false }] },
          })),
        toggleTask: (repId, taskId) =>
          setDemo((s) => ({
            ...s,
            tasks: {
              ...s.tasks,
              [repId]: (s.tasks[repId] ?? []).map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)),
            },
          })),
        deleteTask: (repId, taskId) =>
          setDemo((s) => ({
            ...s,
            tasks: { ...s.tasks, [repId]: (s.tasks[repId] ?? []).filter((t) => t.id !== taskId) },
          })),
      };
    }

    return {
      ...base,
      getNotes: (repId) =>
        notes.rows
          .filter((n) => n.representative_id === repId)
          .map((n) => ({
            id: n.id,
            author: n.author_name || "מנהל",
            date: n.created_at.slice(0, 10),
            text: n.text,
          })),
      addNote: (repId, text, author) =>
        void notes.insert(
          {
            representative_id: repId,
            text,
            author_name: author ?? profile?.full_name ?? "מנהל",
            is_private: true,
          },
          "author_id",
        ),
      updateNote: (_repId, noteId, text) => void notes.update(noteId, { text }),
      deleteNote: (_repId, noteId) => void notes.remove(noteId),
      getTasks: (repId) =>
        tasks.rows
          .filter((t) => t.representative_id === repId)
          .map((t) => ({
            id: t.id,
            title: t.title,
            due: t.due_on ?? "",
            priority: (t.priority as WorkspaceTask["priority"]) ?? "medium",
            done: t.done,
          })),
      addTask: (repId, t) =>
        void tasks.insert(
          {
            representative_id: repId,
            title: t.title,
            due_on: t.due || null,
            priority: t.priority,
            done: false,
          },
          "created_by",
        ),
      toggleTask: (_repId, taskId) => {
        const current = tasks.rows.find((t) => t.id === taskId);
        void tasks.update(taskId, { done: !current?.done });
      },
      deleteTask: (_repId, taskId) => void tasks.remove(taskId),
    };
  }, [openRepId, demo, notes, tasks, profile]);

  return <RepWorkspaceCtx.Provider value={value}>{children}</RepWorkspaceCtx.Provider>;
}

export function useRepWorkspace() {
  const ctx = useContext(RepWorkspaceCtx);
  if (!ctx) throw new Error("useRepWorkspace outside provider");
  return ctx;
}
