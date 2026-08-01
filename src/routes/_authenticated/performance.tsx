import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useApp, useIsManager } from "@/lib/store";
import { TEAM_LABEL, type Rep, type Team } from "@/lib/seed";
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
  Pencil, Plus, TrendingDown, TrendingUp, Minus, Search,
  Users, CheckCircle2, AlertTriangle, Target, Gauge, LineChart as LineChartIcon,
  FileSpreadsheet, FileText, Printer, Headphones, StickyNote, Lightbulb,
  Sparkles, ArrowUpRight,
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
      { title: "ביצועים · RenewHub" },
      { name: "description", content: "מרכז ניהול ביצועים לצוותי חידושים - מעקב יעדים, מגמות וסדר עדיפות לליווי" },
      { property: "og:title", content: "ביצועים · RenewHub" },
      { property: "og:description", content: "מרכז ניהול ביצועים לצוותי חידושים" },
    ],
  }),
  component: PerformancePage,
});

// -------- deterministic per-rep demo data --------
function hash(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pick<T>(id: string, salt: number, arr: T[]): T {
  return arr[(hash(id) + salt) % arr.length];
}

const MONTHS_HE = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

function monthlyHistory(rep: Rep) {
  // 6 months ending with current pace
  const seed = hash(rep.id);
  const now = new Date();
  const points: { month: string; value: number; target: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = MONTHS_HE[d.getMonth()];
    const noise = ((seed >> (i * 3)) & 0x1f) / 31; // 0..1
    const base = rep.monthlyTarget * (0.55 + noise * 0.75);
    const value = i === 0 ? rep.currentResult : Math.round(base);
    points.push({ month: label, value, target: rep.monthlyTarget });
  }
  return points;
}

function repTrend(rep: Rep): "up" | "down" | "flat" {
  const h = monthlyHistory(rep);
  const prev = h[h.length - 2].value;
  const cur = h[h.length - 1].value;
  const diff = cur - prev;
  const threshold = Math.max(3, prev * 0.05);
  if (diff > threshold) return "up";
  if (diff < -threshold) return "down";
  return "flat";
}

function repTrendPct(rep: Rep): number {
  const h = monthlyHistory(rep);
  const prev = h[h.length - 2].value;
  const cur = h[h.length - 1].value;
  if (!prev) return 0;
  return ((cur - prev) / prev) * 100;
}

function last3MonthsAvg(rep: Rep): number {
  const h = monthlyHistory(rep);
  const last3 = h.slice(-3);
  return last3.reduce((s, p) => s + p.value, 0) / 3;
}

type RiskLevel = "low" | "medium" | "high";
function computeRisk(rep: Rep, pct: number, trendPct: number): {
  level: RiskLevel;
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];
  if (pct < 80) { score += 2; reasons.push("ביצוע מתחת ל-80%"); }
  else if (pct < 95) { score += 1; reasons.push("ביצוע מתחת לצפוי"); }
  if (trendPct <= -5) { score += 2; reasons.push("מגמת ירידה"); }
  else if (trendPct < 0) { score += 1; reasons.push("ירידה קלה במגמה"); }
  const h = hash(rep.id);
  const missingFeedback = h % 5 === 0;
  const missingListening = ((h >> 2) % 4) === 0;
  if (missingFeedback) { score += 1; reasons.push("חסר משוב עדכני"); }
  if (missingListening) { score += 1; reasons.push("ללא האזנה השבוע"); }
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

const KEEP_LIST = [
  "עמידה גבוהה בסטנדרט השירות",
  "בירור צרכים יסודי לפני הצעה",
  "פתיחת שיחה מסודרת ומקצועית",
  "התמדה ורצף חידושים יציב",
  "הצעת שדרוגים בטבעיות",
];
const IMPROVE_LIST = [
  "חיזוק שלב הסגירה בשיחה",
  "העמקת הצעת שדרוגי כיסוי",
  "טיפול בהתנגדות מחיר",
  "ניהול זמן שיחה",
  "מעקב אחר לידים חוזרים",
];
const TASK_LIST = [
  "צפייה בהדרכת שדרוג",
  "פגישת 1:1 עם ראש צוות",
  "תרגול תרחישי התנגדות",
  "האזנה עצמית לשתי שיחות",
  "שיחת שיקוף עם עמית מוביל",
];

function repDemoNotes(rep: Rep) {
  return {
    achievements: [
      pick(rep.id, 1, KEEP_LIST),
      pick(rep.id, 5, KEEP_LIST),
    ],
    improvements: [
      pick(rep.id, 2, IMPROVE_LIST),
      pick(rep.id, 7, IMPROVE_LIST),
    ],
    tasks: [
      pick(rep.id, 3, TASK_LIST),
      pick(rep.id, 9, TASK_LIST),
    ],
    lastListen: (hash(rep.id) % 12) + 1, // days ago
    scores: [
      60 + (hash(rep.id) % 35),
      55 + ((hash(rep.id) >> 3) % 40),
      65 + ((hash(rep.id) >> 5) % 30),
    ],
    managerNote: pick(rep.id, 11, [
      "נציג יציב, מומלץ לחזק סגירות מורכבות.",
      "פוטנציאל גבוה, כדאי לשבץ בהדרכת עמיתים.",
      "יש לעקוב מקרוב אחרי שבועיים הקרובים.",
      "משתפר משמעותית, לחזק את המומנטום.",
    ]),
  };
}

// -------- component --------

type SortKey = "pct_desc" | "pct_asc" | "target" | "result" | "name";
type StatusFilter = "all" | Status;
type TeamFilter = "all" | Team;

function PerformancePage() {
  const { state } = useApp();
  const isManager = useIsManager();
  const { open: openWorkspace } = useRepWorkspace();

  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("pct_desc");

  const scoped = isManager ? state.reps : state.reps.filter((r) => r.id === state.currentRepId);

  const enriched = useMemo(
    () =>
      scoped.map((r) => {
        const pct = r.monthlyTarget ? (r.currentResult / r.monthlyTarget) * 100 : 0;
        const trendPct = repTrendPct(r);
        const status = statusOf(r);
        return {
          rep: r,
          pct,
          gap: r.currentResult - r.monthlyTarget,
          status,
          trend: repTrend(r),
          trendPct,
          pace: paceInfo(r),
          remaining: Math.max(0, r.monthlyTarget - r.currentResult),
          risk: computeRisk(r, pct, trendPct),
          avg3: last3MonthsAvg(r),
        };
      }),
    [scoped]
  );

  const filtered = useMemo(() => {
    let arr = enriched;
    if (teamFilter !== "all") arr = arr.filter((e) => e.rep.team === teamFilter);
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
        TEAM_LABEL[e.rep.team],
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
                        {TEAM_LABEL[e.rep.team]} · פער {e.gap > 0 ? "+" : ""}{formatNum(e.gap)}
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
                <SelectItem value="car">{TEAM_LABEL.car}</SelectItem>
                <SelectItem value="home">{TEAM_LABEL.home}</SelectItem>
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
                      <TableHead>מגמה</TableHead>
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
                          <Badge variant="outline" className="font-normal">{TEAM_LABEL[e.rep.team]}</Badge>
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
                        <TableCell><TrendCell trend={e.trend} pct={e.trendPct} /></TableCell>
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
                        <div className="text-xs text-muted-foreground mt-0.5">{TEAM_LABEL[e.rep.team]}</div>
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
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <TrendCell trend={e.trend} pct={e.trendPct} />
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

function TrendCell({ trend, pct }: { trend: "up" | "down" | "flat"; pct?: number }) {
  const pctLabel = pct !== undefined && Math.abs(pct) >= 0.5 ? `${pct > 0 ? "+" : ""}${Math.round(pct)}%` : null;
  if (trend === "up") return (
    <span className="inline-flex items-center gap-1 text-[color:var(--success)] text-sm">
      <TrendingUp className="h-4 w-4" />
      <span className="tabular-nums">{pctLabel ?? "משתפר"}</span>
    </span>
  );
  if (trend === "down") return (
    <span className="inline-flex items-center gap-1 text-primary text-sm">
      <TrendingDown className="h-4 w-4" />
      <span className="tabular-nums">{pctLabel ?? "בירידה"}</span>
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-sm">
      <Minus className="h-4 w-4" />
      <span className="tabular-nums">{pctLabel ?? "יציב"}</span>
    </span>
  );
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

function buildInsights(items: ReturnType<typeof enrich>[]) {
  if (items.length === 0) return [];
  const out: string[] = [];
  const sorted = [...items].sort((a, b) => b.pct - a.pct);
  const leader = sorted[0];
  if (leader) out.push(`${leader.rep.name} מוביל את החודש עם ${formatPct(leader.pct)} עמידה ביעד.`);

  const carItems = items.filter((e) => e.rep.team === "car");
  const homeItems = items.filter((e) => e.rep.team === "home");
  const avg = (arr: typeof items) => (arr.length ? arr.reduce((s, e) => s + e.pct, 0) / arr.length : 0);
  if (carItems.length && homeItems.length) {
    const diff = avg(carItems) - avg(homeItems);
    if (Math.abs(diff) >= 3) {
      const lead = diff > 0 ? TEAM_LABEL.car : TEAM_LABEL.home;
      const behind = diff > 0 ? TEAM_LABEL.home : TEAM_LABEL.car;
      out.push(`${lead} מקדים את ${behind} ב-${formatPct(Math.abs(diff))}.`);
    }
  }

  const needCoaching = items.filter((e) => e.status === "attention").length;
  if (needCoaching > 0) out.push(`${needCoaching === 1 ? "נציג אחד דורש" : `${needCoaching} נציגים דורשים`} ליווי צמוד השבוע.`);

  const improving = items.filter((e) => e.trend === "up");
  if (improving.length >= 1) {
    const pickImp = improving[hash("imp") % improving.length];
    const delta = 10 + (hash(pickImp.rep.id) % 15);
    out.push(`${pickImp.rep.name} השתפר ב-${delta}% לעומת החודש הקודם.`);
  }

  const above = items.filter((e) => e.status === "above").length;
  if (above > 0) out.push(`${above} נציגים כבר מעל היעד החודשי.`);

  return out.slice(0, 5);
}
// helper to type buildInsights parameter
function enrich(r: Rep) {
  const pct = r.monthlyTarget ? (r.currentResult / r.monthlyTarget) * 100 : 0;
  const trendPct = repTrendPct(r);
  const status = statusOf(r);
  return {
    rep: r, pct, gap: r.currentResult - r.monthlyTarget,
    status, trend: repTrend(r), trendPct, pace: paceInfo(r),
    remaining: Math.max(0, r.monthlyTarget - r.currentResult),
    risk: computeRisk(r, pct, trendPct),
    avg3: last3MonthsAvg(r),
  };
}

// -------- side panel --------

function RepDetailsSheet({
  open, onClose, item,
}: { open: boolean; onClose: () => void; item: ReturnType<typeof enrich> | null }) {
  if (!item) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="left" className="w-full sm:max-w-lg" />
      </Sheet>
    );
  }
  const rep = item.rep;
  const notes = repDemoNotes(rep);
  const history = monthlyHistory(rep);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="left" className="w-full sm:max-w-lg overflow-y-auto p-0">
        <SheetHeader className="p-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary font-bold shrink-0">
              {rep.name.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-lg truncate text-start">{rep.name}</SheetTitle>
              <SheetDescription className="text-start">
                {TEAM_LABEL[rep.team]} · <span className={cn("inline-flex items-center gap-1", statusBadgeClass(item.status), "rounded-full px-2 py-0.5 text-xs")}>
                  <StatusDot status={item.status} />{STATUS_LABEL[item.status]}
                </span>
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="p-6 space-y-6">
          {/* KPI mini */}
          <div className="grid grid-cols-3 gap-3">
            <MiniKpi label="יעד חודשי" value={formatNum(rep.monthlyTarget)} />
            <MiniKpi label="ביצוע נוכחי" value={formatNum(rep.currentResult)} />
            <MiniKpi label="אחוז עמידה" value={formatPct(item.pct)} tone={item.status === "above" ? "success" : item.status === "attention" ? "danger" : "warning"} />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>התקדמות ליעד</span>
              <span>{item.remaining > 0 ? `${formatNum(item.remaining)} נותרו · ${formatNum(item.pace.perDay)}/יום` : `+${formatNum(item.gap)} מעל היעד`}</span>
            </div>
            <ColoredBar pct={item.pct} status={item.status} />
            <div className="mt-2 flex items-center justify-between text-xs">
              <TrendCell trend={item.trend} pct={item.trendPct} />
              <span className="text-muted-foreground">תחזית סוף חודש: <span className="font-semibold text-foreground tabular-nums">{formatNum(item.pace.forecast)}</span></span>
            </div>
          </div>

          {/* 3-month trend + Risk */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3">
              <div className="text-[11px] text-muted-foreground">ממוצע 3 חודשים אחרונים</div>
              <div className="mt-1 text-lg font-extrabold tabular-nums">{formatNum(Math.round(item.avg3))}</div>
              <div className="mt-0.5 text-[11px]"><TrendCell trend={item.trend} pct={item.trendPct} /></div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">רמת סיכון</div>
                <RiskBadge level={item.risk.level} />
              </div>
              <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                {item.risk.reasons.length ? item.risk.reasons.slice(0, 3).map((r, i) => (
                  <li key={i}>• {r}</li>
                )) : <li>אין דגלים אדומים</li>}
              </ul>
            </div>
          </div>

          {/* Goals */}
          <div>
            <div className="text-sm font-semibold mb-2">יעדים</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border p-3">
                <div className="text-[11px] text-muted-foreground">יעד חודשי</div>
                <div className="text-base font-bold tabular-nums">{formatNum(rep.monthlyTarget)}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[11px] text-muted-foreground">קצב יומי נדרש</div>
                <div className="text-base font-bold tabular-nums">{formatNum(item.pace.perDay)}/יום</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[11px] text-muted-foreground">ימי עבודה שנותרו</div>
                <div className="text-base font-bold tabular-nums">{formatNum(item.pace.remaining)}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[11px] text-muted-foreground">תחזית סוף חודש</div>
                <div className={cn("text-base font-bold tabular-nums", item.pace.forecast >= rep.monthlyTarget ? "text-[color:var(--success)]" : "text-primary")}>
                  {formatNum(item.pace.forecast)}
                </div>
              </div>
            </div>
          </div>

          {/* Performance summary */}
          <div>
            <div className="text-sm font-semibold mb-2">סיכום ביצועים</div>
            <p className="rounded-xl border bg-muted/30 p-3 text-sm text-foreground/85 leading-relaxed">
              {rep.name} נמצא כעת על <span className="font-semibold">{formatPct(item.pct)}</span> מהיעד החודשי
              {item.trendPct >= 0.5 ? ` עם שיפור של ${Math.round(item.trendPct)}% ` : item.trendPct <= -0.5 ? ` עם ירידה של ${Math.round(Math.abs(item.trendPct))}% ` : " במגמה יציבה "}
              לעומת החודש הקודם. {item.risk.level === "high" ? "רמת הסיכון גבוהה - מומלץ ליווי צמוד." : item.risk.level === "medium" ? "יש דגלים בודדים - כדאי לעקוב השבוע." : "אין דגלים אדומים - להמשיך במגמה."}
            </p>
          </div>

          {/* Chart */}
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><LineChartIcon className="h-4 w-4 text-primary" />מגמה חודשית (6 חודשים)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                    <XAxis dataKey="month" reversed tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={10} tickLine={false} axisLine={false} />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(v: number) => [formatNum(v), "חידושים"]}
                      labelFormatter={(l) => `חודש ${l}`}
                    />
                    <ReferenceLine y={rep.monthlyTarget} stroke="var(--muted-foreground)" strokeDasharray="4 4" opacity={0.5} />
                    <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Quick actions */}
          <div>
            <div className="text-sm font-semibold mb-2">פעולות מהירות</div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => toast.success("פתיחת טופס האזנה חדש")}>
                <Headphones className="ms-1 h-4 w-4" />הוסף האזנה
              </Button>
              <ManagerOnly>
                <RepFormDialog rep={rep} trigger={
                  <Button variant="outline" size="sm"><Pencil className="ms-1 h-4 w-4" />ערוך יעד</Button>
                } />
              </ManagerOnly>
              <Button variant="outline" size="sm" onClick={() => toast.success("הערה נוספה לתיק הנציג")}>
                <StickyNote className="ms-1 h-4 w-4" />הוסף הערה
              </Button>
              <Button variant="outline" size="sm" onClick={() => toast.success("פותח דוח ביצועים מלא")}>
                <ArrowUpRight className="ms-1 h-4 w-4" />פתח ביצועים
              </Button>
            </div>
          </div>

          {/* Feedback + scores */}
          <div>
            <div className="text-sm font-semibold mb-2">האזנות אחרונות</div>
            <div className="rounded-xl border p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>האזנה אחרונה</span>
                <span>לפני {notes.lastListen} ימים · {formatDateIL(new Date(Date.now() - notes.lastListen * 86400000))}</span>
              </div>
              <Separator />
              <div className="grid grid-cols-3 gap-2 text-center">
                {notes.scores.map((s, i) => (
                  <div key={i} className="rounded-lg bg-muted/40 py-2">
                    <div className="text-[11px] text-muted-foreground">האזנה {i + 1}</div>
                    <div className={cn("text-lg font-bold tabular-nums", s >= 85 ? "text-[color:var(--success)]" : s >= 70 ? "text-foreground" : "text-primary")}>{s}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <div className="text-sm font-semibold mb-2">הערות מנהל</div>
            <p className="rounded-xl border bg-muted/30 p-3 text-sm text-foreground/85 leading-relaxed">
              {notes.managerNote}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NoteList title="הישגים" tone="success" items={notes.achievements} />
            <NoteList title="נקודות לשיפור" tone="danger" items={notes.improvements} />
          </div>

          <div>
            <div className="text-sm font-semibold mb-2">משימות קרובות</div>
            <ul className="space-y-1.5">
              {notes.tasks.map((t, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MiniKpi({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="rounded-xl border p-3 text-center">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-1 text-lg font-extrabold tabular-nums",
        tone === "success" && "text-[color:var(--success)]",
        tone === "warning" && "text-[color:oklch(0.45_0.14_75)]",
        tone === "danger" && "text-primary"
      )}>{value}</div>
    </div>
  );
}

function NoteList({ title, tone, items }: { title: string; tone: "success" | "danger"; items: string[] }) {
  return (
    <div>
      <div className="text-sm font-semibold mb-2">{title}</div>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full shrink-0", tone === "success" ? "bg-[color:var(--success)]" : "bg-primary")} aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -------- add/edit dialog --------

function RepFormDialog({
  trigger, rep, defaultTeam = "car",
}: { trigger: React.ReactNode; rep?: Rep; defaultTeam?: Team }) {
  const { addRep, updateRep } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(rep?.name ?? "");
  const [team, setTeam] = useState<Team>(rep?.team ?? defaultTeam);
  const [target, setTarget] = useState<number>(rep?.monthlyTarget ?? 100);
  const [result, setResult] = useState<number>(rep?.currentResult ?? 0);

  const submit = () => {
    if (!name.trim()) return toast.error("יש להזין שם נציג");
    if (target <= 0) return toast.error("יעד חייב להיות גדול מ-0");
    if (result < 0) return toast.error("ביצוע לא יכול להיות שלילי");
    if (rep) {
      updateRep(rep.id, { name: name.trim(), team, monthlyTarget: target, currentResult: result });
      toast.success("הנציג עודכן");
    } else {
      addRep({ name: name.trim(), team, monthlyTarget: target, currentResult: result });
      toast.success("הנציג נוסף");
    }
    setOpen(false);
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
            <Select value={team} onValueChange={(v) => setTeam(v as Team)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="car">{TEAM_LABEL.car}</SelectItem>
                <SelectItem value="home">{TEAM_LABEL.home}</SelectItem>
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
          <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
          <Button onClick={submit}>{rep ? "שמירה" : "הוספה"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
