import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useApp, useIsManager, teamsFromReps } from "@/lib/store";
import { useAppMode } from "@/lib/app-mode";
import { useCloudTeams } from "@/lib/teams-hooks";
import { createRepresentative, updateRepresentativeMetrics } from "@/lib/rep-admin.functions";
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
  Pencil, Plus, Search,
  Users, CheckCircle2, AlertTriangle, Target, Gauge, LineChart as LineChartIcon,
  FileSpreadsheet, FileText, Printer, Headphones, StickyNote, Lightbulb,
  Sparkles,
} from "lucide-react";
import { formatNum, formatPct, formatDateIL, workdaysInMonth, workdaysPassed, workdaysRemaining } from "@/lib/format";
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
      { name: "description", content: "מרכז ניהול ביצועים לצוותי חידושים - מעקב יעדים, מגמות וסדר עדיפות לליווי" },
      { property: "og:title", content: "ביצועים · Pulse" },
      { property: "og:description", content: "מרכז ניהול ביצועים לצוותי חידושים" },
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
 * identical real data could get different risk levels purely by id. Fixed the
 * same way RepWorkspace's equivalent (riskOf) was fixed.
 */
export function computeRisk(rep: Rep, pct: number, avgScore: number | null, daysSinceLastFeedback: number | null): {
  level: RiskLevel;
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];
  if (pct < 80) { score += 2; reasons.push("ביצוע מתחת ל-80%"); }
  else if (pct < 95) { score += 1; reasons.push("ביצוע מתחת לצפוי"); }
  if (avgScore !== null && avgScore < 60) { score += 2; reasons.push("ציון איכות ממוצע נמוך בהאזנות"); }
  if (daysSinceLastFeedback === null) { score += 1; reasons.push("אין עדיין משוב מתועד"); }
  else if (daysSinceLastFeedback > 30) { score += 1; reasons.push("אין משוב עדכני (מעל 30 יום)"); }
  const level: RiskLevel = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { level, reasons };
}

function paceInfo(rep: Rep) {
  const workdays = workdaysInMonth();
  const passed = Math.max(1, workdaysPassed());
  const remaining = workdaysRemaining();
  const expected = (rep.monthlyTarget / workdays) * passed;
  const forecast = Math.round((rep.currentResult / passed) * workdays);
  const perDay = Math.max(0, Math.ceil((rep.monthlyTarget - rep.currentResult) / Math.max(1, remaining)));
  const paceDelta = rep.currentResult - expected;
  return { expected, forecast, perDay, paceDelta, remaining };
}

type Status = "above" | "onpace" | "attention";
function statusOf(rep: Rep): Status {
  const { paceDelta } = paceInfo(rep);
  const pct = rep.monthlyTarget ? (rep.currentResult / rep.monthlyTarget) * 100 : 0;
  if (pct >= 100 || paceDelta >= rep.monthlyTarget * 0.05) return "above";
  if (paceDelta >= -rep.monthlyTarget * 0.05) return "onpace";
  return "attention";
}

const STATUS_LABEL: Record<Status, string> = {
  above: "מעל היעד",
  onpace: "בקצב",
  attention: "דורש טיפול",
};

function statusBadgeClass(s: Status) {
  if (s === "above") return "bg-[color:var(--success)]/12 text-[color:var(--success)] border border-[color:var(--success)]/25";
  if (s === "onpace") return "bg-[color:var(--warning)]/15 text-[color:oklch(0.45_0.14_75)] border border-[color:var(--warning)]/30";
  return "bg-primary/10 text-primary border border-primary/25";
}

// -------- component --------

type SortKey = "pct_desc" | "pct_asc" | "target" | "result" | "name";
type StatusFilter = "all" | Status;
type TeamFilter = "all" | string;

type EnrichedRep = {
  rep: Rep;
  pct: number;
  gap: number;
  status: Status;
  pace: ReturnType<typeof paceInfo>;
  remaining: number;
  risk: ReturnType<typeof computeRisk>;
};

