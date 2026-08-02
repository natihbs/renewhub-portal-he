import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { useAuth } from "@/lib/auth";

export type RefreshStatus = "complete" | "partial" | "failed";

export type ManagerCall = {
  id: string;
  repId: string;
  subject: string;
  scheduledAt: string; // ISO
  status: "planned" | "completed" | "overdue";
  summary?: string;
  followUpAt?: string;
};

export type UnderwritingStatus = "חדש" | "בטיפול" | "ממתין לחיתום" | "ממתין לנציג" | "הושלם";
export type UnderwritingPriority = "low" | "medium" | "high";

export type UnderwritingIssue = {
  id: string;
  repId: string;
  subject: string;
  priority: UnderwritingPriority;
  openedAt: string;
  status: UnderwritingStatus;
  owner: string;
  dueAt: string;
};

type CallRow = {
  id: string;
  representative_id: string | null;
  subject: string;
  scheduled_at: string;
  status: string;
  summary: string | null;
  follow_up_at: string | null;
};
type IssueRow = {
  id: string;
  representative_id: string | null;
  subject: string;
  priority: string;
  opened_on: string;
  status: string;
  owner: string;
  due_on: string | null;
};
type ChecklistRow = { id: string; checklist_date: string; task_key: string; checked: boolean };
type SettingsRow = {
  user_id: string;
  saved_update_template: string | null;
  last_refresh_at: string | null;
  refresh_status: string;
  data_as_of: string | null;
  /** @deprecated mislabeled as a renewal rate; replaced by yesterday_achievement_pct. */
  yesterday_renewal_pct: number;
  /** @deprecated mislabeled as a renewal rate; replaced by monthly_avg_achievement_pct. */
  monthly_avg_renewal_pct: number;
  yesterday_achievement_pct: number;
  monthly_avg_achievement_pct: number;
};

type Ctx = {
  lastRefreshAt: string | null;
  refreshStatus: RefreshStatus;
  dataAsOf: string;
  yesterdayAchievementPct: number;
  monthlyAvgAchievementPct: number;
  managerCalls: ManagerCall[];
  underwriting: UnderwritingIssue[];
  savedUpdateTemplate: string | null;
  simulateRefresh: (status?: RefreshStatus) => void;
  addManagerCall: (c: Omit<ManagerCall, "id" | "status"> & { status?: ManagerCall["status"] }) => void;
  updateManagerCall: (id: string, p: Partial<ManagerCall>) => void;
  removeManagerCall: (id: string) => void;
  addUnderwriting: (u: Omit<UnderwritingIssue, "id" | "openedAt"> & { openedAt?: string }) => void;
  updateUnderwriting: (id: string, p: Partial<UnderwritingIssue>) => void;
  removeUnderwriting: (id: string) => void;
  toggleChecklist: (task: string) => void;
  isChecked: (task: string) => boolean;
  saveTemplate: (text: string) => void;
};

const MCtx = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);
const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);

