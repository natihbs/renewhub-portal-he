import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useApp, useIsManager, teamsFromReps } from "@/lib/store";
import { useAppMode } from "@/lib/app-mode";
import { useVisibleTeams } from "@/lib/teams-hooks";
import { useWorkspace, workspaceTeamId } from "@/lib/workspace-context";
import { downloadCsv } from "@/lib/csv-export";
import { createRepresentative, updateRepresentativeMetrics } from "@/lib/rep-admin.functions";
import { ManualPerformanceDialog } from "@/components/ManualPerformanceDialog";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import type { Rep } from "@/lib/seed";
import type { Feedback } from "@/lib/feedback-domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  PenLine,
  Pencil, Plus, Search,
  Users, CheckCircle2, AlertTriangle, Target, Gauge, LineChart as LineChartIcon,
  FileSpreadsheet, Printer, Headphones, StickyNote, Lightbulb,
  Sparkles,
} from "lucide-react";
import { formatNum, formatPct, formatDateIL, workdaysInMonth, workdaysPassed, workdaysRemaining } from "@/lib/format";
import {
  STALE_DATA_HINT,
  calculateAchievement, calculateGap, paceStatus, paceInfo as sharedPaceInfo, computeRisk as sharedComputeRisk,
  PACE_STATUS_LABEL, DEFAULT_KPI_PROFILE, KPI_PROFILE_LABEL, NO_TIME_REMAINING_LABEL,
  type KpiProfile, type Tone, type PaceInfo,
} from "@/lib/performance-domain";
import { renewalTotalsForTeamHistorical, type RenewalTotals } from "@/lib/kpi-values";
import { calculateRenewalRate, RENEWAL_RATE_UNAVAILABLE_LABEL, renewalRateTone, type RenewalRateResult } from "@/lib/renewal-rate";
import { useRepresentativeGoals, currentGoalMonth } from "@/lib/goals-hooks";
import { toast } from "sonner";
import { ManagerOnly } from "@/components/ManagerOnly";
import { useRepWorkspace } from "@/lib/rep-workspace";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({
    meta: [
      { title: "ביצועים · Pulse" },
      { name: "description", content: "מרכז ניהול ביצועים לצוותי מכירות - מעקב יעדים, מגמות וסדר עדיפות לליווי" },
      { property: "og:title", content: "ביצועים · Pulse" },
      { property: "og:description", content: "מרכז ניהול ביצועים לצוותי מכירות" },
    ],
  }),
  component: PerformancePage,
});

function daysSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export function feedbackStatsFor(repId: string, feedback: Feedback[]): { avgScore: number | null; daysSinceLast: number | null } {
  const list = feedback.filter((f) => f.repId === repId);
  if (list.length === 0) return { avgScore: null, daysSinceLast: null };
  const avgScore = Math.round(list.reduce((s, f) => s + f.score, 0) / list.length);
  const last = [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return { avgScore, daysSinceLast: daysSince(last.date) };
}

type RiskLevel = "low" | "medium" | "high";
/**
 * Derived entirely from real data: target/result pace, and the rep's actual
 * feedback records. No historical monthly snapshot exists in the schema, so unlike
 * the removed version this never fabricates a trend — and the previous
 * "missing feedback"/"missing listening" reasons here were seeded from
 * hash(rep.id) rather than the rep's real feedback history, so two reps with
 * identical real data could get different risk levels purely by id.
 *
 * Thin wrapper kept for its existing call sites/tests — the actual thresholds live
 * in the shared performance-domain module (also used by RepWorkspace's riskOf) so
 * both screens can never drift apart again.
 */
export function computeRisk(_rep: Rep, pct: number, avgScore: number | null, daysSinceLastFeedback: number | null): {
  level: RiskLevel;
  reasons: string[];
} {
  return sharedComputeRisk(pct, avgScore, daysSinceLastFeedback);
}

// "no_target" is an honest, distinct state — never a silent 0%. A rep with no
// official personal target for the current month (representative_goals) is
// simply not put through pace/achievement math at all (§11/§19): no hidden
// fallback to the legacy rep.monthlyTarget column, no fabricated percentage.
type Status = "above" | "onpace" | "attention" | "no_target";

const STATUS_LABEL: Record<Status, string> = { ...PACE_STATUS_LABEL, no_target: "לא הוגדר יעד" };

function statusBadgeClass(s: Status) {
  if (s === "above") return "bg-[color:var(--success)]/12 text-success-foreground border border-[color:var(--success)]/25";
  if (s === "onpace") return "bg-[color:var(--warning)]/15 text-warning-foreground border border-[color:var(--warning)]/30";
  if (s === "no_target") return "bg-muted text-muted-foreground border border-border";
  return "bg-primary/10 text-primary border border-primary/25";
}

// -------- component --------

type SortKey = "pct_desc" | "pct_asc" | "target" | "result" | "name";
type StatusFilter = "all" | Status;
type TeamFilter = "all" | string;

type EnrichedRep = {
  rep: Rep;
  target: number | null;
  pct: number | null;
  gap: number | null;
  status: Status;
  pace: PaceInfo | null;
  remaining: number | null;
  risk: ReturnType<typeof computeRisk>;
};

// Narrowed shape for reps with a confirmed official target — used wherever a
// list has already been filtered to status !== "no_target", so downstream
// arithmetic doesn't need repeated null checks for values we've already
// established are present.
type TargetedRep = EnrichedRep & { target: number; pct: number; gap: number; pace: PaceInfo; remaining: number };
function hasTarget(e: EnrichedRep): e is TargetedRep {
  return e.status !== "no_target";
}

function PerformancePage() {
  const { state } = useApp();
  const isManager = useIsManager();
  const { open: openWorkspace } = useRepWorkspace();
  const teamOptions = useMemo(() => teamsFromReps(state.reps), [state.reps]);
  // Visible (not just active) teams — this page shows historical performance
  // for reps regardless of whether their team has since been deactivated, so
  // the KPI-profile lookup below must resolve for an inactive team too.
  const { teams: cloudTeams } = useVisibleTeams();
  const profileByTeamId = useMemo(() => new Map(cloudTeams.map((t) => [t.id, t.kpiProfile])), [cloudTeams]);
  const profileFor = (teamId: string | null) => (teamId ? profileByTeamId.get(teamId) ?? DEFAULT_KPI_PROFILE : DEFAULT_KPI_PROFILE);
  const renewalTeams = useMemo(
    () => teamOptions.filter((t) => profileFor(t.teamId) === "renewals"),
    [teamOptions, profileByTeamId]
  );

  const [query, setQuery] = useState("");
  // Team scope comes from the shared Workspace Context (header switcher)
  // instead of a page-local filter — see src/lib/workspace-context.tsx.
  const { workspace } = useWorkspace();
  const teamFilter: TeamFilter = workspaceTeamId(workspace);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("pct_desc");

  const selectedTeamProfile = teamFilter !== "all" ? profileFor(teamFilter) : null;

  const scoped = isManager ? state.reps : state.reps.filter((r) => r.id === state.currentRepId);

  // Official monthly targets (representative_goals) for every rep in scope,
  // for the current month — the sole source of truth for personal
  // achievement/pace/forecast (§12/§19). A rep absent from the map has no
  // official target and is never defaulted to 0 or to the legacy
  // rep.monthlyTarget column.
  const repIds = useMemo(() => scoped.map((r) => r.id), [scoped]);
  const { goalsByRepId } = useRepresentativeGoals(repIds, currentGoalMonth());

  const enriched = useMemo(
    () =>
      scoped.map((r): EnrichedRep => {
        const target = goalsByRepId.get(r.id) ?? null;
        const { avgScore, daysSinceLast } = feedbackStatsFor(r.id, state.feedback);
        if (target === null) {
          // Risk is still computed from real feedback signals alone — pct is
          // passed as a neutral 100 so the pct-based risk reasons ("ביצוע
          // מתחת ל-...") never fire for a rep we simply can't measure yet.
          return {
            rep: r, target: null, pct: null, gap: null, status: "no_target",
            pace: null, remaining: null,
            risk: computeRisk(r, 100, avgScore, daysSinceLast),
          };
        }
        const pct = calculateAchievement(r.currentResult, target);
        const status = paceStatus(r.currentResult, target, workdaysInMonth(), workdaysPassed()) as Status;
        return {
          rep: r,
          target,
          pct,
          gap: calculateGap(r.currentResult, target),
          status,
          pace: sharedPaceInfo(target, r.currentResult, workdaysInMonth(), workdaysPassed(), workdaysRemaining()),
          remaining: Math.max(0, target - r.currentResult),
          risk: computeRisk(r, pct, avgScore, daysSinceLast),
        };
      }),
    [scoped, state.feedback, goalsByRepId]
  );

  const missingTargetCount = useMemo(() => enriched.filter((e) => e.status === "no_target").length, [enriched]);

  const filtered = useMemo(() => {
    let arr = enriched;
    if (teamFilter !== "all") arr = arr.filter((e) => e.rep.teamId === teamFilter);
    if (statusFilter !== "all") arr = arr.filter((e) => e.status === statusFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      arr = arr.filter((e) => e.rep.name.toLowerCase().includes(q));
    }
    const sorted = [...arr];
    sorted.sort((a, b) => {
      if (sortKey === "pct_asc" || sortKey === "pct_desc") {
        if (a.pct === null && b.pct === null) return 0;
        if (a.pct === null) return 1;
        if (b.pct === null) return -1;
        return sortKey === "pct_asc" ? a.pct - b.pct : b.pct - a.pct;
      }
      if (sortKey === "target") {
        if (a.target === null && b.target === null) return 0;
        if (a.target === null) return 1;
        if (b.target === null) return -1;
        return b.target - a.target;
      }
      if (sortKey === "result") return b.rep.currentResult - a.rep.currentResult;
      return a.rep.name.localeCompare(b.rep.name, "he");
    });
    return sorted;
  }, [enriched, teamFilter, statusFilter, query, sortKey]);

  const summary = useMemo(() => {
    const targeted = enriched.filter((e) => e.status !== "no_target");
    const total = enriched.length;
    const above = targeted.filter((e) => e.status === "above").length;
    const onpace = targeted.filter((e) => e.status === "onpace").length;
    const attention = targeted.filter((e) => e.status === "attention").length;
    const avgPct = targeted.length ? targeted.reduce((s, e) => s + (e.pct ?? 0), 0) / targeted.length : null;
    const teamTarget = targeted.reduce((s, e) => s + (e.target ?? 0), 0);
    const teamForecast = targeted.reduce((s, e) => s + (e.pace?.forecast ?? 0), 0);
    const forecastPct = teamTarget ? (teamForecast / teamTarget) * 100 : null;
    return { total, above, onpace, attention, avgPct, teamTarget, teamForecast, forecastPct, targetedCount: targeted.length };
  }, [enriched]);

  // Renewal-specific KPIs, only ever computed for a team whose profile actually
  // supports them — never derived from monthlyTarget/currentResult.
  // §P1 attribution: team renewal figures aggregate by the immutable
  // kpi_values.team_id (what THIS TEAM produced), never by today's roster —
  // so transferring a representative no longer moves their past renewal
  // contribution onto their new team's card. See the semantics block in
  // kpi-values.ts.
  const selectedRenewal = useMemo(() => {
    if (selectedTeamProfile !== "renewals" || teamFilter === "all") return null;
    const totals = renewalTotalsForTeamHistorical(teamFilter, state.kpiValues);
    const rate = calculateRenewalRate("renewals", totals.completed, totals.opportunities);
    return { totals, rate };
  }, [selectedTeamProfile, teamFilter, state.kpiValues]);

  const renewalsByTeam = useMemo(() => {
    if (teamFilter !== "all") return [];
    return renewalTeams.map((t) => {
      const totals = renewalTotalsForTeamHistorical(t.teamId, state.kpiValues);
      const rate = calculateRenewalRate("renewals", totals.completed, totals.opportunities);
      return { teamId: t.teamId, teamName: t.teamName, totals, rate };
    });
  }, [teamFilter, renewalTeams, state.kpiValues]);



  // Comparisons/rankings below only make sense across reps we can actually
  // measure — a rep with no official target yet is surfaced separately via
  // missingTargetCount, never silently ranked by a fabricated 0%.
  const targetedEnriched = useMemo(() => enriched.filter(hasTarget), [enriched]);
  const insights = useMemo(() => buildInsights(targetedEnriched), [targetedEnriched]);
  const coaching = useMemo(
    () =>
      [...targetedEnriched]
        .filter((e) => e.status !== "above")
        .sort((a, b) => a.pct - b.pct)
        .slice(0, 5),
    [targetedEnriched]
  );

  const exportCsv = () => {
    const rows = [
      ["שם", "צוות", "יעד אישי", "ביצוע", "אחוז", "פער", "תחזית", "סטטוס"],
      ...filtered.map((e) => [
        e.rep.name,
        e.rep.teamName,
        e.target ?? "לא הוגדר יעד",
        e.rep.currentResult,
        e.pct === null ? "לא זמין" : `${Math.round(e.pct)}%`,
        e.gap ?? "לא זמין",
        e.pace?.forecast ?? "לא זמין",
        STATUS_LABEL[e.status],
      ]),
    ];
    downloadCsv(`performance-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success("הקובץ יוצא בהצלחה");
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={isManager ? "ביצועים" : "הביצועים שלי"}
        description={isManager
          ? "מרכז ניהול ביצועים חודשי - איתור מובילים, נציגים בקצב ואלו הזקוקים לליווי"
          : "מעקב אחר היעד החודשי שלך - קצב, פער ותחזית"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <FileSpreadsheet className="ms-1 h-4 w-4" />ייצוא ל-Excel
            </Button>
            {/* §P3: "ייצוא ל-PDF" and "הדפסה" were two separate buttons both
                calling window.print() — presenting one capability as two.
                There is no dedicated PDF renderer here, so this is the single
                honest action, named for what the browser dialog actually
                offers. */}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="ms-1 h-4 w-4" />הדפסה / שמירה כ-PDF
            </Button>
            <ManagerOnly>
              <RepFormDialog trigger={<Button variant="outline" size="sm"><Plus className="ms-1 h-4 w-4" />הוספת נציג</Button>} />
            </ManagerOnly>
            <ManagerOnly>
              <ManualPerformanceDialog
                sourceScreen="performance-header"
                trigger={
                  <Button size="sm">
                    <PenLine className="ms-1 h-4 w-4" />
                    עדכון ביצועים ידני
                  </Button>
                }
              />
            </ManagerOnly>
          </div>
        }
      />

      {/* Summary bar — team-wide aggregates, meaningless when scoped to a single
          representative's own row, so this is manager/admin only. */}
      {isManager && (
        <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <SummaryCard tone="neutral" icon={Users} label="סך נציגים" value={formatNum(summary.total)} sub="בכלל הצוותים" />
          <SummaryCard tone="success" icon={CheckCircle2} label="מעל היעד" value={formatNum(summary.above)} sub="נציגים מקדימים" />
          <SummaryCard tone="warning" icon={Gauge} label="בקצב" value={formatNum(summary.onpace)} sub="עומדים בקצב הצפוי" />
          <SummaryCard tone="danger" icon={AlertTriangle} label="דורש טיפול" value={formatNum(summary.attention)} sub="מתחת לקצב הנדרש" />
          <SummaryCard
            tone="neutral"
            icon={Target}
            label="ממוצע עמידה"
            value={summary.avgPct === null ? "אין יעדים" : formatPct(summary.avgPct)}
            sub={`מתוך ${summary.targetedCount} נציגים עם יעד מוגדר`}
          />
          <SummaryCard
            tone={summary.forecastPct === null ? "neutral" : summary.forecastPct >= 100 ? "success" : summary.forecastPct >= 90 ? "warning" : "danger"}
            icon={LineChartIcon}
            label="תחזית סוף חודש"
            value={formatNum(summary.teamForecast)}
            sub={summary.forecastPct === null ? "אין יעדים מוגדרים לחישוב תחזית" : `מתוך סך יעדים ${formatNum(summary.teamTarget)} · ${formatPct(summary.forecastPct)}`}
          />
        </div>
      )}

      {/* Honest, actionable — never folded into the flat "0%" achievement
          math: reps with no official personal target for this month need a
          target set, not performance coaching. */}
      {isManager && missingTargetCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 p-3 text-sm">
          <span>
            {missingTargetCount === 1 ? "לנציג אחד אין יעד אישי מוגדר לחודש זה" : `ל-${missingTargetCount} נציגים אין יעד אישי מוגדר לחודש זה`} — לא ניתן לחשב עבורם עמידה, קצב או תחזית.
          </span>
          <Button size="sm" variant="outline" asChild>
            <Link to="/targets">הגדרת יעדים</Link>
          </Button>
        </div>
      )}

      {/* §Simplification: the table is the work area. The renewal context
          cards and management insights are real but secondary — collapsed by
          default so the first screen reads: summary chips, then the table. */}
      {isManager && (
        <CollapsibleSection title="הקשר ותובנות ניהול">
          {/* Renewal-specific KPIs — only for a renewals-profile team, never mixed into
              the universal table. Team-level aggregates, so manager/admin only —
              a rep never has a workspace team scope (always "all"), and the
              per-team breakdown below is explicitly cross-team data. */}
          {isManager && selectedRenewal && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  מדדי חידושים · {teamOptions.find((t) => t.teamId === teamFilter)?.teamName}
                  <Badge variant="secondary" className="bg-primary/10 text-primary">{KPI_PROFILE_LABEL.renewals}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RenewalStatRow totals={selectedRenewal.totals} rate={selectedRenewal.rate} />
              </CardContent>
            </Card>
          )}
          {isManager && teamFilter === "all" && renewalsByTeam.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">חידושים לפי צוות</CardTitle>
                <p className="text-xs text-muted-foreground">
                  מוצג בנפרד מהטבלה הכללית — אחוז חידוש קיים רק לצוותים עם פרופיל "{KPI_PROFILE_LABEL.renewals}" ונתוני חידוש אמיתיים.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {renewalsByTeam.map((t) => (
                  <div key={t.teamId} className="rounded-xl border p-3">
                    <div className="font-semibold text-sm mb-2">{t.teamName}</div>
                    <RenewalStatRow totals={t.totals} rate={t.rate} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Insights + Coaching — comparative/aggregate by nature (who leads, who
              needs coaching relative to the rest), so manager/admin only. */}
          {isManager && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 card-interactive">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" />תובנות ניהול
                </CardTitle>
                <Badge variant="outline" className="text-xs">מבוסס נתונים נוכחיים</Badge>
              </CardHeader>
              <CardContent>
                {insights.length === 0 ? (
                  <EmptyState icon={Lightbulb} title="עדיין אין תובנות" description="ברגע שיהיו נתוני ביצוע יופיעו כאן תובנות אוטומטיות." compact />
                ) : (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {insights.map((t, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-xl border bg-card p-3 text-sm">
                        <Lightbulb className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                        <span className="leading-relaxed">{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="card-interactive">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-primary" />סדר עדיפות לליווי
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {coaching.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="כל הנציגים בקצב או מעליו" description="אין כרגע נציגים הזקוקים לליווי מיוחד." compact />
                ) : (
                  coaching.map((e, i) => {
                    const priority = i < 2 ? "high" : i < 4 ? "medium" : "low";
                    return (
                      <button
                        key={e.rep.id}
                        onClick={() => openWorkspace(e.rep.id)}
                        className="w-full flex items-center gap-3 rounded-xl border p-2.5 text-start hover:bg-accent/40 transition-colors"
                      >
                        <span className={cn(
                          "grid h-8 w-8 place-items-center rounded-lg text-xs font-bold shrink-0",
                          priority === "high" ? "bg-primary/15 text-primary"
                            : priority === "medium" ? "bg-[color:var(--warning)]/20 text-warning-foreground"
                            : "bg-muted text-muted-foreground"
                        )}>{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-sm truncate">{e.rep.name}</div>
                            <span className="text-xs text-muted-foreground">{formatPct(e.pct)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {e.rep.teamName} · פער {e.gap > 0 ? "+" : ""}{formatNum(e.gap)}
                          </div>
                        </div>
                        <PriorityBadge level={priority} />
                      </button>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
          )}
        </CollapsibleSection>
      )}

      {isManager && (
        <p className="text-xs text-muted-foreground" dir="rtl">
          {STALE_DATA_HINT}
        </p>
      )}

      {/* Filters + table — the filter/search/sort controls only make sense across
          more than one row, so they're manager/admin only; a rep still gets
          their own detailed row (pace, risk, status) below, just without
          controls that have nothing to act on. */}
      <Card>
        <CardHeader className="gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
            <CardTitle className="text-base min-w-0 truncate">{isManager ? "טבלת ביצועים" : "הנתונים שלי"}</CardTitle>
            {isManager && (
              <div className="text-xs text-muted-foreground shrink-0">
                מציג {filtered.length} מתוך {enriched.length}
              </div>
            )}
          </div>
          {isManager && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="relative">
              <Search className="absolute inset-y-0 end-2 my-auto h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="חיפוש נציג לפי שם"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pe-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger><SelectValue placeholder="סטטוס" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסטטוסים</SelectItem>
                <SelectItem value="above">מעל היעד</SelectItem>
                <SelectItem value="onpace">בקצב</SelectItem>
                <SelectItem value="attention">דורש טיפול</SelectItem>
                <SelectItem value="no_target">לא הוגדר יעד</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pct_desc">מיון: אחוז - גבוה לנמוך</SelectItem>
                <SelectItem value="pct_asc">מיון: אחוז - נמוך לגבוה</SelectItem>
                <SelectItem value="target">מיון: יעד אישי</SelectItem>
                <SelectItem value="result">מיון: ביצוע נוכחי</SelectItem>
                <SelectItem value="name">מיון: שם הנציג</SelectItem>
              </SelectContent>
            </Select>
          </div>
          )}
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title={isManager ? "לא נמצאו נציגים" : "אין עדיין נתוני ביצועים"}
              description={isManager
                ? "נקו את הסינון או שנו את מונחי החיפוש כדי לראות נציגים נוספים."
                : "החשבון שלך עדיין לא מקושר לפרופיל נציג — פנה/י למנהל המערכת."}
              compact
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden lg:block relative overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[180px]">שם הנציג</TableHead>
                      <TableHead>צוות</TableHead>
                      <TableHead className="text-end">יעד אישי</TableHead>
                      <TableHead className="text-end">ביצוע</TableHead>
                      <TableHead className="min-w-[220px]">%</TableHead>
                      <TableHead className="text-end">קצב/יום</TableHead>
                      <TableHead className="text-end">נותרו</TableHead>
                      <TableHead>סטטוס</TableHead>
                      <TableHead>רמת סיכון</TableHead>
                      <TableHead className="text-end">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((e, i) => (
                      <TableRow
                        key={e.rep.id}
                        onClick={() => openWorkspace(e.rep.id)}
                        className={cn(
                          "cursor-pointer transition-colors",
                          i % 2 === 1 && "bg-muted/25",
                          "hover:bg-accent/40"
                        )}
                      >
                        <TableCell className="font-semibold">{e.rep.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">{e.rep.teamName}</Badge>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">{e.target === null ? <span className="text-xs text-muted-foreground">לא הוגדר</span> : formatNum(e.target)}</TableCell>
                        <TableCell className="text-end tabular-nums font-medium">{formatNum(e.rep.currentResult)}</TableCell>
                        <TableCell>
                          {e.pct === null ? (
                            <span className="text-xs text-muted-foreground">לא הוגדר יעד אישי</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <ColoredBar pct={e.pct} status={e.status} className="flex-1 min-w-[120px]" />
                              <span className="text-xs font-semibold w-10 text-end tabular-nums">{formatPct(e.pct)}</span>
                            </div>
                          )}
                        </TableCell>
                        {/* §P3: perDay is null once no working days remain —
                            never a rate computed against a synthetic 1 day. */}
                        <TableCell className="text-end tabular-nums text-sm">
                          {e.pace?.perDay != null ? formatNum(e.pace.perDay) : "—"}
                        </TableCell>
                        <TableCell className="text-end">
                          {e.gap === null || e.remaining === null ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : e.gap >= 0 ? (
                            <span className="inline-flex flex-col items-end">
                              <span className="text-success-foreground font-medium tabular-nums">+{formatNum(e.gap)}</span>
                              <span className="text-[10px] text-muted-foreground">מעל היעד</span>
                            </span>
                          ) : (
                            <span className="inline-flex flex-col items-end">
                              <span className="text-primary font-medium tabular-nums">{formatNum(e.remaining)}</span>
                              <span className="text-[10px] text-muted-foreground">נותרו</span>
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", statusBadgeClass(e.status))}>
                            <StatusDot status={e.status} />
                            {STATUS_LABEL[e.status]}
                          </span>
                        </TableCell>
                        <TableCell><RiskBadge level={e.risk.level} /></TableCell>
                        <TableCell className="text-end" onClick={(ev) => ev.stopPropagation()}>
                          <RowQuickActions rep={e.rep} onOpen={() => openWorkspace(e.rep.id)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile / tablet cards */}
              <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
                {filtered.map((e) => (
                  <button
                    key={e.rep.id}
                    onClick={() => openWorkspace(e.rep.id)}
                    className="text-start rounded-xl border p-4 bg-card hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{e.rep.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{e.rep.teamName}</div>
                      </div>
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium shrink-0", statusBadgeClass(e.status))}>
                        <StatusDot status={e.status} />
                        {STATUS_LABEL[e.status]}
                      </span>
                    </div>
                    {e.pct === null ? (
                      <div className="mt-3 text-xs text-muted-foreground">לא הוגדר יעד אישי לחודש זה — לא ניתן לחשב עמידה, קצב או תחזית.</div>
                    ) : (
                      <div className="mt-3 flex items-center gap-2">
                        <ColoredBar pct={e.pct} status={e.status} className="flex-1" />
                        <span className="text-sm font-bold tabular-nums w-12 text-end">{formatPct(e.pct)}</span>
                      </div>
                    )}
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <MobileStat label="יעד אישי" value={e.target === null ? "לא הוגדר" : formatNum(e.target)} />
                      <MobileStat label="ביצוע" value={formatNum(e.rep.currentResult)} />
                      <MobileStat
                        label={e.gap === null ? "—" : e.gap >= 0 ? "מעל היעד" : "נותרו"}
                        value={e.gap === null || e.remaining === null ? "—" : e.gap >= 0 ? `+${formatNum(e.gap)}` : formatNum(e.remaining)}
                        tone={e.gap === null ? undefined : e.gap >= 0 ? "success" : "danger"}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
                      <RiskBadge level={e.risk.level} />
                    </div>
                    {/* §P3: three genuinely distinct end states — target met,
                        no working days left to act (no rate can be offered),
                        or a real achievable daily rate. */}
                    {e.pace && e.remaining !== null && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {e.remaining <= 0
                          ? "היעד הושלם"
                          : e.pace.periodState === "no_time_remaining"
                          ? NO_TIME_REMAINING_LABEL
                          : `${formatNum(e.pace.perDay as number)}/יום כדי לעמוד ביעד`}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

// -------- small pieces --------

function SummaryCard({
  tone, icon: Icon, label, value, sub,
}: { tone: "neutral" | "success" | "warning" | "danger"; icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string }) {
  const toneMap = {
    neutral: { bar: "bg-muted-foreground/30", icon: "bg-accent text-primary" },
    success: { bar: "bg-[color:var(--success)]", icon: "bg-[color:var(--success)]/12 text-[color:var(--success)]" },
    warning: { bar: "bg-[color:var(--warning)]", icon: "bg-[color:var(--warning)]/15 text-[color:oklch(0.45_0.14_75)]" },
    danger: { bar: "bg-primary", icon: "bg-primary/10 text-primary" },
  } as const;
  const t = toneMap[tone];
  return (
    <Card className="card-interactive relative overflow-hidden">
      <span className={cn("absolute inset-y-0 start-0 w-1", t.bar)} aria-hidden />
      <CardContent className="pt-4 ps-4 sm:pt-5 sm:ps-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className="mt-1.5 text-xl sm:text-2xl font-extrabold tabular-nums break-words">{value}</div>
            {sub && <div className="mt-1 text-[11px] text-muted-foreground truncate">{sub}</div>}
          </div>
          <div className={cn("grid h-9 w-9 place-items-center rounded-xl shrink-0", t.icon)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RenewalStatRow({ totals, rate }: { totals: RenewalTotals; rate: RenewalRateResult }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <MobileStat label="הזדמנויות חידוש" value={totals.opportunities == null ? "אין נתונים" : formatNum(totals.opportunities)} />
      <MobileStat label="חידושים שבוצעו" value={totals.completed == null ? "אין נתונים" : formatNum(totals.completed)} />
      <MobileStat
        label="אחוז חידוש"
        value={rate.available ? formatPct(rate.pct) : "לא זמין"}
        tone={renewalRateTone(rate)}
      />
      {!rate.available && (
        <div className="sm:col-span-3 text-xs text-muted-foreground">{RENEWAL_RATE_UNAVAILABLE_LABEL[rate.reason]}</div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const c = status === "above" ? "bg-[color:var(--success)]"
    : status === "onpace" ? "bg-[color:var(--warning)]"
    : status === "no_target" ? "bg-muted-foreground/50"
    : "bg-primary";
  return <span className={cn("h-1.5 w-1.5 rounded-full", c)} aria-hidden />;
}

function ColoredBar({ pct, status, className }: { pct: number; status: Status; className?: string }) {
  const color = status === "above"
    ? "bg-[color:var(--success)]"
    : status === "onpace"
    ? "bg-[color:var(--warning)]"
    : "bg-primary";
  const width = Math.min(Math.max(pct, 0), 150);
  return (
    <div className={cn("h-2 rounded-full bg-muted overflow-hidden", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(width, 100)}%` }} />
    </div>
  );
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const map = {
    low: { label: "🟢 נמוכה", cls: "bg-[color:var(--success)]/12 text-success-foreground border-[color:var(--success)]/25" },
    medium: { label: "🟡 בינונית", cls: "bg-[color:var(--warning)]/15 text-warning-foreground border-[color:var(--warning)]/30" },
    high: { label: "🔴 גבוהה", cls: "bg-primary/10 text-primary border-primary/25" },
  } as const;
  const m = map[level];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", m.cls)}>{m.label}</span>;
}