function PerformancePage() {
  const { state } = useApp();
  const isManager = useIsManager();
  const { open: openWorkspace } = useRepWorkspace();
  const teamOptions = useMemo(() => teamsFromReps(state.reps), [state.reps]);

  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("pct_desc");

  const scoped = isManager ? state.reps : state.reps.filter((r) => r.id === state.currentRepId);

  const enriched = useMemo(
    () =>
      scoped.map((r) => {
        const pct = r.monthlyTarget ? (r.currentResult / r.monthlyTarget) * 100 : 0;
        const status = statusOf(r);
        const { avgScore, daysSinceLast } = feedbackStatsFor(r.id, state.feedback);
        return {
          rep: r,
          pct,
          gap: r.currentResult - r.monthlyTarget,
          status,
          pace: paceInfo(r),
          remaining: Math.max(0, r.monthlyTarget - r.currentResult),
          risk: computeRisk(r, pct, avgScore, daysSinceLast),
        };
      }),
    [scoped, state.feedback]
  );

  const filtered = useMemo(() => {
    let arr = enriched;
    if (teamFilter !== "all") arr = arr.filter((e) => e.rep.teamId === teamFilter);
    if (statusFilter !== "all") arr = arr.filter((e) => e.status === statusFilter);
    if (query.trim()) arr = arr.filter((e) => e.rep.name.includes(query.trim()));
    const sorted = [...arr];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "pct_asc": return a.pct - b.pct;
        case "target": return b.rep.monthlyTarget - a.rep.monthlyTarget;
        case "result": return b.rep.currentResult - a.rep.currentResult;
        case "name": return a.rep.name.localeCompare(b.rep.name, "he");
        default: return b.pct - a.pct;
      }
    });
    return sorted;
  }, [enriched, teamFilter, statusFilter, query, sortKey]);

  const summary = useMemo(() => {
    const total = enriched.length;
    const above = enriched.filter((e) => e.status === "above").length;
    const onpace = enriched.filter((e) => e.status === "onpace").length;
    const attention = enriched.filter((e) => e.status === "attention").length;
    const avgPct = total ? enriched.reduce((s, e) => s + e.pct, 0) / total : 0;
    const teamTarget = enriched.reduce((s, e) => s + e.rep.monthlyTarget, 0);
    const teamForecast = enriched.reduce((s, e) => s + e.pace.forecast, 0);
    const forecastPct = teamTarget ? (teamForecast / teamTarget) * 100 : 0;
    return { total, above, onpace, attention, avgPct, teamTarget, teamForecast, forecastPct };
  }, [enriched]);

  

  const insights = useMemo(() => buildInsights(enriched), [enriched]);
  const coaching = useMemo(
    () =>
      [...enriched]
        .filter((e) => e.status !== "above")
        .sort((a, b) => a.pct - b.pct)
        .slice(0, 5),
    [enriched]
  );

  const exportCsv = () => {
    const rows = [
      ["שם", "צוות", "יעד", "ביצוע", "אחוז", "פער", "תחזית", "סטטוס"],
      ...filtered.map((e) => [
        e.rep.name,
        e.rep.teamName,
        e.rep.monthlyTarget,
        e.rep.currentResult,
        `${Math.round(e.pct)}%`,
        e.gap,
        e.pace.forecast,
        STATUS_LABEL[e.status],
      ]),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `performance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("הקובץ יוצא בהצלחה");
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="ביצועים"
        description="מרכז ניהול ביצועים חודשי - איתור מובילים, נציגים בקצב ואלו הזקוקים לליווי"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <FileSpreadsheet className="ms-1 h-4 w-4" />ייצוא ל-Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <FileText className="ms-1 h-4 w-4" />ייצוא ל-PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="ms-1 h-4 w-4" />הדפסה
            </Button>
            <ManagerOnly>
              <RepFormDialog trigger={<Button size="sm"><Plus className="ms-1 h-4 w-4" />הוספת נציג</Button>} />
            </ManagerOnly>
          </div>
        }
      />

      {/* Summary bar */}
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <SummaryCard tone="neutral" icon={Users} label="סך נציגים" value={formatNum(summary.total)} sub="בצוותי החידושים" />
        <SummaryCard tone="success" icon={CheckCircle2} label="מעל היעד" value={formatNum(summary.above)} sub="נציגים מקדימים" />
        <SummaryCard tone="warning" icon={Gauge} label="בקצב" value={formatNum(summary.onpace)} sub="עומדים בקצב הצפוי" />
        <SummaryCard tone="danger" icon={AlertTriangle} label="דורש טיפול" value={formatNum(summary.attention)} sub="מתחת לקצב הנדרש" />
        <SummaryCard tone="neutral" icon={Target} label="ממוצע עמידה" value={formatPct(summary.avgPct)} sub="בכלל הצוותים" />
        <SummaryCard
          tone={summary.forecastPct >= 100 ? "success" : summary.forecastPct >= 90 ? "warning" : "danger"}
          icon={LineChartIcon}
          label="תחזית סוף חודש"
          value={formatNum(summary.teamForecast)}
          sub={`מתוך יעד ${formatNum(summary.teamTarget)} · ${formatPct(summary.forecastPct)}`}
        />
      </div>

      {/* Insights + Coaching */}
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
              <p className="text-sm text-muted-foreground text-center py-6">כל הנציגים בקצב או מעליו 🎉</p>
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
                        : priority === "medium" ? "bg-[color:var(--warning)]/20 text-[color:oklch(0.45_0.14_75)]"
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

      {/* Filters + table */}
      <Card>
        <CardHeader className="gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
            <CardTitle className="text-base min-w-0 truncate">טבלת ביצועים</CardTitle>
            <div className="text-xs text-muted-foreground shrink-0">
              מציג {filtered.length} מתוך {enriched.length}
            </div>
          </div>
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
            <Select value={teamFilter} onValueChange={(v) => setTeamFilter(v as TeamFilter)}>
              <SelectTrigger><SelectValue placeholder="צוות" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הצוותים</SelectItem>
                {teamOptions.map((t) => <SelectItem key={t.teamId} value={t.teamId}>{t.teamName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger><SelectValue placeholder="סטטוס" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסטטוסים</SelectItem>
                <SelectItem value="above">מעל היעד</SelectItem>
                <SelectItem value="onpace">בקצב</SelectItem>
                <SelectItem value="attention">דורש טיפול</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pct_desc">מיון: אחוז - גבוה לנמוך</SelectItem>
                <SelectItem value="pct_asc">מיון: אחוז - נמוך לגבוה</SelectItem>
                <SelectItem value="target">מיון: יעד חודשי</SelectItem>
                <SelectItem value="result">מיון: ביצוע נוכחי</SelectItem>
                <SelectItem value="name">מיון: שם הנציג</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="לא נמצאו נציגים"
              description="נקו את הסינון או שנו את מונחי החיפוש כדי לראות נציגים נוספים."
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
                      <TableHead className="text-end">יעד</TableHead>
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
                        <TableCell className="text-end tabular-nums">{formatNum(e.rep.monthlyTarget)}</TableCell>
                        <TableCell className="text-end tabular-nums font-medium">{formatNum(e.rep.currentResult)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ColoredBar pct={e.pct} status={e.status} className="flex-1 min-w-[120px]" />
                            <span className="text-xs font-semibold w-10 text-end tabular-nums">{formatPct(e.pct)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-end tabular-nums text-sm">{formatNum(e.pace.perDay)}</TableCell>
                        <TableCell className="text-end">
                          {e.gap >= 0 ? (
                            <span className="inline-flex flex-col items-end">
                              <span className="text-[color:var(--success)] font-medium tabular-nums">+{formatNum(e.gap)}</span>
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
                    <div className="mt-3 flex items-center gap-2">
                      <ColoredBar pct={e.pct} status={e.status} className="flex-1" />
                      <span className="text-sm font-bold tabular-nums w-12 text-end">{formatPct(e.pct)}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <MobileStat label="יעד" value={formatNum(e.rep.monthlyTarget)} />
                      <MobileStat label="ביצוע" value={formatNum(e.rep.currentResult)} />
                      <MobileStat
                        label={e.gap >= 0 ? "מעל היעד" : "נותרו"}
                        value={e.gap >= 0 ? `+${formatNum(e.gap)}` : formatNum(e.remaining)}
                        tone={e.gap >= 0 ? "success" : "danger"}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
                      <RiskBadge level={e.risk.level} />
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {e.remaining > 0 ? `${formatNum(e.pace.perDay)}/יום כדי לעמוד ביעד` : "היעד הושלם"}
                    </div>
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

function StatusDot({ status }: { status: Status }) {
  const c = status === "above" ? "bg-[color:var(--success)]" : status === "onpace" ? "bg-[color:var(--warning)]" : "bg-primary";
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
    low: { label: "🟢 נמוכה", cls: "bg-[color:var(--success)]/12 text-[color:var(--success)] border-[color:var(--success)]/25" },
    medium: { label: "🟡 בינונית", cls: "bg-[color:var(--warning)]/15 text-[color:oklch(0.45_0.14_75)] border-[color:var(--warning)]/30" },
    high: { label: "🔴 גבוהה", cls: "bg-primary/10 text-primary border-primary/25" },
  } as const;
  const m = map[level];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", m.cls)}>{m.label}</span>;
}

function RowQuickActions({ rep, onOpen }: { rep: Rep; onOpen: () => void }) {
  return (
    <div className="inline-flex items-center gap-0.5">
      <ManagerOnly>
        <RepFormDialog rep={rep} trigger={
          <Button variant="ghost" size="icon" aria-label="עריכה" title="עריכה"><Pencil className="h-4 w-4" /></Button>
        } />
      </ManagerOnly>
      <Button variant="ghost" size="icon" aria-label="האזנה" title="הוסף האזנה" onClick={() => toast.success(`נפתח טופס האזנה עבור ${rep.name}`)}>
        <Headphones className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="הערות" title="הערות מנהל" onClick={() => toast.success(`הערות מנהל עבור ${rep.name}`)}>
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
    medium: { label: "עדיפות בינונית", cls: "bg-[color:var(--warning)]/15 text-[color:oklch(0.45_0.14_75)] border-[color:var(--warning)]/30" },
    low: { label: "עדיפות נמוכה", cls: "bg-muted text-muted-foreground border-border" },
  } as const;
  const m = map[level];
  return <span className={cn("hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0", m.cls)}>{m.label}</span>;
}

function MobileStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <div className="rounded-lg bg-muted/40 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold tabular-nums", tone === "success" && "text-[color:var(--success)]", tone === "danger" && "text-primary")}>{value}</div>
    </div>
  );
}

// -------- insights --------

function buildInsights(items: EnrichedRep[]) {
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
  const { teams: cloudTeams } = useCloudTeams();
  const demoTeams = useMemo(() => teamsFromReps(state.reps), [state.reps]);
  const teamOptions = isDemo ? demoTeams.map((t) => ({ id: t.teamId, name: t.teamName })) : cloudTeams;
  const createFn = useServerFn(createRepresentative);
  const updateMetricsFn = useServerFn(updateRepresentativeMetrics);
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(rep?.name ?? "");
  const [teamId, setTeamId] = useState<string>(rep?.teamId ?? "");
  const [target, setTarget] = useState<number>(rep?.monthlyTarget ?? 100);
  const [result, setResult] = useState<number>(rep?.currentResult ?? 0);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isDemo) {
        const teamName = teamOptions.find((t) => t.id === teamId)?.name ?? "ללא צוות";
        if (rep) updateRep(rep.id, { name: name.trim(), teamId: teamId || null, teamName, monthlyTarget: target, currentResult: result });
        else addRep({ name: name.trim(), teamId: teamId || null, teamName, monthlyTarget: target, currentResult: result });
        return;
      }
      if (rep) {
        await updateMetricsFn({ data: { rep_id: rep.id, name: name.trim(), team_id: teamId || null, monthly_target: target, current_result: result } });
      } else {
        await createFn({ data: { name: name.trim(), team_id: teamId || null, monthly_target: target, current_result: result, external_ref: null, user_id: null, active: true } });
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
    if (target <= 0) return toast.error("יעד חייב להיות גדול מ-0");
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
                {teamOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>יעד חודשי</Label>
              <Input type="number" min={0} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>ביצוע נוכחי</Label>
              <Input type="number" min={0} value={result} onChange={(e) => setResult(Number(e.target.value))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>ביטול</Button>
          <Button onClick={submit} disabled={mutation.isPending}>{rep ? "שמירה" : "הוספה"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
