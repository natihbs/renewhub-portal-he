import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { resolveInternalLink } from "@/lib/internal-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sunrise, RefreshCw, Database, ShieldCheck, AlertTriangle, TrendingUp, TrendingDown,
  Percent, ListChecks, Headphones, PhoneCall, FileWarning, Sparkles, Copy, Save, Plus,
  CheckCircle2, Clock, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/store";
import { calculateAchievement } from "@/lib/performance-domain";
import {
  useMorning, FRESHNESS_SOURCE_LABEL,
  type UnderwritingIssue, type UnderwritingPriority, type UnderwritingStatus, type ManagerCall, type FreshnessSourceKey,
} from "@/lib/morning-store";
import { formatDateIL, formatNum, formatPct, workdaysInMonth, workdaysPassed, workdaysRemaining } from "@/lib/format";
import type { Rep } from "@/lib/seed";
import { useRepWorkspace } from "@/lib/rep-workspace";
import { useWorkspace } from "@/lib/workspace-context";
import { useTeamGoal, useRepresentativeGoals } from "@/lib/goals-hooks";
import { useServerFn } from "@tanstack/react-start";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { useListening } from "@/lib/listening-store";
import { useAppMode } from "@/lib/app-mode";
import { renewalTotalsForRep, currentMonthStart } from "@/lib/kpi-values";
import {
  computeCompleteness, computeListeningPlan, computeAchievementTrend, computeFreshness,
  TREND_UNAVAILABLE_LABEL, repsNeedingSupport,
  type CompletenessInput, type SupportInput, type AchievementSnapshot, type AchievementTrend,
  type ListeningPlan, type FreshnessModel,
} from "@/lib/dashboard-domain";
import {
  recordTeamAchievementSnapshot, evaluateManagerNotifications, getPerformanceDataFreshness,
  type OperationalNotification,
} from "@/lib/dashboard.functions";

/** A team below this share of its monthly target gets one pace notification per day. */
export const PACE_NOTIFICATION_THRESHOLD_PCT = 80;
/** This many representatives unheard for a week triggers one coverage notification per day. */
export const LISTENING_NOTIFICATION_THRESHOLD = 3;

const CHECKLIST = [
  "בדיקת רענון נתונים",
  "בדיקת אחוז עמידה ביעד",
  "בדיקת נציגים מתחת לקצב",
  "תכנון האזנות",
  "מעבר על שיחות מנהל",
  "מעבר על נושאי חיתום",
  "שליחת עדכון בוקר",
];