function RowQuickActions({ rep, onOpen }: { rep: Rep; onOpen: () => void }) {
  return (
    <div className="inline-flex items-center gap-0.5">
      <ManagerOnly>
        <ManualPerformanceDialog
          rep={rep}
          sourceScreen="performance-row"
          trigger={
            <Button variant="ghost" size="icon" aria-label="עדכון ביצועים ידני" title="עדכון ביצועים ידני">
              <PenLine className="h-4 w-4" />
            </Button>
          }
        />
      </ManagerOnly>
      <ManagerOnly>
        <RepFormDialog rep={rep} trigger={
          <Button variant="ghost" size="icon" aria-label="עריכה" title="עריכת פרטי נציג"><Pencil className="h-4 w-4" /></Button>
        } />
      </ManagerOnly>
      {/* §P0-6 hardening: these used to fire a fake-success toast and record
          nothing. Both now open the real, already-functional workflow for
          the action instead — a deep link into the actual "טופס האזנה חכם"
          dialog (feedback.tsx), and the real representative workspace sheet
          (RepWorkspace) with genuine note-adding, respectively. */}
      <Button variant="ghost" size="icon" aria-label="האזנה" title="הוסף האזנה" asChild>
        <Link to="/feedback" search={{ repId: rep.id }}>
          <Headphones className="h-4 w-4" />
        </Link>
      </Button>
      <Button variant="ghost" size="icon" aria-label="הערות" title="הערות מנהל" onClick={onOpen}>
        <StickyNote className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="פרופיל" title="פתח פרופיל" onClick={onOpen}>
        <LineChartIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}

function PriorityBadge({ level }: { level: "high" | "medium" | "low" }) {
  const map = {
    high: { label: "עדיפות גבוהה", cls: "bg-primary/10 text-primary border-primary/25" },
    medium: { label: "עדיפות בינונית", cls: "bg-[color:var(--warning)]/15 text-warning-foreground border-[color:var(--warning)]/30" },
    low: { label: "עדיפות נמוכה", cls: "bg-muted text-muted-foreground border-border" },
  } as const;
  const m = map[level];
  return <span className={cn("hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0", m.cls)}>{m.label}</span>;
}

function MobileStat({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-lg bg-muted/40 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn(
        "text-sm font-bold tabular-nums",
        tone === "success" && "text-success-foreground",
        tone === "warning" && "text-warning-foreground",
        tone === "danger" && "text-primary",
      )}>{value}</div>
    </div>
  );
}

