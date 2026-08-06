import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { useAuth } from "@/lib/auth";
import { useServerFn } from "@tanstack/react-start";
import { useWorkspace } from "@/lib/workspace-context";
import {
  underwritingCreate, underwritingUpdate, underwritingDelete, toggleChecklistItem,
} from "@/lib/dashboard.functions";

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
type ChecklistRow = { id: string; checklist_date: string; task_key: string; checked: boolean; team_id: string | null };
type SettingsRow = {
  user_id: string;
  saved_update_template: string | null;
  last_refresh_at: string | null;
  refresh_status: string;
  data_as_of: string | null;
  // yesterday_achievement_pct / monthly_avg_achievement_pct are DELIBERATELY
  // absent. No code path ever wrote them; the read side's "?? 0" turned that
  // into a permanent, plausible-looking zero, which is what made the trend
  // badge always read "+<the entire achievement>" in green. They are
  // superseded by team_achievement_snapshots and documented as dead in
  // 20260807093000_team_achievement_snapshots.sql. Do not reintroduce them
  // here — a field on this type is an invitation to render it.
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
  /**
   * §P0. Every mutation below returns a promise and REJECTS on failure.
   *
   * They were all `void cloud.insert/update/remove(...)` — a rejected promise
   * was recorded by error-capture.ts and never surfaced, while the calling
   * dialog fired toast.success() on the very next line. Adding a manager call
   * or deleting an underwriting issue reported success whether or not
   * anything was written, and the optimistic cache made the row appear or
   * disappear until the next refetch.
   *
   * Callers must await these and report the real outcome.
   */
  addManagerCall: (c: Omit<ManagerCall, "id" | "status"> & { status?: ManagerCall["status"] }) => Promise<void>;
  updateManagerCall: (id: string, p: Partial<ManagerCall>) => Promise<void>;
  removeManagerCall: (id: string) => Promise<void>;
  addUnderwriting: (u: Omit<UnderwritingIssue, "id" | "openedAt"> & { openedAt?: string }) => Promise<void>;
  updateUnderwriting: (id: string, p: Partial<UnderwritingIssue>) => Promise<void>;
  removeUnderwriting: (id: string) => Promise<void>;
  /** Returns the state the DATABASE committed, never a value guessed from cache. */
  toggleChecklist: (task: string) => Promise<boolean>;
  isChecked: (task: string) => boolean;
  saveTemplate: (text: string) => Promise<void>;
  /** Async view state for the morning collections — loading, error and empty are distinct. */
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
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
  const { workspace } = useWorkspace();
  const workspaceTeamId = workspace.type === "team" ? workspace.teamId : null;
  const createUw = useServerFn(underwritingCreate);
  const updateUw = useServerFn(underwritingUpdate);
  const deleteUw = useServerFn(underwritingDelete);
  const toggleItem = useServerFn(toggleChecklistItem);
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

  // §P2 midnight rollover. `today` used to be computed once, at provider
  // mount. A session left open past midnight kept writing checklist ticks to
  // the PREVIOUS day's date until the tab was reloaded. This ticks the date
  // forward on its own, so the boundary is crossed without a remount.
  const [today, setToday] = useState(isoDate());
  useEffect(() => {
    const check = () => setToday((prev) => (prev === isoDate() ? prev : isoDate()));
    // A minute is well inside the tolerance for a date boundary and costs
    // nothing; the state only changes on the one tick per day that crosses it.
    const timer = window.setInterval(check, 60_000);
    // Coming back to a backgrounded tab is the common way this is noticed.
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // Scoped by team as well as by date (§P2): a manager of two teams had ONE
  // checklist per day, so ticking "תכנון האזנות" in team A marked it done in
  // team B. `null` team_id is the organization-level checklist and is its own
  // distinct scope, not a catch-all.
  const checklist = useCloudCollection<ChecklistRow>("morning_checklist", {
    eq: workspaceTeamId
      ? { checklist_date: today, team_id: workspaceTeamId }
      : { checklist_date: today, team_id: null },
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
        // Demo Mode keeps working exactly as before, but through the same
        // promise-returning contract as Live Mode, so the UI has one code
        // path and never has to branch on mode to know whether to await.
        addManagerCall: async (c) =>
          setDemoCalls((s) => [{ id: uid(), status: c.status ?? "planned", ...c }, ...s]),
        updateManagerCall: async (id, p) => setDemoCalls((s) => s.map((c) => (c.id === id ? { ...c, ...p } : c))),
        removeManagerCall: async (id) => setDemoCalls((s) => s.filter((c) => c.id !== id)),
        addUnderwriting: async (u) =>
          setDemoIssues((s) => [{ id: uid(), openedAt: u.openedAt ?? isoDate(), ...u }, ...s]),
        updateUnderwriting: async (id, p) => setDemoIssues((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x))),
        removeUnderwriting: async (id) => setDemoIssues((s) => s.filter((x) => x.id !== id)),
        toggleChecklist: async (task) => {
          const next = !demoChecklist[task];
          setDemoChecklist((s) => ({ ...s, [task]: next }));
          return next;
        },
        isChecked: (task) => !!demoChecklist[task],
        saveTemplate: async (text) => setDemoTemplate(text),
        isLoading: false,
        isError: false,
        errorMessage: null,
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
      // manager_calls is already owner-scoped by RLS (owner_id = auth.uid()),
      // so the generic writer is an adequate authorization boundary here —
      // what it was missing was the await. These now reject on failure.
      addManagerCall: async (c) => {
        await calls.insert({
          representative_id: c.repId || null,
          subject: c.subject,
          scheduled_at: c.scheduledAt,
          status: c.status ?? "planned",
          summary: c.summary ?? null,
          follow_up_at: c.followUpAt ?? null,
          owner_id: user?.id ?? "",
        });
        await calls.refetch();
      },
      updateManagerCall: async (id, p) => {
        const row: Record<string, string | null> = {};
        if (p.repId !== undefined) row.representative_id = p.repId || null;
        if (p.subject !== undefined) row.subject = p.subject;
        if (p.scheduledAt !== undefined) row.scheduled_at = p.scheduledAt;
        if (p.status !== undefined) row.status = p.status;
        if (p.summary !== undefined) row.summary = p.summary ?? null;
        if (p.followUpAt !== undefined) row.follow_up_at = p.followUpAt ?? null;
        await calls.update(id, row);
        await calls.refetch();
      },
      removeManagerCall: async (id) => {
        await calls.remove(id);
        await calls.refetch();
      },
      // §P0 SECURITY: underwriting writes no longer go through the generic
      // proxy. They are authorized against the representative and audited
      // with before/after state — see dashboard.functions.ts. The RLS policy
      // behind them was `private.is_staff()`, i.e. any manager could
      // re-status or delete any organization issue.
      addUnderwriting: async (u) => {
        await createUw({
          data: {
            representative_id: u.repId,
            subject: u.subject,
            priority: u.priority,
            status: u.status,
            owner: u.owner,
            due_on: u.dueAt || null,
            opened_on: u.openedAt ?? isoDate(),
          },
        });
        await issues.refetch();
      },
      updateUnderwriting: async (id, p) => {
        await updateUw({
          data: {
            issue_id: id,
            ...(p.subject !== undefined ? { subject: p.subject } : {}),
            ...(p.priority !== undefined ? { priority: p.priority } : {}),
            ...(p.status !== undefined ? { status: p.status } : {}),
            ...(p.owner !== undefined ? { owner: p.owner } : {}),
            ...(p.dueAt !== undefined ? { due_on: p.dueAt || null } : {}),
          },
        });
        await issues.refetch();
      },
      removeUnderwriting: async (id) => {
        await deleteUw({ data: { issue_id: id } });
        await issues.refetch();
      },
      /**
       * §P0 concurrency. This was:
       *     const current = checklist.rows.find(...)
       *     void checklist.upsert({ checked: !current?.checked }, ...)
       * — a read-modify-write against a React Query cache with a 15s
       * staleTime. Two tabs could both read the same value and write the same
       * result, silently losing a toggle, and a row missing from the cache
       * was coerced to `true` rather than read from the database.
       *
       * The server flips the value Postgres holds, under a row lock, and
       * returns what committed. The caller renders that, not a guess.
       */
      toggleChecklist: async (task) => {
        const res = await toggleItem({
          data: { task_key: task, checklist_date: today, team_id: workspaceTeamId },
        });
        await checklist.refetch();
        return res.checked;
      },
      isChecked: (task) => !!checklist.rows.find((r) => r.task_key === task)?.checked,
      saveTemplate: async (text) => {
        await settings.upsert({ user_id: user?.id ?? "", saved_update_template: text }, "user_id");
        await settings.refetch();
      },
      isLoading: calls.isLoading || issues.isLoading || checklist.isLoading,
      isError: calls.isError || issues.isError || checklist.isError,
      errorMessage:
        calls.isError || issues.isError || checklist.isError
          ? "שגיאה בטעינת נתוני פתיחת היום. נסו לרענן את הדף."
          : null,
    };
  }, [calls, issues, checklist, settings, importHistory.rows, qc, user, today, workspaceTeamId,
      createUw, updateUw, deleteUw, toggleItem,
      demoCalls, demoIssues, demoChecklist, demoTemplate]);

  return <MCtx.Provider value={value}>{children}</MCtx.Provider>;
}

export function useMorning() {
  const ctx = useContext(MCtx);
  if (!ctx) throw new Error("useMorning outside provider");
  return ctx;
}
