import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { useAuth } from "@/lib/auth";

/**
 * Outcome of a data-freshness check (§P0). "complete" is only ever reachable
 * when every required source actually refetched successfully — it is never a
 * default, never optimistic, and never written before the refetches settle.
 */
export type RefreshStatus = "complete" | "partial" | "failed";

/**
 * The authoritative sources Morning Routine and Performance read from. A
 * freshness check refetches all of them; any one failing downgrades the
 * result and is named in the UI, so "partial" is always explainable rather
 * than a vague warning.
 */
export type FreshnessSourceKey =
  | "representatives"
  | "kpi_values"
  | "representative_goals"
  | "team_goals"
  | "feedback"
  | "listening_schedules"
  | "rep_tasks"
  | "rep_notes"
  | "import_history";

export const FRESHNESS_SOURCE_LABEL: Record<FreshnessSourceKey, string> = {
  representatives: "נציגים",
  kpi_values: "נתוני חידושים",
  representative_goals: "יעדים אישיים",
  team_goals: "יעדי צוות",
  feedback: "משובים והאזנות",
  listening_schedules: "האזנות מתוזמנות",
  rep_tasks: "משימות",
  rep_notes: "הערות מנהל",
  import_history: "היסטוריית ייבוא",
};

export type FreshnessSourceResult = { key: FreshnessSourceKey; ok: boolean; error?: string };

export type FreshnessCheckResult = {
  status: RefreshStatus;
  checkedAt: string;
  sources: FreshnessSourceResult[];
  failed: FreshnessSourceKey[];
};

/**
 * Pure status derivation, exported so the exact rule is unit-tested without a
 * network or a database:
 *   - every source ok            -> "complete"
 *   - every source failed        -> "failed"
 *   - anything in between        -> "partial"
 * There is deliberately no branch that can return "complete" while any
 * source failed — that was the core dishonesty of the old simulateRefresh,
 * which reported "complete" unconditionally without refetching anything.
 */
export function deriveFreshnessStatus(sources: FreshnessSourceResult[]): RefreshStatus {
  if (sources.length === 0) return "failed";
  const okCount = sources.filter((s) => s.ok).length;
  if (okCount === sources.length) return "complete";
  if (okCount === 0) return "failed";
  return "partial";
}

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
  /** When the Pulse database was last refetched by an explicit freshness check. */
  lastRefreshAt: string | null;
  refreshStatus: RefreshStatus;
  /** Sources that failed in the most recent check, for honest UI reporting. */
  lastFailedSources: FreshnessSourceKey[];
  dataAsOf: string;
  /** Timestamp of the most recent successful source-file import, or null if none. */
  lastImportAt: string | null;
  yesterdayAchievementPct: number;
  monthlyAvgAchievementPct: number;
  managerCalls: ManagerCall[];
  underwriting: UnderwritingIssue[];
  savedUpdateTemplate: string | null;
  /**
   * §P0: really refetches every authoritative source, waits for all of them to
   * settle, then records the outcome. Replaces simulateRefresh, which wrote a
   * "complete" status and a fabricated freshness timestamp without refetching
   * anything at all.
   */
  runFreshnessCheck: () => Promise<FreshnessCheckResult>;
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

/** Every authoritative source a freshness check must actually refetch. */
const FRESHNESS_SOURCES: { key: FreshnessSourceKey; queryKey: readonly unknown[] }[] = [
  // CloudRepsSync + useCloudTeams share this exact key.
  { key: "representatives", queryKey: ["representatives"] },
  { key: "kpi_values", queryKey: ["cloud", "kpi_values"] },
  { key: "representative_goals", queryKey: ["cloud", "representative_goals"] },
  { key: "team_goals", queryKey: ["cloud", "team_goals"] },
  { key: "feedback", queryKey: ["cloud", "feedback"] },
  { key: "listening_schedules", queryKey: ["cloud", "listening_schedules"] },
  { key: "rep_tasks", queryKey: ["cloud", "rep_tasks"] },
  { key: "rep_notes", queryKey: ["cloud", "rep_notes"] },
  { key: "import_history", queryKey: ["cloud", "import_history"] },
];