// -------- insights --------

// Callers only ever pass targeted reps (pct/target already confirmed
// non-null via the TargetedRep type) — see targetedEnriched at the call site.
function buildInsights(items: TargetedRep[]) {
  if (items.length === 0) return [];
  const out: string[] = [];
  const sorted = [...items].sort((a, b) => b.pct - a.pct);
  const leader = sorted[0];
  if (leader) out.push(`${leader.rep.name} מוביל את החודש עם ${formatPct(leader.pct)} עמידה ביעד.`);

  // Compare the leading vs. trailing team by average pct — generalizes the old
  // fixed car-vs-home comparison to any number of teams.
  const avg = (arr: typeof items) => (arr.length ? arr.reduce((s, e) => s + e.pct, 0) / arr.length : 0);
  const byTeam = new Map<string, { name: string; items: typeof items }>();
  for (const e of items) {
    if (!e.rep.teamId) continue;
    const bucket = byTeam.get(e.rep.teamId) ?? { name: e.rep.teamName, items: [] };
    bucket.items.push(e);
    byTeam.set(e.rep.teamId, bucket);
  }
  const teamAverages = Array.from(byTeam.values(), (b) => ({ name: b.name, avgPct: avg(b.items) }));
  if (teamAverages.length >= 2) {
    teamAverages.sort((a, b) => b.avgPct - a.avgPct);
    const [top, bottom] = [teamAverages[0], teamAverages[teamAverages.length - 1]];
    const diff = top.avgPct - bottom.avgPct;
    if (diff >= 3) {
      out.push(`${top.name} מקדים את ${bottom.name} ב-${formatPct(diff)}.`);
    }
  }

  const needCoaching = items.filter((e) => e.status === "attention").length;
  if (needCoaching > 0) out.push(`${needCoaching === 1 ? "נציג אחד דורש" : `${needCoaching} נציגים דורשים`} ליווי צמוד השבוע.`);

  const above = items.filter((e) => e.status === "above").length;
  if (above > 0) out.push(`${above} נציגים כבר מעל היעד החודשי.`);

  return out.slice(0, 5);
}
// -------- add/edit dialog --------

