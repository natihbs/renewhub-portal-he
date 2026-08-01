import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useCloudCollection } from "@/lib/cloud-hooks";

export type Schedule = {
  id: string;
  repId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  topic: string;
  status: "planned" | "completed" | "cancelled";
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
  const cloud = useCloudCollection<ScheduleRow>("listening_schedules", {
    order: { column: "scheduled_on", ascending: true },
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
    };
  }, [cloud, demo]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useListening() {
  const ctx = useContext(C);
  if (!ctx) throw new Error("useListening outside provider");
  return ctx;
}