export function MorningRoutine() {
  const { state } = useApp();
  // Scoped to the manager's current Workspace team — the same scope every
  // other manager-facing page (Representatives, Performance, Targets) already
  // reads from. Required for the official team target below to be
  // well-defined: a team_goals row is per team, not an org-wide aggregate.
  const { workspace } = useWorkspace();
  const workspaceTeamId = workspace.type === "team" ? workspace.teamId : null;
  const reps = useMemo(
    () => (workspaceTeamId ? state.reps.filter((r) => r.teamId === workspaceTeamId) : state.reps),
    [state.reps, workspaceTeamId],
  );
  const feedback = state.feedback;
  const morning = useMorning();
  const { isDemo } = useAppMode();

  const wdPassed = Math.max(1, workdaysPassed());
  const wdTotal = workdaysInMonth();
  const wdRemaining = workdaysRemaining();

  const teamGoal = useTeamGoal(workspaceTeamId);
  const hasTeamTarget = teamGoal.targetValue !== null;
  const repIds = useMemo(() => reps.map((r) => r.id), [reps]);
  const repGoals = useRepresentativeGoals(repIds);

  const totalResult = reps.reduce((a, r) => a + r.currentResult, 0);
  const achievementPct = hasTeamTarget ? calculateAchievement(totalResult, teamGoal.targetValue as number) : null;

  /**
   * §P0 REAL data completeness.
   *
   * This was `r.currentResult > 0 || r.lastUpdatedAt`, where lastUpdatedAt is
   * representatives.updated_at — NOT NULL DEFAULT now(), therefore always
   * truthy. The right-hand side was always true, the left-hand side was dead
   * code, repsMissingData was always empty and completeness was a constant
   * 100%. The morning data-integrity check could not report a problem, and
   * "נציג ללא ביצוע" could never fire.
   *
   * Completeness is now derived from the same authoritative sources the
   * displayed figures come from: dated kpi_values rows for the period, plus
   * the audited current_result scalar. See classifyRepData for why a zero
   * with no dated row is "no_data" rather than a "real zero".
   */
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = currentMonthStart();
  const completenessInputs = useMemo<CompletenessInput[]>(
    () => reps.map((r) => {
      const rows = state.kpiValues.filter(
        (k) => k.representative_id === r.id && k.metric_date >= monthStart,
      );
      const dated = renewalTotalsForRep(r.id, state.kpiValues, { from: monthStart });
      const latestMetricDate = rows.length > 0
        ? rows.map((k) => k.metric_date).sort().slice(-1)[0]
        : null;
      return {
        repId: r.id,
        repName: r.name,
        hasTarget: repGoals.goalsByRepId.has(r.id),
        evidence: {
          latestMetricDate,
          hasDatedValue: dated.completed !== null || dated.opportunities !== null,
          datedTotal: (dated.completed ?? 0) + (dated.opportunities ?? 0),
          currentResult: r.currentResult,
        },
      };
    }),
    [reps, state.kpiValues, monthStart, repGoals.goalsByRepId],
  );
  const completenessResult = useMemo(
    () => computeCompleteness(completenessInputs, today),
    [completenessInputs, today],
  );
  const repsMissingData = useMemo(
    () => reps.filter((r) => completenessResult.byRepId.get(r.id) === "no_data"),
    [reps, completenessResult],
  );
  const repsWithData = useMemo(
    () => reps.filter((r) => completenessResult.byRepId.get(r.id) !== "no_data"),
    [reps, completenessResult],
  );
  const staleReps = useMemo(
    () => reps.filter((r) => completenessResult.byRepId.get(r.id) === "stale"),
    [reps, completenessResult],
  );
  const completeness = completenessResult.completenessPct;

  const underPace = useMemo(() => reps.filter((r) => {
    const target = repGoals.goalsByRepId.get(r.id);
    if (target === undefined) return false; // no personal target set — can't judge pace
    const expected = (target * wdPassed) / wdTotal;
    return r.currentResult < expected * 0.9;
  }), [reps, repGoals.goalsByRepId, wdPassed, wdTotal]);

  /**
   * §P0 REAL listening plan. ListeningCard used `const planned = 5` — a
   * literal that ignored listening_schedules entirely, so the badge read
   * "X/5" for every manager, every team, every day, whether twelve sessions
   * were booked or none. The schedules come from the same provider and obey
   * the same lifecycle rules as the Feedback & Listening calendar.
   */
  const { schedules: allSchedules, isLoading: schedulesLoading, isError: schedulesError } = useListening();
  const repIdSet = useMemo(() => new Set(reps.map((r) => r.id)), [reps]);
  const scopedSchedules = useMemo(
    () => allSchedules.filter((s) => repIdSet.has(s.repId)),
    [allSchedules, repIdSet],
  );
  const scopedFeedback = useMemo(
    () => feedback.filter((f) => repIdSet.has(f.repId)),
    [feedback, repIdSet],
  );
  const listeningPlan = useMemo(
    () => computeListeningPlan(
      scopedSchedules.map((s) => ({ id: s.id, repId: s.repId, date: s.date, status: s.status })),
      scopedFeedback.map((f) => f.date),
      today,
    ),
    [scopedSchedules, scopedFeedback, today],
  );

  const feedbackRepIds = new Set(scopedFeedback.map((f) => f.repId));
  const noRecentListening = reps.filter((r) => {
    const last = scopedFeedback.filter((f) => f.repId === r.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (!last) return true;
    const days = (Date.now() - new Date(last.date).getTime()) / 86400000;
    return days > 7;
  });
  const noFeedback = reps.filter((r) => !feedbackRepIds.has(r.id));

  /**
   * §P1 REAL freshness. representatives.updated_at moved when a name was
   * corrected and stayed still when a renewals-only import landed, so it was
   * uncorrelated with performance freshness in both directions. The
   * authoritative answer is the newest dated measurement plus the last real
   * import — two different facts, reported separately.
   */
  const loadFreshness = useServerFn(getPerformanceDataFreshness);
  const [freshnessRaw, setFreshnessRaw] = useState<{ sourceDataDate: string | null; lastImportAt: string | null } | null>(null);
  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    loadFreshness({ data: { team_id: workspaceTeamId } })
      .then((r) => { if (!cancelled) setFreshnessRaw({ sourceDataDate: r.sourceDataDate, lastImportAt: r.lastImportAt }); })
      .catch(() => { if (!cancelled) setFreshnessRaw(null); });
    return () => { cancelled = true; };
  }, [isDemo, workspaceTeamId, loadFreshness]);
  const freshness = useMemo(
    () => computeFreshness({
      sourceDataDate: freshnessRaw?.sourceDataDate ?? null,
      lastImportAt: freshnessRaw?.lastImportAt ?? morning.lastImportAt,
      lastRefreshAt: morning.lastRefreshAt,
      today,
    }),
    [freshnessRaw, morning.lastImportAt, morning.lastRefreshAt, today],
  );

  const openCalls = morning.managerCalls.filter((c) => c.status !== "completed");
  const openUnderwriting = morning.underwriting.filter((u) => u.status !== "הושלם");
  const competitionsEndingSoon = state.competitions.filter((c) => {
    const days = (new Date(c.endDate).getTime() - Date.now()) / 86400000;
    return c.active && days >= 0 && days <= 7;
  });

  /**
   * §P2 manager notifications — a small, fixed set of operational events,
   * evaluated from the SAME figures this card renders so a notification can
   * never disagree with the screen that produced it.
   *
   * The bell was permanently empty for managers and admins: notifications
   * exists and is scoped user_id = auth.uid(), but every writer targeted the
   * REPRESENTATIVE's account. No event told a manager that an import had
   * failed, that their team was behind, or that a rep had gone unheard.
   *
   * Storm control is structural, not conventional: each event carries a
   * dedupe key of "<event>:<subject>:<date>" and the database enforces
   * uniqueness on (user_id, dedupe_key), so running this on every dashboard
   * open is idempotent inside Postgres rather than by remembering to be.
   */
  const notifyFn = useServerFn(evaluateManagerNotifications);
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (isDemo || !workspaceTeamId || notifiedRef.current) return;
    if (reps.length === 0) return;
    notifiedRef.current = true;
    const events: OperationalNotification[] = [];
    const teamName = workspace.type === "team" ? workspace.teamName : "";

    if (achievementPct !== null && achievementPct < PACE_NOTIFICATION_THRESHOLD_PCT) {
      events.push({
        userId: "", kind: "pace",
        title: "הצוות מתחת לקצב היעד",
        body: `${teamName}: עמידה של ${Math.round(achievementPct)}% מהיעד החודשי.`,
        href: "/performance",
        dedupeKey: `pace:${workspaceTeamId}:${today}`,
      });
    }
    if (completenessResult.missing > 0) {
      events.push({
        userId: "", kind: "import",
        title: "חסרים נתוני ביצוע",
        body: `${completenessResult.missing} נציגים ב${teamName} ללא נתוני ביצוע לחודש זה.`,
        href: "/data-import",
        dedupeKey: `missing_data:${workspaceTeamId}:${today}`,
      });
    }
    if (noRecentListening.length >= LISTENING_NOTIFICATION_THRESHOLD) {
      events.push({
        userId: "", kind: "listening",
        title: "נציגים ללא האזנה",
        body: `${noRecentListening.length} נציגים ב${teamName} ללא האזנה בשבוע האחרון.`,
        href: "/feedback",
        dedupeKey: `listening:${workspaceTeamId}:${today}`,
      });
    }
    const urgentUw = morning.underwriting.filter((u) => u.status !== "הושלם" && u.priority === "high");
    if (urgentUw.length > 0) {
      events.push({
        userId: "", kind: "underwriting",
        title: "נושאי חיתום דחופים",
        body: `${urgentUw.length} נושאי חיתום בעדיפות גבוהה ממתינים לטיפול.`,
        href: "/",
        dedupeKey: `underwriting:${workspaceTeamId}:${today}`,
      });
    }
    for (const c of competitionsEndingSoon) {
      events.push({
        userId: "", kind: "competition",
        title: "תחרות מסתיימת בקרוב",
        body: `התחרות "${c.name}" מסתיימת ב-${formatDateIL(c.endDate)}.`,
        href: "/competitions",
        dedupeKey: `competition_end:${c.id}:${today}`,
      });
    }

    if (events.length === 0) return;
    void notifyFn({ data: { events } }).catch((e: Error) =>
      console.error("[morning] notification evaluation failed", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, workspaceTeamId, reps.length, achievementPct, completenessResult.missing, noRecentListening.length, today]);

  /**
   * §P0 REAL day-over-day trend.
   *
   * This was `achievementPct - morning.yesterdayAchievementPct`, reading
   * morning_settings.yesterday_achievement_pct — a column NOTHING IN THE
   * CODEBASE EVER WROTE. It was NOT NULL DEFAULT 0, the read had a `?? 0`,
   * and so the badge rendered "+<the entire achievement>", in green, every
   * single morning, regardless of what the team had actually done.
   *
   * The comparison now comes from team_achievement_snapshots — real dated
   * rows, written once per team per day by recordTeamAchievementSnapshot.
   * Until a prior day exists the trend reports UNAVAILABLE rather than
   * inventing a baseline.
   */
  const snapshotRows = useCloudCollection<{ id: string; team_id: string; snapshot_date: string; achievement_pct: number | null }>(
    "team_achievement_snapshots",
    {
      eq: workspaceTeamId ? { team_id: workspaceTeamId } : undefined,
      order: { column: "snapshot_date" },
      limit: 60,
      enabled: !!workspaceTeamId,
    },
  );
  const snapshots = useMemo<AchievementSnapshot[]>(
    () => snapshotRows.rows.map((r) => ({ snapshotDate: r.snapshot_date, achievementPct: r.achievement_pct })),
    [snapshotRows.rows],
  );
  const trend: AchievementTrend = useMemo(
    () => computeAchievementTrend(achievementPct, snapshots, today),
    [achievementPct, snapshots, today],
  );

  // Record today's figures so tomorrow has something real to compare with.
  // Idempotent per team per day at the database level, so re-opening the
  // dashboard is harmless. Never blocks or fails the render.
  const recordSnapshot = useServerFn(recordTeamAchievementSnapshot);
  useEffect(() => {
    if (isDemo || !workspaceTeamId || reps.length === 0) return;
    let cancelled = false;
    void recordSnapshot({
      data: {
        team_id: workspaceTeamId,
        result_value: totalResult,
        target_value: teamGoal.targetValue,
        achievement_pct: achievementPct,
        representative_count: reps.length,
      },
    })
      .then(() => { if (!cancelled) void snapshotRows.refetch(); })
      .catch((e: Error) => console.error("[morning] snapshot failed", e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, workspaceTeamId, totalResult, teamGoal.targetValue, achievementPct, reps.length]);

  return (
    <Card className="overflow-hidden border-primary/20">
      <div className="h-1.5 w-full bg-primary" />
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sunrise className="h-5 w-5 text-primary" />
          פתיחת יום
        </CardTitle>
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          {formatDateIL(new Date())}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Row 1: Data status + Target achievement */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DataStatusCard
            completeness={completeness}
            withCount={repsWithData.length}
            missingCount={repsMissingData.length}
            staleCount={completenessResult.stale}
            realZeroCount={completenessResult.realZero}
            freshness={freshness}
          />
          <AchievementCard achievementPct={achievementPct} trend={trend} hasTarget={hasTeamTarget} totalResult={totalResult} />
        </div>

        {/* Row 2: Quality check + Priorities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <QualityCheckCard reps={reps} repsMissingData={repsMissingData} staleReps={staleReps} goalsByRepId={repGoals.goalsByRepId} />
          <PrioritiesCard
            underPace={underPace.length}
            noListening={noRecentListening.length}
            noFeedback={noFeedback.length}
            openCalls={openCalls.length}
            openUnderwriting={openUnderwriting.length}
            missingData={completenessResult.missing}
            staleSourceData={freshness.state === "stale" ? 1 : 0}
            overdueListening={listeningPlan.overdue}
            competitionsEndingSoon={competitionsEndingSoon.length}
          />
        </div>

        {/* Row 3: Listening + Manager calls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ListeningCard
            reps={reps}
            plan={listeningPlan}
            todaysEvaluations={scopedFeedback.filter((f) => f.date.slice(0, 10) === today)}
            noRecentListening={noRecentListening}
            isLoading={schedulesLoading}
            isError={schedulesError}
          />
          <ManagerCallsCard reps={reps} />
        </div>

        {/* Row 4: Underwriting (full width) */}
        <UnderwritingCard reps={reps} />

        {/* Row 5: Update generator + Checklist */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <MorningUpdateCard
              achievementPct={achievementPct}
              hasTeamTarget={hasTeamTarget}
              teamTarget={teamGoal.targetValue}
              repGoalsByRepId={repGoals.goalsByRepId}
              reps={reps}
              wdRemaining={wdRemaining}
              totalResult={totalResult}
            />
          </div>
          <ChecklistCard />
        </div>
      </CardContent>
    </Card>
  );
}

/* ============ Data Status ============ */
/**
 * §P0. This card used to claim "נתונים רועננו בהצלחה" after calling
 * simulateRefresh(), which refetched nothing, validated nothing, could not
 * fail, and stamped a fabricated "עדכני עד" date derived from `now - 24h`.
 *
 * It now runs a real freshness check and reports two genuinely different
 * facts separately, because conflating them was the core dishonesty:
 *   - "רענון מסד הנתונים" — when Pulse last re-read its OWN cloud database.
 *     That is what the button does.
 *   - "ייבוא אחרון מקובץ מקור" — when new source data last actually arrived.
 *     Only a Data Import does that. There is no automatic external sync, and
 *     the UI no longer implies one exists.
 */
function DataStatusCard({ completeness, withCount, missingCount, staleCount, realZeroCount, freshness }: {
  completeness: number; withCount: number; missingCount: number;
  staleCount: number; realZeroCount: number;
  freshness: { sourceDataDate: string | null; lastImportAt: string | null; lastRefreshAt: string | null; ageInDays: number | null; state: "current" | "aging" | "stale" | "unknown" };
}) {
  const m = useMorning();
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState<FreshnessSourceKey[]>([]);

  const tone = m.refreshStatus === "complete" ? "success" : m.refreshStatus === "partial" ? "warning" : "danger";
  const toneClass =
    tone === "success" ? "bg-[color:var(--success)]/10 text-success-foreground border-[color:var(--success)]/30" :
    tone === "warning" ? "bg-[color:var(--warning)]/10 text-warning-foreground border-[color:var(--warning)]/30" :
    "bg-primary/10 text-primary border-primary/30";
  const label = m.refreshStatus === "complete" ? "עדכני" : m.refreshStatus === "partial" ? "חלקי" : "לא נבדק";
  const dotClass =
    tone === "success" ? "bg-[color:var(--success)]" :
    tone === "warning" ? "bg-[color:var(--warning)]" : "bg-primary";

  const runCheck = async () => {
    setChecking(true);
    try {
      // The toast fires only AFTER every refetch has settled and the real
      // outcome is known — never before, and never unconditionally.
      const result = await m.runFreshnessCheck();
      setFailed(result.failed);
      if (result.status === "complete") {
        toast.success("כל המקורות נטענו מחדש בהצלחה");
      } else if (result.status === "partial") {
        toast.warning(
          `רענון חלקי — ${result.failed.length} מקורות נכשלו`,
          { description: result.failed.map((k) => FRESHNESS_SOURCE_LABEL[k]).join(", ") },
        );
      } else {
        toast.error("רענון הנתונים נכשל — הנתונים המוצגים עשויים להיות לא עדכניים");
      }
    } catch (e) {
      setFailed([]);
      toast.error((e as Error).message || "רענון הנתונים נכשל");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <div className="font-semibold">סטטוס נתונים</div>
        </div>
        <Badge variant="outline" className={cn("gap-1.5", toneClass)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
          {label}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {/* §P1: three genuinely different facts, previously conflated into
            one "is the data fresh" claim. A manager acts differently on each. */}
        <Stat
          label="תאריך נתוני המקור"
          value={freshness.sourceDataDate ? formatDateIL(freshness.sourceDataDate) : "אין נתונים מתוארכים"}
          tone={freshness.state === "stale" ? "danger" : freshness.state === "aging" ? "warning" : freshness.state === "unknown" ? "warning" : "success"}
        />
        <Stat
          label="ייבוא אחרון מקובץ מקור"
          value={freshness.lastImportAt ? new Date(freshness.lastImportAt).toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "אין ייבוא"}
          tone={freshness.lastImportAt ? undefined : "warning"}
        />
        <Stat
          label="רענון מסד הנתונים"
          value={freshness.lastRefreshAt ? new Date(freshness.lastRefreshAt).toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "טרם בוצע"}
        />
        <Stat label="נציגים עם נתונים" value={`${withCount}`} tone={withCount > 0 ? "success" : "warning"} />
        <Stat label="ללא נתוני ביצוע" value={`${missingCount}`} tone={missingCount > 0 ? "danger" : undefined} />
        <Stat label="נתונים מתיישנים" value={`${staleCount}`} tone={staleCount > 0 ? "warning" : undefined} />
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>שלמות הנתונים</span>
          <span>{formatPct(completeness)}</span>
        </div>
        <Progress value={completeness} className="h-2" />
      </div>
      {failed.length > 0 && (
        <p className="mt-2 rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 p-2 text-xs text-warning-foreground">
          מקורות שלא נטענו מחדש: {failed.map((k) => FRESHNESS_SOURCE_LABEL[k]).join(", ")}. הנתונים המוצגים עבורם עשויים להיות לא עדכניים.
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        הבדיקה טוענת מחדש את הנתונים ממסד הנתונים של Pulse. נתונים חדשים נכנסים למערכת רק דרך ייבוא קובץ מקור.
        {realZeroCount > 0 && ` ${realZeroCount} נציגים דווחו עם תוצאה אפס — זהו נתון אמיתי, לא נתון חסר.`}
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={runCheck} disabled={checking}>
          <RefreshCw className={cn("ms-1 h-4 w-4", checking && "animate-spin")} />
          {checking ? "בודק עדכניות..." : "בדיקת עדכניות נתונים"}
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/data-import">ייבוא ידני<ArrowLeft className="me-1 h-4 w-4" /></Link>
        </Button>
      </div>
    </div>
  );
}

/* ============ Quality Check ============ */
function QualityCheckCard({ reps, repsMissingData, staleReps, goalsByRepId }: {
  reps: Rep[]; repsMissingData: Rep[]; staleReps: Rep[]; goalsByRepId: Map<string, number>;
}) {
  const { open } = useRepWorkspace();
  // Official monthly target (representative_goals) — never the legacy
  // rep.monthlyTarget column (§19).
  const noTarget = reps.filter((r) => !goalsByRepId.has(r.id));
  const nameCounts = reps.reduce<Record<string, number>>((acc, r) => { acc[r.name] = (acc[r.name] ?? 0) + 1; return acc; }, {});
  const duplicates = reps.filter((r) => nameCounts[r.name] > 1);
  const unknownTeam = reps.filter((r) => !r.teamId);
  /**
   * §P1. This was `representatives.updated_at` older than a day — a column
   * that moves when a NAME is corrected and does not move when a
   * renewals-only import lands. It was uncorrelated with performance
   * freshness in both directions: it flagged fully-imported renewals teams as
   * stale, and cleared the flag for a team whose only change was an admin
   * fixing a typo. Staleness now comes from the newest DATED measurement, via
   * classifyRepData.
   */
  const stale = staleReps;

  const warnings: { icon: typeof AlertTriangle; text: string; onClick?: () => void; href?: string }[] = [
    ...repsMissingData.map((r) => ({ icon: AlertTriangle, text: `נציג ללא ביצוע: ${r.name}`, onClick: () => open(r.id) })),
    ...noTarget.map((r) => ({ icon: AlertTriangle, text: `נציג ללא יעד: ${r.name}`, onClick: () => open(r.id) })),
    ...stale.map((r) => ({ icon: Clock, text: `נתוני ביצוע מתיישנים: ${r.name}`, onClick: () => open(r.id) })),
    ...duplicates.map((r) => ({ icon: AlertTriangle, text: `כפילות בשם: ${r.name}`, href: "/admin" as const })),
    ...unknownTeam.map((r) => ({ icon: AlertTriangle, text: `צוות לא מזוהה: ${r.name}`, onClick: () => open(r.id) })),
  ];

  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <div className="font-semibold">בדיקת תקינות</div>
        </div>
        <Badge variant="outline">{warnings.length} התראות</Badge>
      </div>
      {warnings.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-[color:var(--success)] mb-1" />
          הנתונים תקינים ומעודכנים
        </div>
      ) : (
        <ul className="space-y-1.5 max-h-56 overflow-auto">
          {warnings.slice(0, 8).map((w, i) => {
            const Icon = w.icon;
            const content = (
              <div className="flex items-start gap-2 rounded-lg border p-2 text-sm transition-colors hover:bg-accent/40 cursor-pointer">
                <Icon className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span className="flex-1">{w.text}</span>
              </div>
            );
            const target = resolveInternalLink(w.href);
            return (
              <li key={i}>
                {target ? (
                  <Link to={target.to} hash={target.hash}>{content}</Link>
                ) : (
                  <button type="button" onClick={w.onClick} className="w-full text-start">{content}</button>
                )}
              </li>
            );

          })}
        </ul>
      )}
    </div>
  );
}

/* ============ Target Achievement ============ */
function AchievementCard({ achievementPct, trend, hasTarget, totalResult }: {
  achievementPct: number | null; trend: AchievementTrend; hasTarget: boolean; totalResult: number;
}) {
  if (!hasTarget || achievementPct === null) {
    return (
      <div className="rounded-xl border p-4 bg-card">
        <div className="flex items-center gap-2">
          <Percent className="h-4 w-4 text-primary" />
          <div className="font-semibold">אחוז עמידה ביעד</div>
        </div>
        <div className="mt-2 text-lg font-semibold text-muted-foreground">לא הוגדר יעד חודשי</div>
        <p className="mt-1 text-xs text-muted-foreground">
          ביצוע נוכחי: {formatNum(totalResult)} יחידות. הגדירו יעד חודשי רשמי כדי לראות אחוז עמידה, קצב ותחזית.
        </p>
        <Button asChild size="sm" variant="outline" className="mt-3">
          <Link to="/targets">הגדרת יעד חודשי</Link>
        </Button>
      </div>
    );
  }
  const up = trend.available && trend.changePct >= 0;
  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Percent className="h-4 w-4 text-primary" />
          <div className="font-semibold">אחוז עמידה ביעד</div>
        </div>
        {/* The badge renders ONLY when a real prior-day snapshot exists. It
            used to render unconditionally against a column nothing ever
            wrote, so it always read "+<the entire achievement>" in green. */}
        {trend.available && (
          <Badge variant="outline" className={cn("gap-1", up ? "text-success-foreground" : "text-primary")}>
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {up ? "+" : ""}{trend.changePct.toFixed(1)}%
          </Badge>
        )}
      </div>
      <div className="mt-2 text-4xl font-extrabold tracking-tight">{formatPct(achievementPct)}</div>
      {trend.available ? (
        <div className="text-xs text-muted-foreground">
          מול {formatPct(trend.previousPct)} ב-{formatDateIL(trend.previousDate)}
          {trend.monthlyAvgPct !== null ? ` · ממוצע חודשי ${formatPct(trend.monthlyAvgPct)}` : ""}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">{TREND_UNAVAILABLE_LABEL[trend.reason]}</div>
      )}
    </div>
  );
}

/* ============ Priorities ============ */
function PrioritiesCard({ underPace, noListening, noFeedback, openCalls, openUnderwriting, missingData, staleSourceData, overdueListening, competitionsEndingSoon }: {
  underPace: number; noListening: number; noFeedback: number; openCalls: number; openUnderwriting: number;
  /** Representatives with genuinely no performance record — a real count now. */
  missingData: number;
  /** 1 when the newest dated measurement is older than the staleness threshold. */
  staleSourceData: number;
  /** Scheduled listening sessions whose date passed without completion or cancellation. */
  overdueListening: number;
  competitionsEndingSoon: number;
}) {
  // Every counter here is now scoped to the same population: the workspace
  // team. "נושאי חיתום פתוחים" in particular used to be organization-wide
  // (its RLS policy was a bare is_staff() check) while sitting in a row of
  // otherwise team-scoped numbers.
  const items = [
    { label: "נציגים ללא נתוני ביצוע", count: missingData, href: "/data-import", urgency: missingData * 5 },
    { label: "נתוני מקור לא עדכניים", count: staleSourceData, href: "/data-import", urgency: staleSourceData * 5 },
    { label: "נציגים מתחת לקצב", count: underPace, href: "/performance", urgency: underPace * 3 },
    { label: "האזנות שעבר זמנן", count: overdueListening, href: "/feedback", urgency: overdueListening * 3 },
    { label: "האזנות חסרות השבוע", count: noListening, href: "/feedback", urgency: noListening * 2 },
    { label: "נושאי חיתום פתוחים", count: openUnderwriting, href: "#underwriting", urgency: openUnderwriting * 2 },
    { label: "שיחות מנהל פתוחות", count: openCalls, href: "#calls", urgency: openCalls * 2 },
    { label: "נציגים ללא משוב", count: noFeedback, href: "/feedback", urgency: noFeedback },
    { label: "תחרויות שמסתיימות בקרוב", count: competitionsEndingSoon, href: "/competitions", urgency: competitionsEndingSoon },
  ].filter((x) => x.count > 0).sort((a, b) => b.urgency - a.urgency);

  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-primary" />
          מה דורש טיפול הבוקר
        </div>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-[color:var(--success)] mb-1" />
          אין פריטים דחופים - בוקר רגוע
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it, idx) => {
            const target = resolveInternalLink(it.href);
            const rowClass = cn(
              "flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors",
              target && "hover:bg-accent/40",
              idx === 0 && "border-primary/40 bg-primary/5"
            );
            const body = (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <span className={cn("grid h-6 w-6 place-items-center rounded-md text-xs font-bold", idx === 0 ? "bg-primary text-primary-foreground" : "bg-accent text-primary")}>{idx + 1}</span>
                  <span className="font-medium">{it.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{it.count}</Badge>
                  {target && <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              </>
            );
            return (
              <li key={it.label}>
                {target ? (
                  <Link to={target.to} hash={target.hash} className={rowClass}>{body}</Link>
                ) : (
                  <div className={rowClass}>{body}</div>
                )}
              </li>
            );
          })}

        </ul>
      )}
    </div>
  );
}

