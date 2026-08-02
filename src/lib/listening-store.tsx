import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { useApp } from "@/lib/store";
import { useAuth } from "@/lib/auth";

// Single source of truth for supported statuses — must stay in sync with the
// listening_schedules_status_check CHECK constraint added in
// supabase/migrations/20260801221500_feedback_score_and_schedule_status_constraints.sql.
export const SCHEDULE_STATUSES = ["planned", "completed", "cancelled"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export type Schedule = {
  id: string;
  repId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  topic: string;
  status: ScheduleStatus;
};

type ScheduleRow = {
  id: string;
  representative_id: string;
  scheduled_on: string;
  scheduled_time: string;
  topic: string;
  status: string;
};

type Ctx = {
  schedules: Schedule[];
  addSchedule: (s: Omit<Schedule, "id" | "status"> & { status?: Schedule["status"] }) => void;
  updateSchedule: (id: string, p: Partial<Schedule>) => void;
  removeSchedule: (id: string) => void;
  completeSchedule: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
};

const C = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);

function toRow(p: Partial<Schedule>) {
  const row: Record<string, string> = {};
  if (p.repId !== undefined) row.representative_id = p.repId;
  if (p.date !== undefined) row.scheduled_on = p.date;
  if (p.time !== undefined) row.scheduled_time = p.time;
  if (p.topic !== undefined) row.topic = p.topic;
  if (p.status !== undefined) row.status = p.status;
  return row;
}

export function ListeningProvider({ children }: { children: ReactNode }) {
  const { state } = useApp();
  const { isAdmin, isManager } = useAuth();
  const isRepOnly = !isAdmin && !isManager;
  const repIds = useMemo(() => state.reps.map((r) => r.id), [state.reps]);

  // Same scoping rationale as the feedback query in store.tsx: a rep only ever needs
  // their own schedules, a manager/admin needs every rep they can manage (= state.reps,
  // already RLS-scoped that way).
  const cloud = useCloudCollection<ScheduleRow>("listening_schedules", {
    order: { column: "scheduled_on", ascending: true },
    eq: isRepOnly && state.currentRepId ? { representative_id: state.currentRepId } : undefined,
    in: !isRepOnly && repIds.length > 0 ? { representative_id: repIds } : undefined,
    enabled: isRepOnly ? !!state.currentRepId : repIds.length > 0,
  });
  const [demo, setDemo] = useState<Schedule[]>([]);

  const value = useMemo<Ctx>(() => {
    if (!cloud.live) {
      return {
        schedules: demo,
        addSchedule: (s) => setDemo((st) => [{ id: uid(), status: s.status ?? "planned", ...s }, ...st]),
        updateSchedule: (id, p) => setDemo((st) => st.map((s) => (s.id === id ? { ...s, ...p } : s))),
        removeSchedule: (id) => setDemo((st) => st.filter((s) => s.id !== id)),
        completeSchedule: (id) =>
          setDemo((st) => st.map((s) => (s.id === id ? { ...s, status: "completed" } : s))),
        isLoading: false,
        isError: false,
      };
    }
    const schedules: Schedule[] = cloud.rows.map((r) => ({
      id: r.id,
      repId: r.representative_id,
      date: r.scheduled_on,
      time: r.scheduled_time,
      topic: r.topic,
      status: (r.status as Schedule["status"]) ?? "planned",
    }));
    return {
      schedules,
      addSchedule: (s) =>
        void cloud.insert({ ...toRow({ status: "planned", ...s }) }, "created_by"),
      updateSchedule: (id, p) => void cloud.update(id, toRow(p)),
      removeSchedule: (id) => void cloud.remove(id),
      completeSchedule: (id) => void cloud.update(id, { status: "completed" }),
      isLoading: cloud.isLoading,
      isError: cloud.isError,
    };
  }, [cloud, demo]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useListening() {
  const ctx = useContext(C);
  if (!ctx) throw new Error("useListening outside provider");
  return ctx;
}
