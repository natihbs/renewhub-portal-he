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
  /**
   * Demo Mode implementations. In Live Mode these throw — every real write
   * goes through useFeedbackActions() (src/lib/feedback-hooks.ts), which is
   * awaited, authorized, audited, and able to report failure. See the comment
   * on the live branch below.
   */
  addSchedule: (s: Omit<Schedule, "id" | "status"> & { status?: Schedule["status"] }) => void;
  updateSchedule: (id: string, p: Partial<Schedule>) => void;
  removeSchedule: (id: string) => void;
  completeSchedule: (id: string) => void;
  /** True in Live Mode: the caller must use the server-backed write path. */
  live: boolean;
  /** Re-read the collection after a server-backed write. */
  refresh: () => void;
  isLoading: boolean;
  isError: boolean;
};

const C = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);

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
        live: false,
        refresh: () => {},
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
    // §Feedback hardening: these were `void cloud.insert/update/remove(...)` —
    // fire-and-forget writes through the generic proxy. A rejection was
    // recorded by error-capture.ts and never shown, so cancelling or deleting
    // a session reported success whether or not anything happened, and
    // deleting a session that had produced an evaluation silently detached
    // that evaluation from the listening it came from.
    //
    // Every write now goes through useFeedbackActions() (feedback-hooks.ts),
    // which awaits the result, surfaces failures and enforces the blockers.
    // These throw so a missed call site fails loudly instead of silently.
    const liveWriteError = () => {
      throw new Error("שינוי האזנה במצב מחובר מתבצע דרך useFeedbackActions()");
    };
    return {
      schedules,
      addSchedule: liveWriteError,
      updateSchedule: liveWriteError,
      removeSchedule: liveWriteError,
      completeSchedule: liveWriteError,
      live: true,
      refresh: cloud.refresh,
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
