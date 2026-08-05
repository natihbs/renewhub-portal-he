import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { toggleRepresentativeTask } from "@/lib/rep-admin.functions";

export type WorkspaceNote = { id: string; author: string; date: string; text: string; isPrivate: boolean };
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
  is_private: boolean;
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
  /** isPrivate defaults to true (manager-only) — a note is only ever shown to the
   * representative it's about when explicitly marked otherwise. */
  addNote: (repId: string, text: string, opts?: { author?: string; isPrivate?: boolean }) => void;
  updateNote: (repId: string, noteId: string, text: string) => void;
  deleteNote: (repId: string, noteId: string) => void;
  getTasks: (repId: string) => WorkspaceTask[];
  addTask: (repId: string, t: Omit<WorkspaceTask, "id" | "done">) => void;
  /**
   * §P1: resolves to the state the DATABASE committed, so the caller can
   * report what actually happened instead of what it predicted. Rejects on a
   * missing/deleted task rather than silently succeeding.
   */
  toggleTask: (repId: string, taskId: string) => Promise<{ done: boolean }>;
  deleteTask: (repId: string, taskId: string) => void;
  isLoading: boolean;
  isError: boolean;
};

const RepWorkspaceCtx = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);

type DemoStore = { notes: Record<string, WorkspaceNote[]>; tasks: Record<string, WorkspaceTask[]> };

export function RepWorkspaceProvider({ children }: { children: ReactNode }) {
  const [openRepId, setOpenRepId] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoStore>({ notes: {}, tasks: {} });
  const { profile, isAdmin, isManager } = useAuth();
  const { state } = useApp();
  const toggleTaskFn = useServerFn(toggleRepresentativeTask);

  // Same scoping rationale as feedback/listening_schedules: a rep only needs their own
  // notes/tasks, a manager/admin needs every rep they can manage (= state.reps).
  const isRepOnly = !isAdmin && !isManager;
  const repIds = useMemo(() => state.reps.map((r) => r.id), [state.reps]);
  const scopeOpts = {
    eq: isRepOnly && state.currentRepId ? { representative_id: state.currentRepId } : undefined,
    in: !isRepOnly && repIds.length > 0 ? { representative_id: repIds } : undefined,
    enabled: isRepOnly ? !!state.currentRepId : repIds.length > 0,
  };
  const notes = useCloudCollection<NoteRow>("rep_notes", { order: { column: "created_at" }, ...scopeOpts });
  const tasks = useCloudCollection<TaskRow>("rep_tasks", { order: { column: "created_at" }, ...scopeOpts });

  const value = useMemo<Ctx>(() => {
    const base = { openRepId, open: (id: string) => setOpenRepId(id), close: () => setOpenRepId(null) };

    if (!notes.live) {
      return {
        ...base,
        isLoading: false,
        isError: false,
        getNotes: (repId) => demo.notes[repId] ?? [],
        addNote: (repId, text, opts) =>
          setDemo((s) => ({
            ...s,
            notes: {
              ...s.notes,
              [repId]: [
                {
                  id: uid(),
                  author: opts?.author ?? "מנהל",
                  date: new Date().toISOString().slice(0, 10),
                  text,
                  isPrivate: opts?.isPrivate ?? true,
                },
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
        toggleTask: async (repId, taskId) => {
          let next = false;
          setDemo((s) => {
            const list = s.tasks[repId] ?? [];
            const current = list.find((t) => t.id === taskId);
            if (!current) return s;
            next = !current.done;
            return { ...s, tasks: { ...s.tasks, [repId]: list.map((t) => (t.id === taskId ? { ...t, done: next } : t)) } };
          });
          return { done: next };
        },
        deleteTask: (repId, taskId) =>
          setDemo((s) => ({
            ...s,
            tasks: { ...s.tasks, [repId]: (s.tasks[repId] ?? []).filter((t) => t.id !== taskId) },
          })),
      };
    }

    return {
      ...base,
      isLoading: notes.isLoading || tasks.isLoading,
      isError: notes.isError || tasks.isError,
      getNotes: (repId) =>
        notes.rows
          .filter((n) => n.representative_id === repId)
          .map((n) => ({
            id: n.id,
            author: n.author_name || "מנהל",
            date: n.created_at.slice(0, 10),
            text: n.text,
            isPrivate: n.is_private,
          })),
      addNote: (repId, text, opts) =>
        void notes.insert(
          {
            representative_id: repId,
            text,
            author_name: opts?.author ?? profile?.full_name ?? "מנהל",
            is_private: opts?.isPrivate ?? true,
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
      // §P1 concurrency: the new value is decided by the database, not by
      // this cache. The old implementation sent `!current?.done` computed from
      // a possibly-stale row — losing one of two concurrent toggles, and
      // forcing done=true whenever the row was missing from the cache.
      // The refetch is awaited before resolving so callers only report success
      // once the list actually reflects the committed state.
      toggleTask: async (_repId, taskId) => {
        const result = await toggleTaskFn({ data: { task_id: taskId } });
        await tasks.refetch();
        return { done: result.done };
      },
      deleteTask: (_repId, taskId) => void tasks.remove(taskId),
    };
  }, [openRepId, demo, notes, tasks, profile, toggleTaskFn]);

  return <RepWorkspaceCtx.Provider value={value}>{children}</RepWorkspaceCtx.Provider>;
}

export function useRepWorkspace() {
  const ctx = useContext(RepWorkspaceCtx);
  if (!ctx) throw new Error("useRepWorkspace outside provider");
  return ctx;
}