/* ============ Listening ============ */
/**
 * §P0 real listening plan · §P2 explicit average scope.
 *
 * `planned` was the literal 5. The average was computed over ALL feedback the
 * manager could read — every team, all time, drafts included — and displayed
 * inside a card titled "האזנות להיום", so a lifetime figure sat under a
 * today-scoped heading with nothing saying which it was.
 *
 * Both are now what the card claims: counts come from listening_schedules for
 * today in the current workspace, and the average is over TODAY'S completed
 * evaluations only. The PR #22 draft-inclusion rule applies and is disclosed
 * here the same way it is in the Feedback module — drafts count, because the
 * listening happened, and the card says so.
 */
function ListeningCard({ reps, plan, todaysEvaluations, noRecentListening, isLoading, isError }: {
  reps: Rep[];
  plan: ListeningPlan;
  todaysEvaluations: { repId: string; score: number; date: string; published: boolean }[];
  noRecentListening: Rep[];
  isLoading?: boolean;
  isError?: boolean;
}) {
  const avgToday = todaysEvaluations.length > 0
    ? todaysEvaluations.reduce((a, f) => a + f.score, 0) / todaysEvaluations.length
    : null;
  const draftsToday = todaysEvaluations.filter((f) => !f.published).length;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosen, setChosen] = useState<string>("");
  const { open: openRepWorkspace } = useRepWorkspace();

  if (isLoading) {
    return (
      <div className="rounded-xl border p-4 bg-card">
        <div className="flex items-center gap-2 font-semibold mb-3">
          <Headphones className="h-4 w-4 text-primary" />האזנות להיום
        </div>
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-xl border p-4 bg-card">
        <div className="flex items-center gap-2 font-semibold mb-3">
          <Headphones className="h-4 w-4 text-primary" />האזנות להיום
        </div>
        <p className="text-sm text-destructive">שגיאה בטעינת יומן ההאזנות — לא ניתן להציג את תוכנית ההאזנות להיום.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold">
          <Headphones className="h-4 w-4 text-primary" />
          האזנות להיום
        </div>
        <Badge variant="outline">{plan.completedToday}/{plan.plannedToday}</Badge>
      </div>
      {plan.plannedToday === 0 && (
        <p className="mb-3 rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
          לא תוזמנו האזנות להיום ביומן. ניתן לתזמן האזנה או לבצע האזנה יזומה.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="מתוכננות היום" value={String(plan.plannedToday)} />
        <MiniStat label="הושלמו היום" value={String(plan.completedToday)} />
        <MiniStat label="נותרו היום" value={String(plan.remainingToday)} tone={plan.remainingToday > 0 ? "warning" : "success"} />
        <MiniStat label="עבר זמנן" value={String(plan.overdue)} tone={plan.overdue > 0 ? "danger" : undefined} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <MiniStat label="משובים שנרשמו היום" value={String(plan.evaluationsToday)} />
        <MiniStat label="ציון ממוצע היום" value={avgToday === null ? "—" : String(Math.round(avgToday))} />
      </div>
      {draftsToday > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          הממוצע מחושב על {todaysEvaluations.length} משובים שנרשמו היום, כולל {draftsToday} טיוטות שטרם פורסמו לנציגים.
        </p>
      )}
      {noRecentListening.length > 0 && (
        <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
          <div className="font-semibold text-primary mb-1">{noRecentListening.length} נציגים ללא האזנה השבוע:</div>
          <div className="text-muted-foreground truncate">
            {noRecentListening.slice(0, 4).map((r) => r.name).join(", ")}
            {noRecentListening.length > 4 && ` +${noRecentListening.length - 4}`}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/feedback"><Plus className="ms-1 h-4 w-4" />הוסף האזנה</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/feedback">עבור להאזנות</Link>
        </Button>
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost">בחר נציג</Button>
          </DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>בחר נציג להאזנה</DialogTitle></DialogHeader>
            <Select value={chosen} onValueChange={setChosen}>
              <SelectTrigger><SelectValue placeholder="בחר נציג..." /></SelectTrigger>
              <SelectContent>
                {reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {r.teamName}</SelectItem>)}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button
                disabled={!chosen}
                onClick={() => { setPickerOpen(false); openRepWorkspace(chosen); }}
              >
                המשך להאזנה
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

/* ============ Manager Calls ============ */
function ManagerCallsCard({ reps }: { reps: Rep[] }) {
  const m = useMorning();
  const today = new Date().toISOString().slice(0, 10);
  const plannedToday = m.managerCalls.filter((c) => c.status === "planned" && c.scheduledAt.slice(0, 10) === today);
  const overdue = m.managerCalls.filter((c) => c.status === "overdue" || (c.status === "planned" && c.scheduledAt < new Date().toISOString() && c.scheduledAt.slice(0, 10) !== today));
  const completed = m.managerCalls.filter((c) => c.status === "completed");
  const [addOpen, setAddOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState<ManagerCall | null>(null);

  return (
    <div id="calls" className="rounded-xl border p-4 bg-card scroll-mt-24">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold">
          <PhoneCall className="h-4 w-4 text-primary" />
          שיחות מנהל
        </div>
        <Badge variant="outline">{m.managerCalls.length}</Badge>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="להיום" value={String(plannedToday.length)} />
        <MiniStat label="באיחור" value={String(overdue.length)} tone={overdue.length > 0 ? "danger" : undefined} />
        <MiniStat label="הושלמו" value={String(completed.length)} tone="success" />
      </div>
      <ul className="mt-3 space-y-1.5 max-h-40 overflow-auto">
        {m.managerCalls.slice(0, 4).map((c) => {
          const rep = reps.find((r) => r.id === c.repId);
          return (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{c.subject}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {rep?.name ?? "כללי"} · {new Date(c.scheduledAt).toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <StatusPill status={c.status} />
                {c.status !== "completed" && (
                  <Button size="sm" variant="ghost" onClick={() => setSummaryOpen(c)}>סיים</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3">
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="ms-1 h-4 w-4" />שיחת מנהל</Button>
      </div>
      <AddCallDialog open={addOpen} onOpenChange={setAddOpen} reps={reps} />
      <CallSummaryDialog call={summaryOpen} onClose={() => setSummaryOpen(null)} />
    </div>
  );
}

function StatusPill({ status }: { status: ManagerCall["status"] }) {
  const map = {
    planned: { label: "מתוכנן", cls: "bg-accent text-foreground" },
    overdue: { label: "באיחור", cls: "bg-primary/10 text-primary" },
    completed: { label: "הושלם", cls: "bg-[color:var(--success)]/10 text-success-foreground" },
  } as const;
  const m = map[status];
  return <Badge variant="secondary" className={m.cls}>{m.label}</Badge>;
}

function AddCallDialog({ open, onOpenChange, reps }: { open: boolean; onOpenChange: (o: boolean) => void; reps: Rep[] }) {
  const m = useMorning();
  const [repId, setRepId] = useState("");
  const [subject, setSubject] = useState("");
  const [when, setWhen] = useState(() => new Date(Date.now() + 3600e3).toISOString().slice(0, 16));
  const [saving, setSaving] = useState(false);

  // §P0: was a fire-and-forget addManagerCall() followed on the next line by
  // an unconditional toast.success("שיחה נוספה"). The dialog closed and the
  // manager believed the commitment was recorded whether or not it was. On
  // failure the dialog now STAYS OPEN with the typed values intact.
  const submit = async () => {
    if (!subject.trim()) return toast.error("יש להזין נושא לשיחה");
    setSaving(true);
    try {
      await m.addManagerCall({ repId, subject: subject.trim(), scheduledAt: new Date(when).toISOString() });
      toast.success("השיחה נוספה");
      setSubject(""); setRepId("");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || "הוספת השיחה נכשלה");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>הוספת שיחת מנהל</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block">נציג</Label>
            <Select value={repId} onValueChange={setRepId}>
              <SelectTrigger><SelectValue placeholder="בחר נציג..." /></SelectTrigger>
              <SelectContent>
                {reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block">נושא</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="נושא השיחה" />
          </div>
          <div>
            <Label className="mb-1 block">תאריך ושעה</Label>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving}>{saving ? "שומר..." : "הוסף"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CallSummaryDialog({ call, onClose }: { call: ManagerCall | null; onClose: () => void }) {
  const m = useMorning();
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);

  /**
   * §P0. Two writes, both previously fire-and-forget, followed by one
   * unconditional success toast: completing the call, and — when a follow-up
   * date was given — creating the follow-up call. Either could fail silently.
   *
   * They are sequenced deliberately rather than run together: closing the
   * call is the primary act and is a complete, valid end state on its own. If
   * the follow-up then fails, the caller is told exactly that instead of
   * being shown a blanket failure for work that did commit.
   */
  const submit = async () => {
    if (!call) return;
    setSaving(true);
    try {
      await m.updateManagerCall(call.id, {
        status: "completed",
        summary,
        followUpAt: followUp ? new Date(followUp).toISOString() : undefined,
      });
      if (followUp) {
        try {
          await m.addManagerCall({
            repId: call.repId,
            subject: `מעקב: ${call.subject}`,
            scheduledAt: new Date(followUp).toISOString(),
          });
          toast.success("השיחה סומנה כהושלמה ונקבע מעקב");
        } catch (e) {
          toast.warning(`השיחה סומנה כהושלמה, אך יצירת שיחת המעקב נכשלה: ${(e as Error).message}`);
        }
      } else {
        toast.success("השיחה סומנה כהושלמה");
      }
      setSummary(""); setFollowUp("");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "עדכון השיחה נכשל");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={!!call} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>סיכום שיחה</DialogTitle></DialogHeader>
        {call && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">{call.subject}</div>
            <div>
              <Label className="mb-1 block">סיכום</Label>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} />
            </div>
            <div>
              <Label className="mb-1 block">מעקב (אופציונלי)</Label>
              <Input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={submit} disabled={saving}>{saving ? "שומר..." : "שמור"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ Underwriting ============ */
const UW_STATUSES: UnderwritingStatus[] = ["חדש", "בטיפול", "ממתין לחיתום", "ממתין לנציג", "הושלם"];
const UW_PRIORITIES: { value: UnderwritingPriority; label: string }[] = [
  { value: "high", label: "גבוהה" }, { value: "medium", label: "בינונית" }, { value: "low", label: "נמוכה" },
];

function UnderwritingCard({ reps }: { reps: Rep[] }) {
  const m = useMorning();
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div id="underwriting" className="rounded-xl border p-4 bg-card scroll-mt-24">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold">
          <FileWarning className="h-4 w-4 text-primary" />
          ממשק חיתום
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{m.underwriting.filter((u) => u.status !== "הושלם").length} פתוחים</Badge>
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="ms-1 h-4 w-4" />הוסף</Button>
        </div>
      </div>
      {/* Phones get a stacked card list; the table returns from md: up. */}
      <div className="space-y-2 md:hidden">
        {m.underwriting.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">אין נושאי חיתום פתוחים</p>
        ) : m.underwriting.map((u) => <UwCard key={u.id} u={u} reps={reps} />)}
      </div>
      <div className="hidden md:block scroll-x-touch -mx-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="text-start p-2 font-medium">נציג</th>
              <th className="text-start p-2 font-medium">נושא</th>
              <th className="text-start p-2 font-medium">עדיפות</th>
              <th className="text-start p-2 font-medium">נפתח</th>
              <th className="text-start p-2 font-medium">סטטוס</th>
              <th className="text-start p-2 font-medium">אחראי</th>
              <th className="text-start p-2 font-medium">יעד</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {m.underwriting.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-muted-foreground py-6">אין נושאי חיתום פתוחים</td></tr>
            ) : m.underwriting.map((u) => (
              <UwRow key={u.id} u={u} reps={reps} />
            ))}
          </tbody>
        </table>
      </div>
      <AddUwDialog open={addOpen} onOpenChange={setAddOpen} reps={reps} />
    </div>
  );
}

function useUwMeta(u: UnderwritingIssue, reps: Rep[]) {
  const rep = reps.find((r) => r.id === u.repId);
  const priorityCls = u.priority === "high" ? "bg-primary/10 text-primary" : u.priority === "medium" ? "bg-[color:var(--warning)]/10 text-warning-foreground" : "bg-accent text-foreground";
  const priorityLabel = UW_PRIORITIES.find((p) => p.value === u.priority)?.label;
  return { rep, priorityCls, priorityLabel };
}

function UwCard({ u, reps }: { u: UnderwritingIssue; reps: Rep[] }) {
  const m = useMorning();
  const { rep, priorityCls, priorityLabel } = useUwMeta(u, reps);
  const [busy, setBusy] = useState(false);
  const setStatus = async (v: UnderwritingStatus) => {
    setBusy(true);
    try { await m.updateUnderwriting(u.id, { status: v }); toast.success("הסטטוס עודכן"); }
    catch (e) { toast.error((e as Error).message || "עדכון הסטטוס נכשל"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await m.removeUnderwriting(u.id); toast.success("נושא החיתום נמחק"); }
    catch (e) { toast.error((e as Error).message || "המחיקה נכשלה"); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{rep?.name ?? "—"}</div>
          <div className="text-sm text-foreground/80">{u.subject}</div>
        </div>
        <Badge variant="secondary" className={cn("shrink-0", priorityCls)}>{priorityLabel}</Badge>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>נפתח: {formatDateIL(u.openedAt)}</span>
        <span>יעד: {formatDateIL(u.dueAt)}</span>
        <span>אחראי: {u.owner}</span>
      </div>
      <div className="flex items-center gap-2">
        <Select value={u.status} disabled={busy} onValueChange={(v) => void setStatus(v as UnderwritingStatus)}>
          <SelectTrigger className="flex-1 text-sm" aria-label={`סטטוס עבור ${u.subject}`}><SelectValue /></SelectTrigger>
          <SelectContent>{UW_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>מחק</Button>
      </div>
    </div>
  );
}

function UwRow({ u, reps }: { u: UnderwritingIssue; reps: Rep[] }) {
  const m = useMorning();
  const { rep, priorityCls, priorityLabel } = useUwMeta(u, reps);
  const [busy, setBusy] = useState(false);
  // §P0: both of these were fire-and-forget; the delete additionally fired an
  // unconditional toast.success("נמחק") while the row vanished optimistically.
  const setStatus = async (v: UnderwritingStatus) => {
    setBusy(true);
    try { await m.updateUnderwriting(u.id, { status: v }); toast.success("הסטטוס עודכן"); }
    catch (e) { toast.error((e as Error).message || "עדכון הסטטוס נכשל"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await m.removeUnderwriting(u.id); toast.success("נושא החיתום נמחק"); }
    catch (e) { toast.error((e as Error).message || "המחיקה נכשלה"); }
    finally { setBusy(false); }
  };
  return (
    <tr className="border-t">
      <td className="p-2">{rep?.name ?? "—"}</td>
      <td className="p-2">{u.subject}</td>
      <td className="p-2"><Badge variant="secondary" className={priorityCls}>{priorityLabel}</Badge></td>
      <td className="p-2 text-xs text-muted-foreground">{formatDateIL(u.openedAt)}</td>
      <td className="p-2">
        <Select value={u.status} disabled={busy} onValueChange={(v) => void setStatus(v as UnderwritingStatus)}>
          <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={`סטטוס עבור ${u.subject}`}><SelectValue /></SelectTrigger>
          <SelectContent>{UW_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="p-2 text-xs">{u.owner}</td>
      <td className="p-2 text-xs text-muted-foreground">{formatDateIL(u.dueAt)}</td>
      <td className="p-2 text-end">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>מחק</Button>
      </td>
    </tr>
  );
}


function AddUwDialog({ open, onOpenChange, reps }: { open: boolean; onOpenChange: (o: boolean) => void; reps: Rep[] }) {
  const m = useMorning();
  const [repId, setRepId] = useState("");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<UnderwritingPriority>("medium");
  const [owner, setOwner] = useState("חיתום");
  const [dueAt, setDueAt] = useState(() => new Date(Date.now() + 3 * 24 * 3600e3).toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>הוספת נושא חיתום</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block">נציג</Label>
            <Select value={repId} onValueChange={setRepId}>
              <SelectTrigger><SelectValue placeholder="בחר נציג..." /></SelectTrigger>
              <SelectContent>{reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block">נושא</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="תיאור קצר - ללא פרטי לקוח" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 block">עדיפות</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as UnderwritingPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UW_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">אחראי</Label>
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="mb-1 block">תאריך יעד</Label>
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => {
            if (!subject) return;
            void (async () => {
              // A representative is now required: the corrected RLS policy
              // scopes an issue by the rep it concerns, so an issue with none
              // is admin-only and a manager could create one they then could
              // not see.
              if (!repId) return toast.error("יש לבחור נציג עבור נושא החיתום");
              if (!subject.trim()) return toast.error("יש להזין נושא");
              setSaving(true);
              try {
                await m.addUnderwriting({ repId, subject: subject.trim(), priority, owner, status: "חדש", dueAt });
                toast.success("נושא החיתום נוסף");
                setSubject(""); setRepId("");
                onOpenChange(false);
              } catch (e) {
                toast.error((e as Error).message || "הוספת נושא החיתום נכשלה");
              } finally {
                setSaving(false);
              }
            })();
          }} disabled={saving}>{saving ? "שומר..." : "הוסף"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ Morning Update Generator ============ */
function MorningUpdateCard({ achievementPct, hasTeamTarget, teamTarget, repGoalsByRepId, reps, wdRemaining, totalResult }: {
  achievementPct: number | null; hasTeamTarget: boolean; teamTarget: number | null;
  repGoalsByRepId: Map<string, number>; reps: Rep[]; wdRemaining: number; totalResult: number;
}) {
  const m = useMorning();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);

  const generate = () => {
    // Only representatives with an official personal target this month can be
    // ranked by achievement — a rep with no target has no pct to fabricate.
    const withPct = reps
      .filter((r) => repGoalsByRepId.has(r.id))
      .map((r) => ({ ...r, pct: calculateAchievement(r.currentResult, repGoalsByRepId.get(r.id) as number) }))
      .sort((a, b) => b.pct - a.pct);
    const leaders = withPct.slice(0, 3).map((r) => `${r.name} (${formatPct(r.pct)})`).join(", ") || "—";

    /**
     * §P2. This was `withPct.slice(-2)` — the two lowest-RANKED
     * representatives, named in a message copied to WhatsApp and sent to the
     * whole team. On a team where everyone beat target it still named two
     * people as the day's problem, purely because someone has to sort last.
     *
     * The default broadcast no longer names anyone as needing help. It states
     * the team goal, the pace, and the leaders. A manager who genuinely wants
     * to name individuals can still type them in — "ערוך לפני העתקה" exists —
     * but that is now an explicit act, not something the generator does on
     * their behalf.
     */
    const needing = repsNeedingSupport(withPct.map((r) => ({
      repId: r.id,
      repName: r.name,
      achievementPct: r.pct,
      currentResult: r.currentResult,
      target: repGoalsByRepId.get(r.id) ?? null,
      workdaysTotal: workdaysInMonth(),
      workdaysPassed: workdaysPassed(),
    })));
    const focusLine = needing.length === 0
      ? "🎯 פוקוס להיום: שמירה על הקצב — כל הצוות בקצב הנדרש"
      : `🎯 פוקוס להיום: סגירת פערים מול היעד (${needing.length} נציגים מתחת לקצב)`;

    const targetLine = hasTeamTarget && achievementPct !== null
      ? `📊 אחוז עמידה ביעד: ${formatPct(achievementPct)} (${formatNum(totalResult)}/${formatNum(teamTarget ?? 0)})`
      : `📊 לא הוגדר יעד חודשי רשמי לצוות — ביצוע נוכחי: ${formatNum(totalResult)} יחידות`;

    const paceLine = hasTeamTarget && teamTarget !== null
      ? (() => {
          const remaining = Math.max(0, teamTarget - totalResult);
          const perDay = wdRemaining > 0 ? Math.ceil(remaining / wdRemaining) : 0;
          return `\n💪 יעד להיום: ${formatNum(perDay)} יחידות לנציג בממוצע`;
        })()
      : "";

    const msg =
`בוקר טוב לצוות ☀️
עדכון בוקר ${formatDateIL(new Date())}

${targetLine}

⭐ מובילים: ${leaders}
${focusLine}
${paceLine}
בואו נצא לדרך - יום מצוין ומוצלח!`;
    setText(msg);
    setEditing(false);
  };

  // §Polish: this opened with `if (!text) generate();` and then read `text`
  // on the very next line. React state is not synchronous, so that path would
  // have copied an empty string and still reported success — unreachable only
  // because the button is disabled while `text` is empty. Removed rather than
  // left as a trap for whoever removes the guard.
  const copy = async () => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast.success("הועתק ל-WhatsApp"); }
    catch { toast.error("העתקה נכשלה"); }
  };

  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          עדכון בוקר לצוות
        </div>
        {m.savedUpdateTemplate && <Badge variant="outline">תבנית שמורה</Badge>}
      </div>
      {editing || text ? (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="font-mono text-sm leading-relaxed"
          readOnly={!editing}
          onDoubleClick={() => setEditing(true)}
        />
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          לחץ "צור עדכון" כדי להפיק עדכון בוקר אוטומטי מהנתונים
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={generate}><Sparkles className="ms-1 h-4 w-4" />צור עדכון</Button>
        <Button size="sm" variant="outline" onClick={copy} disabled={!text}><Copy className="ms-1 h-4 w-4" />העתק ל-WhatsApp</Button>
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)} disabled={!text}>{editing ? "סיים עריכה" : "ערוך לפני העתקה"}</Button>
        <Button size="sm" variant="ghost" onClick={() => void (async () => {
          if (!text) return;
          try { await m.saveTemplate(text); toast.success("נשמר כתבנית"); }
          catch (e) { toast.error((e as Error).message || "שמירת התבנית נכשלה"); }
        })()} disabled={!text}>
          <Save className="ms-1 h-4 w-4" />שמור כתבנית
        </Button>
        {m.savedUpdateTemplate && (
          <Button size="sm" variant="ghost" onClick={() => { setText(m.savedUpdateTemplate!); setEditing(false); }}>
            טען תבנית
          </Button>
        )}
      </div>
    </div>
  );
}

/* ============ Checklist ============ */
function ChecklistCard() {
  const m = useMorning();
  const [busy, setBusy] = useState<string | null>(null);
  const done = CHECKLIST.filter((t) => m.isChecked(t)).length;

  // §P0: the toggle is server-side and awaited. It used to be
  // `void checklist.upsert({ checked: !current?.checked })` computed from a
  // 15s-stale cache, so a concurrent toggle was silently lost and a cache
  // miss was coerced to "checked".
  const toggle = async (task: string) => {
    setBusy(task);
    try { await m.toggleChecklist(task); }
    catch (e) { toast.error((e as Error).message || "עדכון הצ'קליסט נכשל"); }
    finally { setBusy(null); }
  };
  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold">
          <ListChecks className="h-4 w-4 text-primary" />
          צ'קליסט פתיחת יום
        </div>
        <Badge variant="outline">{done}/{CHECKLIST.length}</Badge>
      </div>
      <Progress value={(done / CHECKLIST.length) * 100} className="h-2 mb-3" />
      <ul className="space-y-1.5">
        {CHECKLIST.map((t) => {
          const checked = m.isChecked(t);
          return (
            <li key={t}>
              <label className={cn("flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer text-sm transition-colors hover:bg-accent/40", checked && "bg-accent/30")}>
                <Checkbox checked={checked} disabled={busy === t} onCheckedChange={() => void toggle(t)} aria-label={t} />
                <span className={cn(checked && "line-through text-muted-foreground")}>{t}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ============ Bits ============ */
function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" | "warning" }) {
  const color = tone === "success" ? "text-success-foreground" : tone === "danger" ? "text-primary" : tone === "warning" ? "text-warning-foreground" : "text-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-semibold", color)}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" | "warning" }) {
  const color = tone === "success" ? "text-success-foreground" : tone === "danger" ? "text-primary" : tone === "warning" ? "text-warning-foreground" : "text-foreground";
  return (
    <div className="rounded-lg border p-2 text-center bg-card">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-extrabold", color)}>{value}</div>
    </div>
  );
}