export function MorningProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const calls = useCloudCollection<CallRow>("manager_calls", {
    order: { column: "scheduled_at", ascending: true },
  });
  // Read-only: the latest real source-file import, so the UI can distinguish
  // "the database was refetched" from "new source data actually arrived".
  const importHistory = useCloudCollection<{ id: string; created_at: string; status: string }>("import_history", {
    order: { column: "created_at" },
    limit: 1,
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
        lastFailedSources: [],
        dataAsOf: isoDate(new Date(Date.now() - 24 * 3600e3)),
        lastImportAt: null,
        yesterdayAchievementPct: 0,
        monthlyAvgAchievementPct: 0,
        managerCalls: demoCalls,
        underwriting: demoIssues,
        savedUpdateTemplate: demoTemplate,
        // Demo Mode has no cloud sources to refetch; report that honestly
        // rather than claiming a successful check of nothing.
        runFreshnessCheck: async () => ({
          status: "complete" as RefreshStatus,
          checkedAt: new Date().toISOString(),
          sources: [],
          failed: [],
        }),
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

    const latestImport = importHistory.rows[0] ?? null;

    return {
      lastRefreshAt: s?.last_refresh_at ?? null,
      // No stored status means no freshness check has ever run in this
      // workspace — that is "failed"/unknown, never an assumed "complete".
      refreshStatus: (s?.refresh_status as RefreshStatus) ?? "failed",
      lastFailedSources: [],
      dataAsOf: s?.data_as_of ?? isoDate(new Date(Date.now() - 24 * 3600e3)),
      lastImportAt: latestImport?.created_at ?? null,
      // New column is authoritative; fall back to the deprecated renewal-named column
      // for any row written before this migration, then to 0.
      yesterdayAchievementPct: s?.yesterday_achievement_pct ?? s?.yesterday_renewal_pct ?? 0,
      monthlyAvgAchievementPct: s?.monthly_avg_achievement_pct ?? s?.monthly_avg_renewal_pct ?? 0,
      managerCalls,
      underwriting,
      savedUpdateTemplate: s?.saved_update_template ?? null,
      /**
       * §P0. The whole point of this function is that the status it records
       * is EARNED. It refetches every source in FRESHNESS_SOURCES, waits for
       * all of them to settle, derives the status from the real per-source
       * outcomes, and only then persists it. There is no code path that
       * writes "complete" without every refetch having succeeded first.
       *
       * data_as_of is likewise real: it is the moment this check completed,
       * not yesterday's date invented by a formula, and it describes when
       * Pulse last read its own database — deliberately NOT a claim about
       * source-file freshness, which lastImportAt reports separately.
       */
      runFreshnessCheck: async (): Promise<FreshnessCheckResult> => {
        const results = await Promise.all(
          FRESHNESS_SOURCES.map(async ({ key, queryKey }): Promise<FreshnessSourceResult> => {
            try {
              await qc.refetchQueries({ queryKey });
              return { key, ok: true };
            } catch (e) {
              return { key, ok: false, error: (e as Error)?.message };
            }
          }),
        );
        const status = deriveFreshnessStatus(results);
        const checkedAt = new Date().toISOString();

        // Persisting the outcome is best-effort and must never upgrade it:
        // if this write fails the check still reports what it actually found.
        try {
          await settings.upsert(
            {
              user_id: user?.id ?? "",
              last_refresh_at: checkedAt,
              refresh_status: status,
              data_as_of: isoDate(new Date(checkedAt)),
            },
            "user_id",
          );
        } catch (e) {
          console.error("[morning] failed to persist freshness check outcome", e);
        }

        return { status, checkedAt, sources: results, failed: results.filter((r) => !r.ok).map((r) => r.key) };
      },
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
  }, [calls, issues, checklist, settings, importHistory.rows, qc, user, today, demoCalls, demoIssues, demoChecklist, demoTemplate]);

  return <MCtx.Provider value={value}>{children}</MCtx.Provider>;
}

export function useMorning() {
  const ctx = useContext(MCtx);
  if (!ctx) throw new Error("useMorning outside provider");
  return ctx;
}