export function MorningProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const calls = useCloudCollection<CallRow>("manager_calls", {
    order: { column: "scheduled_at", ascending: true },
  });
  const issues = useCloudCollection<IssueRow>("underwriting_issues", { order: { column: "opened_on" } });
  const today = isoDate();
  const checklist = useCloudCollection<ChecklistRow>("morning_checklist", {
    eq: { checklist_date: today },
  });
  const settings = useCloudCollection<SettingsRow>("morning_settings", {});

  const [demoCalls, setDemoCalls] = useState<ManagerCall[]>([]);
  const [demoIssues, setDemoIssues] = useState<UnderwritingIssue[]>([]);
  const [demoChecklist, setDemoChecklist] = useState<Record<string, boolean>>({});
  const [demoTemplate, setDemoTemplate] = useState<string | null>(null);

  const value = useMemo<Ctx>(() => {
    if (!calls.live) {
      return {
        lastRefreshAt: null,
        refreshStatus: "complete",
        dataAsOf: isoDate(new Date(Date.now() - 24 * 3600e3)),
        yesterdayAchievementPct: 0,
        monthlyAvgAchievementPct: 0,
        managerCalls: demoCalls,
        underwriting: demoIssues,
        savedUpdateTemplate: demoTemplate,
        simulateRefresh: () => {},
        addManagerCall: (c) =>
          setDemoCalls((s) => [{ id: uid(), status: c.status ?? "planned", ...c }, ...s]),
        updateManagerCall: (id, p) => setDemoCalls((s) => s.map((c) => (c.id === id ? { ...c, ...p } : c))),
        removeManagerCall: (id) => setDemoCalls((s) => s.filter((c) => c.id !== id)),
        addUnderwriting: (u) =>
          setDemoIssues((s) => [{ id: uid(), openedAt: u.openedAt ?? isoDate(), ...u }, ...s]),
        updateUnderwriting: (id, p) => setDemoIssues((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x))),
        removeUnderwriting: (id) => setDemoIssues((s) => s.filter((x) => x.id !== id)),
        toggleChecklist: (task) => setDemoChecklist((s) => ({ ...s, [task]: !s[task] })),
        isChecked: (task) => !!demoChecklist[task],
        saveTemplate: (text) => setDemoTemplate(text),
      };
    }

    const s = settings.rows[0];
    const managerCalls: ManagerCall[] = calls.rows.map((c) => ({
      id: c.id,
      repId: c.representative_id ?? "",
      subject: c.subject,
      scheduledAt: c.scheduled_at,
      status: (c.status as ManagerCall["status"]) ?? "planned",
      summary: c.summary ?? undefined,
      followUpAt: c.follow_up_at ?? undefined,
    }));
    const underwriting: UnderwritingIssue[] = issues.rows.map((i) => ({
      id: i.id,
      repId: i.representative_id ?? "",
      subject: i.subject,
      priority: (i.priority as UnderwritingPriority) ?? "medium",
      openedAt: i.opened_on,
      status: (i.status as UnderwritingStatus) ?? "חדש",
      owner: i.owner,
      dueAt: i.due_on ?? "",
    }));

    return {
      lastRefreshAt: s?.last_refresh_at ?? null,
      refreshStatus: (s?.refresh_status as RefreshStatus) ?? "complete",
      dataAsOf: s?.data_as_of ?? isoDate(new Date(Date.now() - 24 * 3600e3)),
      // New column is authoritative; fall back to the deprecated renewal-named column
      // for any row written before this migration, then to 0.
      yesterdayAchievementPct: s?.yesterday_achievement_pct ?? s?.yesterday_renewal_pct ?? 0,
      monthlyAvgAchievementPct: s?.monthly_avg_achievement_pct ?? s?.monthly_avg_renewal_pct ?? 0,
      managerCalls,
      underwriting,
      savedUpdateTemplate: s?.saved_update_template ?? null,
      simulateRefresh: (status = "complete") =>
        void settings.upsert(
          {
            user_id: user?.id ?? "",
            last_refresh_at: new Date().toISOString(),
            refresh_status: status,
            data_as_of: isoDate(new Date(Date.now() - 24 * 3600e3)),
          },
          "user_id",
        ),
      addManagerCall: (c) =>
        void calls.insert({
          representative_id: c.repId || null,
          subject: c.subject,
          scheduled_at: c.scheduledAt,
          status: c.status ?? "planned",
          summary: c.summary ?? null,
          follow_up_at: c.followUpAt ?? null,
          owner_id: user?.id ?? "",
        }),
      updateManagerCall: (id, p) => {
        const row: Record<string, string | null> = {};
        if (p.repId !== undefined) row.representative_id = p.repId || null;
        if (p.subject !== undefined) row.subject = p.subject;
        if (p.scheduledAt !== undefined) row.scheduled_at = p.scheduledAt;
        if (p.status !== undefined) row.status = p.status;
        if (p.summary !== undefined) row.summary = p.summary ?? null;
        if (p.followUpAt !== undefined) row.follow_up_at = p.followUpAt ?? null;
        void calls.update(id, row);
      },
      removeManagerCall: (id) => void calls.remove(id),
      addUnderwriting: (u) =>
        void issues.insert(
          {
            representative_id: u.repId || null,
            subject: u.subject,
            priority: u.priority,
            opened_on: u.openedAt ?? isoDate(),
            status: u.status,
            owner: u.owner,
            due_on: u.dueAt || null,
          },
          "created_by",
        ),
      updateUnderwriting: (id, p) => {
        const row: Record<string, string | null> = {};
        if (p.repId !== undefined) row.representative_id = p.repId || null;
        if (p.subject !== undefined) row.subject = p.subject;
        if (p.priority !== undefined) row.priority = p.priority;
        if (p.openedAt !== undefined) row.opened_on = p.openedAt;
        if (p.status !== undefined) row.status = p.status;
        if (p.owner !== undefined) row.owner = p.owner;
        if (p.dueAt !== undefined) row.due_on = p.dueAt || null;
        void issues.update(id, row);
      },
      removeUnderwriting: (id) => void issues.remove(id),
      toggleChecklist: (task) => {
        const current = checklist.rows.find((r) => r.task_key === task);
        void checklist.upsert(
          {
            user_id: user?.id ?? "",
            checklist_date: today,
            task_key: task,
            checked: !current?.checked,
          },
          "user_id,checklist_date,task_key",
        );
      },
      isChecked: (task) => !!checklist.rows.find((r) => r.task_key === task)?.checked,
      saveTemplate: (text) =>
        void settings.upsert({ user_id: user?.id ?? "", saved_update_template: text }, "user_id"),
    };
  }, [calls, issues, checklist, settings, user, today, demoCalls, demoIssues, demoChecklist, demoTemplate]);

  return <MCtx.Provider value={value}>{children}</MCtx.Provider>;
}

export function useMorning() {
  const ctx = useContext(MCtx);
  if (!ctx) throw new Error("useMorning outside provider");
  return ctx;
}