function RepFormDialog({ trigger, rep }: { trigger: React.ReactNode; rep?: Rep }) {
  const { isDemo } = useAppMode();
  const { state, addRep, updateRep } = useApp();
  // §P2 hardening: this used to be active-only (useCloudTeams()), so editing
  // a representative already on a deactivated team showed a blank team field
  // — the id in state.teamId matched no option in the active-only list. Now
  // visible (active + inactive) teams are fetched for correct display, but
  // only active ones (plus the rep's own current team, so an unrelated
  // resubmit still works) are selectable — an inactive team must never
  // become available as a NEW assignment target, matching
  // assertTeamIsActiveForNewAssignment's server-side rule.
  const { teams: visibleTeams } = useVisibleTeams();
  const demoTeams = useMemo(() => teamsFromReps(state.reps), [state.reps]);
  const teamOptions = isDemo ? demoTeams.map((t) => ({ id: t.teamId, name: t.teamName, active: true })) : visibleTeams;
  const createFn = useServerFn(createRepresentative);
  const updateMetricsFn = useServerFn(updateRepresentativeMetrics);
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(rep?.name ?? "");
  const [teamId, setTeamId] = useState<string>(rep?.teamId ?? "");
  const [result, setResult] = useState<number>(rep?.currentResult ?? 0);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isDemo) {
        const teamName = teamOptions.find((t) => t.id === teamId)?.name ?? "ללא צוות";
        // Target-setting lives exclusively on /targets now — this dialog
        // never touches monthlyTarget, on create or edit alike.
        if (rep) updateRep(rep.id, { name: name.trim(), teamId: teamId || null, teamName, currentResult: result });
        else addRep({ name: name.trim(), teamId: teamId || null, teamName, monthlyTarget: 0, currentResult: result });
        return;
      }
      if (rep) {
        // source: "manual" is the honest classification for a manager typing
        // into this dialog, and it is what the server uses to BLOCK the edit
        // if the representative has since been deactivated (see
        // isMetricEditAllowedForInactiveRep) — such a rep must be reactivated
        // rather than silently accumulating new operational numbers.
        await updateMetricsFn({
          data: {
            rep_id: rep.id, name: name.trim(), team_id: teamId || null, current_result: result,
            source: "manual", source_screen: "performance",
          },
        });
      } else {
        await createFn({ data: { name: name.trim(), team_id: teamId || null, current_result: result, external_ref: null, user_id: null, active: true } });
      }
      void qc.invalidateQueries({ queryKey: ["representatives"] });
    },
    onSuccess: () => {
      toast.success(rep ? "הנציג עודכן" : "הנציג נוסף");
      setOpen(false);
    },
    onError: (e: Error) => toast.error("השמירה נכשלה", { description: e.message }),
  });

  const submit = () => {
    if (!name.trim()) return toast.error("יש להזין שם נציג");
    if (result < 0) return toast.error("ביצוע לא יכול להיות שלילי");
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rep ? "עריכת נציג" : "הוספת נציג"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>שם הנציג</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: שירה כהן" />
          </div>
          <div className="space-y-2">
            <Label>צוות</Label>
            <Select value={teamId || "__none__"} onValueChange={(v) => setTeamId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">ללא צוות</SelectItem>
                {teamOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id} disabled={!t.active && t.id !== rep?.teamId}>
                    {t.name}{!t.active ? " · מושבת" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>ביצוע נוכחי</Label>
            <Input type="number" min={0} value={result} onChange={(e) => setResult(Number(e.target.value))} />
          </div>
          <p className="text-xs text-muted-foreground">
            הגדרת יעד חודשי אישי מתבצעת במסך ניהול היעדים הייעודי.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>ביטול</Button>
          <Button onClick={submit} disabled={mutation.isPending}>{rep ? "שמירה" : "הוספה"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
