import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, useIsManager, computeScore, teamsFromReps, visibleFeedback } from "@/lib/store";
import type { Rep, Article } from "@/lib/seed";
import { CRITERIA, type CriterionValue, type Feedback, scoreTone, SCORE_TEXT_CLASS, SCORE_BADGE_CLASS } from "@/lib/feedback-domain";
import { useListening } from "@/lib/listening-store";
import { useRepWorkspace } from "@/lib/rep-workspace";
import { useAuth } from "@/lib/auth";
import { useAppMode } from "@/lib/app-mode";
import { useWorkspace } from "@/lib/workspace-context";
import { useUx } from "@/lib/ux-store";
import { useRepresentativeGoals, currentGoalMonth } from "@/lib/goals-hooks";
import { calculateAchievement } from "@/lib/performance-domain";
import { useServerFn } from "@tanstack/react-start";
import { previewUnpublishedFeedback, publishFeedbackBulk, toBulkPublishFilters, BULK_PUBLISH_NONE } from "@/lib/feedback-admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ManagerOnly } from "@/components/ManagerOnly";
import { formatDateIL } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Plus, Eye, Headphones, Calendar as CalendarIcon, Flame, TrendingUp, TrendingDown,
  Award, Sparkles, AlertTriangle, Trash2, CheckCircle2, BookOpen, Target,
  Users, Trophy, ShieldCheck, Radar as RadarIcon, Grid3x3, Clock, Upload,
} from "lucide-react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar as RRadar, PolarRadiusAxis,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar,
} from "recharts";

// -------------------- Sections & criteria mapping --------------------
type SectionKey =
  | "opening" | "needs" | "value" | "objections" | "upsell"
  | "closing" | "compliance" | "service" | "knowledge" | "impression";

const SECTIONS: { key: SectionKey; label: string; criteriaKeys: string[] }[] = [
  { key: "opening",    label: "פתיחת שיחה",         criteriaKeys: ["opening"] },
  { key: "needs",      label: "אבחון צרכים",         criteriaKeys: ["needs"] },
  { key: "value",      label: "הצגת ערך",            criteriaKeys: ["benefits", "value"] },
  { key: "objections", label: "טיפול בהתנגדויות",    criteriaKeys: ["objections"] },
  { key: "upsell",     label: "שדרוג ומכירה נלווית", criteriaKeys: ["upsell"] },
  { key: "closing",    label: "סיכום וסגירה",         criteriaKeys: ["summary", "closing"] },
  { key: "compliance", label: "עמידה ברגולציה",       criteriaKeys: ["regulation"] },
  { key: "service",    label: "חוויית לקוח",         criteriaKeys: ["service"] },
  { key: "knowledge",  label: "ידע מקצועי",          criteriaKeys: ["knowledge"] },
  { key: "impression", label: "התרשמות מנהל",         criteriaKeys: ["impression"] },
];

const VALUES: { key: CriterionValue; label: string }[] = [
  { key: "done", label: "בוצע" },
  { key: "partial", label: "בוצע חלקית" },
  { key: "not_done", label: "לא בוצע" },
  { key: "na", label: "לא רלוונטי" },
];

/**
 * Recommends a real article from the org's own knowledge base (state.articles) for a
 * weak section, instead of a hardcoded title tied to one specific business's product
 * line (the previous version recommended articles like "יתרונות מנורה ON" regardless
 * of whether that article — or anything like it — actually existed in the cloud
 * articles table). Matches on the section's own generic label against the article's
 * title/category; returns null when nothing in the knowledge base is relevant, which
 * callers must handle instead of assuming a recommendation always exists.
 */
function recommendedArticleFor(section: SectionKey, articles: Article[]): Article | null {
  const label = SECTIONS.find((s) => s.key === section)?.label;
  if (!label) return null;
  return articles.find((a) => a.title.includes(label) || a.category.includes(label) || label.includes(a.category)) ?? null;
}

// -------------------- Helpers --------------------
const criteriaValueToNum = (v?: CriterionValue): number | null => {
  if (v === "done") return 100;
  if (v === "partial") return 50;
  if (v === "not_done") return 0;
  return null;
};

function sectionScoreFor(f: Feedback, section: SectionKey): number | null {
  const s = SECTIONS.find((x) => x.key === section)!;
  const nums = s.criteriaKeys
    .map((k) => criteriaValueToNum(f.criteria[k]))
    .filter((n): n is number => n !== null);
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function daysSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function lastFeedbackFor(feedback: Feedback[], repId: string) {
  return feedback
    .filter((f) => f.repId === repId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
}

function avgScoreFor(feedback: Feedback[], repId?: string) {
  const list = repId ? feedback.filter((f) => f.repId === repId) : feedback;
  if (list.length === 0) return 0;
  return Math.round(list.reduce((a, f) => a + f.score, 0) / list.length);
}

// -------------------- Route --------------------
export const Route = createFileRoute("/_authenticated/feedback")({
  // §P0-6 hardening: lets another page (Performance's "הוספת האזנה" row
  // action) deep-link straight into the real "טופס האזנה חכם" dialog for a
  // specific representative, instead of that button faking success with a
  // toast and recording nothing.
  validateSearch: (search: Record<string, unknown>): { repId?: string } => ({
    repId: typeof search.repId === "string" ? search.repId : undefined,
  }),
  head: () => ({
    meta: [
      { title: "מרכז האזנות חכם · Pulse" },
      { name: "description", content: "מרכז ניהול איכות שיחות: תור האזנות, ניתוח חוזקות וחולשות, תוכנית אימון ויומן האזנות" },
      { property: "og:title", content: "מרכז האזנות חכם · Pulse" },
      { property: "og:description", content: "ניהול איכות שיחות ברמת ארגון: תור, ניתוח, מפת חום ותוכניות אימון" },
    ],
  }),
  component: ListeningCenter,
});

function ListeningCenter() {
  const { state, updateFeedback } = useApp();
  const isManager = useIsManager();
  const { isAdmin } = useAuth();
  const { isDemo } = useAppMode();
  const { pushActivity } = useUx();
  const [openForm, setOpenForm] = useState(false);
  const [openSchedule, setOpenSchedule] = useState(false);
  const [openBulkPublish, setOpenBulkPublish] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [prefRepId, setPrefRepId] = useState<string | undefined>(undefined);
  const [prefScheduleId, setPrefScheduleId] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Reps only ever see their own published feedback — enforced by RLS and the cloud
  // query scope in store.tsx; this filter is a harmless extra safety net, not the
  // real boundary.
  const { workspace } = useWorkspace();
  const feedbackListAll = visibleFeedback(state.feedback, isManager, state.currentRepId);
  // History tab only: narrow to the current Workspace team for a manager who
  // manages more than one (workspace.type is only ever "team" for a manager —
  // see WorkspaceProvider). A single-team manager's feedback was already
  // scoped to just their team via the RLS-backed cloud query, so this is a
  // no-op for them; it only matters for a multi-team manager.
  const feedbackList = isManager && workspace.type === "team"
    ? feedbackListAll.filter((f) => state.reps.find((r) => r.id === f.repId)?.teamId === workspace.teamId)
    : feedbackListAll;
  const viewed = view ? state.feedback.find((f) => f.id === view) : null;
  const editing = editingId ? state.feedback.find((f) => f.id === editingId) ?? null : null;
  const nameOf = (id: string) => state.reps.find((r) => r.id === id)?.name ?? "—";
  const teamNameOf = (id: string) => state.reps.find((r) => r.id === id)?.teamName ?? "ללא צוות";

  const openNewFor = (repId?: string, scheduleId?: string) => {
    setEditingId(null);
    setPrefRepId(repId);
    setPrefScheduleId(scheduleId);
    setOpenForm(true);
  };

  // §P0-6: a ?repId= deep link (from Performance's "הוספת האזנה" row action)
  // opens the real listening form pre-filled for that representative, once —
  // a ref (not state) so closing the dialog afterward never reopens it.
  const search = Route.useSearch();
  const openedFromSearchRef = useRef(false);
  useEffect(() => {
    if (search.repId && isManager && !openedFromSearchRef.current) {
      openedFromSearchRef.current = true;
      openNewFor(search.repId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.repId, isManager]);
  const openEditFor = (id: string) => {
    setEditingId(id);
    setPrefRepId(undefined);
    setPrefScheduleId(undefined);
    setView(null);
    setOpenForm(true);
  };
  const publish = (id: string) => {
    updateFeedback(id, { published: true });
    const f = state.feedback.find((x) => x.id === id);
    if (f) pushActivity({ kind: "feedback", text: `משוב פורסם עבור ${nameOf(f.repId)}` });
    toast.success("המשוב פורסם לנציג");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="מרכז האזנות חכם"
        description={isManager
          ? "ניהול איכות שיחות: תור עדיפויות, ניתוח מגמות, מפת חום צוותית ותוכניות אימון"
          : "צפייה בהיסטוריית ההאזנות והמשוב האישי שלך"}
        actions={
          <div className="flex flex-wrap gap-2">
            <ManagerOnly>
              <Button variant="outline" onClick={() => setOpenSchedule(true)}>
                <CalendarIcon className="ms-1 h-4 w-4" />תזמון האזנה
              </Button>
              <Button onClick={() => openNewFor()}>
                <Plus className="ms-1 h-4 w-4" />האזנה חדשה
              </Button>
            </ManagerOnly>
            {/* Bulk-publishing historical drafts is a deliberately narrower, audited
                action than day-to-day feedback management — admin-only, and only
                meaningful against real cloud data. */}
            {isAdmin && !isDemo && (
              <Button variant="outline" onClick={() => setOpenBulkPublish(true)}>
                <Upload className="ms-1 h-4 w-4" />פרסום משובים קיימים
              </Button>
            )}
          </div>
        }
      />

      {isManager ? (
        <Tabs defaultValue="dashboard" dir="rtl">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="dashboard"><Sparkles className="ms-1 h-4 w-4" />סקירה</TabsTrigger>
            <TabsTrigger value="queue"><Flame className="ms-1 h-4 w-4" />תור האזנות</TabsTrigger>
            <TabsTrigger value="analysis"><RadarIcon className="ms-1 h-4 w-4" />חוזקות וחולשות</TabsTrigger>
            <TabsTrigger value="heatmap"><Grid3x3 className="ms-1 h-4 w-4" />מפת חום</TabsTrigger>
            <TabsTrigger value="coaching"><Target className="ms-1 h-4 w-4" />תוכנית אימון</TabsTrigger>
            <TabsTrigger value="calendar"><CalendarIcon className="ms-1 h-4 w-4" />יומן</TabsTrigger>
            <TabsTrigger value="history"><Clock className="ms-1 h-4 w-4" />היסטוריה</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-4 space-y-4">
            <DashboardTab openNewFor={openNewFor} onOpenSchedule={() => setOpenSchedule(true)} onView={setView} />
          </TabsContent>
          <TabsContent value="queue" className="mt-4">
            <QueueTab openNewFor={openNewFor} />
          </TabsContent>
          <TabsContent value="analysis" className="mt-4 space-y-4">
            <AnalysisTab />
          </TabsContent>
          <TabsContent value="heatmap" className="mt-4">
            <HeatMapTab openNewFor={openNewFor} />
          </TabsContent>
          <TabsContent value="coaching" className="mt-4">
            <CoachingTab openNewFor={openNewFor} />
          </TabsContent>
          <TabsContent value="calendar" className="mt-4">
            <CalendarTab openNewFor={openNewFor} />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <HistoryTable list={feedbackList} nameOf={nameOf} teamNameOf={teamNameOf} onView={setView} isLoading={state.feedbackLoading} isError={!!state.feedbackError} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="space-y-4">
          <MyTasksAndNotes />
          <HistoryTable list={feedbackList} nameOf={nameOf} teamNameOf={teamNameOf} onView={setView} />
        </div>
      )}

      {isManager && (
        <>
          <FeedbackFormDialog
            open={openForm}
            onOpenChange={setOpenForm}
            defaultRepId={prefRepId}
            defaultScheduleId={prefScheduleId}
            editing={editing}
          />
          <ScheduleDialog open={openSchedule} onOpenChange={setOpenSchedule} />
        </>
      )}

      {isAdmin && !isDemo && (
        <AdminBulkPublishDialog open={openBulkPublish} onOpenChange={setOpenBulkPublish} />
      )}

      <Dialog open={!!viewed} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>פירוט משוב — {viewed ? nameOf(viewed.repId) : ""}</DialogTitle></DialogHeader>
          {viewed && (
            <FeedbackView
              f={viewed}
              isManager={isManager}
              onEdit={() => openEditFor(viewed.id)}
              onPublish={() => publish(viewed.id)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -------------------- Dashboard tab --------------------
function DashboardTab({ openNewFor, onOpenSchedule, onView }: {
  openNewFor: (repId?: string) => void;
  onOpenSchedule: () => void;
  onView: (id: string) => void;
}) {
  const { state } = useApp();
  const { schedules } = useListening();
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;
  const prevMonthAgo = now - 60 * 86400000;

  const thisWeek = state.feedback.filter((f) => new Date(f.date).getTime() >= weekAgo);
  const thisMonth = state.feedback.filter((f) => new Date(f.date).getTime() >= monthAgo);
  const prevMonth = state.feedback.filter((f) => {
    const t = new Date(f.date).getTime();
    return t >= prevMonthAgo && t < monthAgo;
  });

  const avgWeek = avgScoreFor(thisWeek);
  const avgMonth = avgScoreFor(thisMonth);
  const avgPrev = avgScoreFor(prevMonth);
  const improvement = avgPrev > 0 ? Math.round(((avgMonth - avgPrev) / avgPrev) * 100) : 0;

  const repIdsHeardThisWeek = new Set(thisWeek.map((f) => f.repId));
  const notHeardThisWeek = state.reps.filter((r) => !repIdsHeardThisWeek.has(r.id));
  const plannedThisWeek = schedules.filter((s) =>
    s.status === "planned" && new Date(s.date).getTime() >= now
  );

  // Trend last 6 weeks
  const weeklyTrend = useMemo(() => {
    const points: { label: string; avg: number; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const to = now - i * 7 * 86400000;
      const from = to - 7 * 86400000;
      const list = state.feedback.filter((f) => {
        const t = new Date(f.date).getTime();
        return t >= from && t < to;
      });
      const d = new Date(to);
      points.push({
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        avg: avgScoreFor(list),
        count: list.length,
      });
    }
    return points;
  }, [state.feedback, now]);

  const criticalAlerts = state.reps
    .map((r) => {
      const last = lastFeedbackFor(state.feedback, r.id);
      const avg = avgScoreFor(state.feedback, r.id);
      return { r, last, avg, days: last ? daysSince(last.date) : 999 };
    })
    .filter((x) => (x.last && x.avg < 60) || x.days > 14)
    .slice(0, 5);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniKpi icon={Headphones} label="בוצעו השבוע" value={String(thisWeek.length)} sub={`${state.feedback.length} סה"כ`} />
        <MiniKpi icon={CalendarIcon} label="מתוכננות" value={String(plannedThisWeek.length)} sub="ביומן ההאזנות" />
        <MiniKpi
          icon={Users}
          label="ללא האזנה השבוע"
          value={String(notHeardThisWeek.length)}
          sub={`מתוך ${state.reps.length} נציגים`}
          tone={notHeardThisWeek.length > state.reps.length / 2 ? "danger" : undefined}
        />
        <MiniKpi
          icon={Award}
          label="ציון איכות ממוצע"
          value={String(avgMonth)}
          sub={improvement !== 0 ? `${improvement > 0 ? "+" : ""}${improvement}% מול חודש קודם` : "אין השוואה"}
          tone={improvement >= 0 ? "success" : "danger"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              מגמת ציון איכות - 6 שבועות אחרונים
            </CardTitle>
            <Badge variant="outline">ממוצע שבועי</Badge>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyTrend}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={12} tickMargin={6} />
                  <YAxis domain={[0, 100]} width={30} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="avg" stroke="hsl(var(--primary))" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              התראות איכות
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalAlerts.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="אין התראות פעילות" compact />
            ) : criticalAlerts.map(({ r, last, avg, days }) => (
              <button
                key={r.id}
                onClick={() => openNewFor(r.id)}
                className="w-full text-start rounded-lg border p-3 hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-sm">{r.name}</div>
                  <Badge variant="secondary" className="bg-primary/10 text-primary">{avg || "—"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {!last ? "ללא האזנה" : `לפני ${days} ימים · ${avg < 60 ? "ציון נמוך" : "טעון רענון"}`}
                </div>
              </button>
            ))}
            <Button size="sm" variant="ghost" className="w-full mt-2" onClick={onOpenSchedule}>
              <CalendarIcon className="ms-1 h-4 w-4" />תזמון האזנה
            </Button>
          </CardContent>
        </Card>
      </div>

      <RecentSessions list={state.feedback.slice(0, 5)} onView={onView} />
    </>
  );
}

function RecentSessions({ list, onView }: { list: Feedback[]; onView: (id: string) => void }) {
  const { state } = useApp();
  const nameOf = (id: string) => state.reps.find((r) => r.id === id)?.name ?? "—";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">האזנות אחרונות</CardTitle>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <EmptyState icon={Headphones} title="עדיין לא נרשמו האזנות" description="פתחו האזנה חדשה כדי לתעד ציון וסיכום." compact />
        ) : (
          <ul className="divide-y">
            {list.map((f) => (
              <li key={f.id}>
                <button onClick={() => onView(f.id)} className="w-full flex items-center gap-3 py-3 hover:bg-accent/30 transition-colors -mx-2 px-2 rounded">
                  <div className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-full font-bold text-sm",
                    SCORE_BADGE_CLASS[scoreTone(f.score)]
                  )}>{f.score}</div>
                  <div className="min-w-0 flex-1 text-start">
                    <div className="font-medium text-sm">{nameOf(f.repId)} <span className="text-muted-foreground font-normal">· {f.callType}</span></div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{f.managerSummary || f.keep || "—"}</div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">{formatDateIL(f.date)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// -------------------- Queue tab --------------------
function QueueTab({ openNewFor }: { openNewFor: (repId?: string) => void }) {
  const { state } = useApp();
  const { open: openRepWorkspace } = useRepWorkspace();
  // Official monthly target (representative_goals) — the sole source of
  // truth for "עמידה ביעד" here too (§19), never the legacy
  // rep.monthlyTarget column.
  const repIds = useMemo(() => state.reps.map((r) => r.id), [state.reps]);
  const { goalsByRepId } = useRepresentativeGoals(repIds, currentGoalMonth());

  const ranked = useMemo(() => {
    return state.reps.map((r) => {
      const last = lastFeedbackFor(state.feedback, r.id);
      const days = last ? daysSince(last.date) : 30;
      const avg = avgScoreFor(state.feedback, r.id);
      const target = goalsByRepId.get(r.id) ?? null;
      const pct = target === null ? null : calculateAchievement(r.currentResult, target);
      // Priority score (higher = more urgent)
      let priority = 0;
      priority += Math.min(days, 30);            // time since last
      if (avg && avg < 60) priority += 30;       // low quality
      else if (avg && avg < 75) priority += 15;
      if (pct !== null && pct < 80) priority += 20; // performance decline proxy — never fabricated when target is unset
      if (!last) priority += 25;
      const level: "high" | "medium" | "low" =
        priority >= 45 ? "high" : priority >= 25 ? "medium" : "low";
      return { r, last, days, avg, pct, priority, level };
    }).sort((a, b) => b.priority - a.priority);
  }, [state.reps, state.feedback, goalsByRepId]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" />
          תור האזנות מומלץ
        </CardTitle>
        <Badge variant="outline">ממוין לפי דחיפות</Badge>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>עדיפות</TableHead>
                <TableHead>נציג</TableHead>
                <TableHead>צוות</TableHead>
                <TableHead>האזנה אחרונה</TableHead>
                <TableHead>ציון ממוצע</TableHead>
                <TableHead>עמידה ביעד</TableHead>
                <TableHead>סיבה</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map(({ r, last, days, avg, pct, level }) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openRepWorkspace(r.id)}>
                  <TableCell><PriorityBadge level={level} /></TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="secondary">{r.teamName}</Badge></TableCell>
                  <TableCell className="text-sm">{last ? `${formatDateIL(last.date)} · לפני ${days} ימים` : "טרם בוצע"}</TableCell>
                  <TableCell>
                    <span className={cn("font-bold",
                      avg >= 80 ? "text-success-foreground" : avg >= 60 ? "text-warning-foreground" : "text-primary"
                    )}>{avg || "—"}</span>
                  </TableCell>
                  <TableCell className="text-sm">{pct === null ? <span className="text-muted-foreground">לא הוגדר יעד</span> : `${Math.round(pct)}%`}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {reasonFor(level, days, avg, pct, !!last)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => openNewFor(r.id)}>
                      <Headphones className="ms-1 h-3.5 w-3.5" />האזנה
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function reasonFor(level: string, days: number, avg: number, pct: number | null, hasAny: boolean) {
  const reasons: string[] = [];
  if (!hasAny) reasons.push("ללא היסטוריה");
  else if (days > 14) reasons.push(`${days} ימים ללא האזנה`);
  if (avg && avg < 60) reasons.push("ציון נמוך");
  if (pct === null) reasons.push("לא הוגדר יעד אישי");
  else if (pct < 80) reasons.push("ירידה בביצוע");
  return reasons.join(" · ") || (level === "low" ? "מעקב שגרתי" : "—");
}

function PriorityBadge({ level }: { level: "high" | "medium" | "low" }) {
  const cfg = {
    high: { text: "גבוהה", cls: "bg-primary/15 text-primary" },
    medium: { text: "בינונית", cls: "bg-[color:var(--warning)]/15 text-warning-foreground" },
    low: { text: "נמוכה", cls: "bg-[color:var(--success)]/15 text-success-foreground" },
  } as const;
  const c = cfg[level];
  return <Badge className={cn("border-0", c.cls)}>{c.text}</Badge>;
}

// -------------------- Analysis tab (Radar + strengths/weaknesses) --------------------
function AnalysisTab() {
  const { state } = useApp();
  const [repId, setRepId] = useState<string>("__all__");

  const list = repId === "__all__" ? state.feedback : state.feedback.filter((f) => f.repId === repId);

  const sectionAverages = SECTIONS.map((s) => {
    const nums = list.map((f) => sectionScoreFor(f, s.key)).filter((n): n is number => n !== null);
    return { section: s.label, key: s.key, avg: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0, count: nums.length };
  });

  const sorted = [...sectionAverages].filter((x) => x.count > 0).sort((a, b) => b.avg - a.avg);
  const strengths = sorted.slice(0, 3);
  const weaknesses = [...sorted].reverse().slice(0, 3);

  // Trend: compare first half vs second half chronologically
  const sortedByDate = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
  const mid = Math.floor(sortedByDate.length / 2);
  const first = sortedByDate.slice(0, mid);
  const second = sortedByDate.slice(mid);
  const trends = SECTIONS.map((s) => {
    const avgOf = (arr: Feedback[]) => {
      const nums = arr.map((f) => sectionScoreFor(f, s.key)).filter((n): n is number => n !== null);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    };
    const a = avgOf(first);
    const b = avgOf(second);
    if (a === null || b === null) return { label: s.label, dir: "steady" as const, delta: 0 };
    const delta = Math.round(b - a);
    return { label: s.label, dir: delta > 3 ? "up" as const : delta < -3 ? "down" as const : "steady" as const, delta };
  });

  const improving = trends.filter((t) => t.dir === "up");
  const declining = trends.filter((t) => t.dir === "down");

  return (
    <>
      <div className="flex items-center gap-2">
        <Label className="text-sm">היקף:</Label>
        <Select value={repId} onValueChange={setRepId}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">כלל הצוות</SelectItem>
            {state.reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={Headphones} title="אין נתוני האזנות" description="בצעו האזנות כדי לראות ניתוח חוזקות וחולשות." compact />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RadarIcon className="h-4 w-4 text-primary" />
                מפת יכולות
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={sectionAverages}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="section" tick={{ fontSize: 9 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                    <RRadar dataKey="avg" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Award className="h-4 w-4 text-[color:var(--success)]" />
                  חוזקות מובילות
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {strengths.map((s) => (
                  <div key={s.key} className="flex items-center justify-between rounded-lg border p-2">
                    <span className="text-sm font-medium">{s.section}</span>
                    <Badge className="bg-[color:var(--success)]/15 text-success-foreground border-0">{s.avg}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-primary" />
                  חולשות חוזרות
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {weaknesses.map((w) => {
                  const article = recommendedArticleFor(w.key as SectionKey, state.articles);
                  return (
                  <div key={w.key} className="flex items-center justify-between rounded-lg border p-2">
                    <div>
                      <div className="text-sm font-medium">{w.section}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {article ? `המלצה: ${article.title}` : "אין מאמר מומלץ זמין במרכז הידע"}
                      </div>
                    </div>
                    <Badge className="bg-primary/15 text-primary border-0">{w.avg}</Badge>
                  </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-[color:var(--success)]" />נושאים במגמת שיפור</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {improving.length === 0 ? <EmptyState title="אין שיפור מובהק" compact className="py-4" /> :
                improving.map((t) => (
                  <div key={t.label} className="flex items-center justify-between text-sm rounded-md border p-2">
                    <span>{t.label}</span>
                    <span className="text-success-foreground font-semibold">+{t.delta}</span>
                  </div>
                ))
              }
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingDown className="h-4 w-4 text-primary" />נושאים במגמת ירידה</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {declining.length === 0 ? <EmptyState title="אין ירידה מובהקת" compact className="py-4" /> :
                declining.map((t) => (
                  <div key={t.label} className="flex items-center justify-between text-sm rounded-md border p-2">
                    <span>{t.label}</span>
                    <span className="text-primary font-semibold">{t.delta}</span>
                  </div>
                ))
              }
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

// -------------------- Heat map --------------------
function HeatMapTab({ openNewFor }: { openNewFor: (repId?: string) => void }) {
  const { state } = useApp();
  const cell = (repId: string, section: SectionKey) => {
    const list = state.feedback.filter((f) => f.repId === repId);
    const nums = list.map((f) => sectionScoreFor(f, section)).filter((n): n is number => n !== null);
    return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
  };
  const bgFor = (v: number | null) => {
    if (v === null) return "bg-muted text-muted-foreground";
    if (v >= 80) return "bg-[color:var(--success)]/20 text-success-foreground";
    if (v >= 60) return "bg-[color:var(--warning)]/20 text-warning-foreground";
    return "bg-primary/15 text-primary";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Grid3x3 className="h-4 w-4 text-primary" />
          מפת חום צוותית - איכות שיחות לפי נציג וסעיף
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky end-0 bg-card">נציג</TableHead>
              {SECTIONS.map((s) => (
                <TableHead key={s.key} className="text-center whitespace-nowrap">{s.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.reps.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium whitespace-nowrap">
                  <button onClick={() => openNewFor(r.id)} className="hover:underline text-start">{r.name}</button>
                </TableCell>
                {SECTIONS.map((s) => {
                  const v = cell(r.id, s.key);
                  return (
                    <TableCell key={s.key} className="p-1">
                      <div className={cn("rounded-md text-center py-2 font-semibold", bgFor(v))}>
                        {v ?? "—"}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[color:var(--success)]/40" />80+</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[color:var(--warning)]/40" />60-79</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-primary/30" />&lt;60</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-muted" />ללא נתונים</span>
        </div>
      </CardContent>
    </Card>
  );
}

// -------------------- Coaching plan --------------------
function CoachingTab({ openNewFor }: { openNewFor: (repId?: string) => void }) {
  const { state } = useApp();
  const [repId, setRepId] = useState<string>(state.reps[0]?.id ?? "");

  const rep = state.reps.find((r) => r.id === repId);
  const list = state.feedback.filter((f) => f.repId === repId);

  const sectionAvgs = SECTIONS.map((s) => {
    const nums = list.map((f) => sectionScoreFor(f, s.key)).filter((n): n is number => n !== null);
    return { section: s, avg: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null };
  });
  const withData = sectionAvgs.filter((s) => s.avg !== null) as { section: typeof SECTIONS[number]; avg: number }[];
  const weakest = [...withData].sort((a, b) => a.avg - b.avg).slice(0, 3);
  const currentAvg = avgScoreFor(state.feedback, repId);

  const nextTargetScore = Math.min(100, currentAvg + 10);
  const last = lastFeedbackFor(state.feedback, repId);
  const daysGap = last ? daysSince(last.date) : 30;
  const frequencyRec = currentAvg < 60 ? "פעמיים בשבוע" : currentAvg < 75 ? "שבועית" : "כל שבועיים";

  const nextMeeting = new Date();
  nextMeeting.setDate(nextMeeting.getDate() + (currentAvg < 60 ? 3 : 7));

  // AI-style rule based summary
  const summary = useMemo(() => {
    if (!rep) return "";
    if (list.length === 0) return `טרם בוצעו האזנות ל${rep.name}. מומלץ לבצע האזנה יזומה השבוע לצורך היכרות ותיעדוף.`;
    const strong = withData.length > 0 ? [...withData].sort((a, b) => b.avg - a.avg)[0] : null;
    const weak = weakest[0];
    const parts: string[] = [];
    parts.push(`ב-${list.length} ההאזנות האחרונות ציון האיכות הממוצע של ${rep.name} עומד על ${currentAvg}.`);
    if (strong) parts.push(`נקודת חוזק בולטת: ${strong.section.label} (${strong.avg}).`);
    if (weak && weak.avg < 70) parts.push(`עדיין קיימת חולשה ב${weak.section.label} (${weak.avg}).`);
    parts.push(`מומלץ לבצע האזנה נוספת ${frequencyRec === "פעמיים בשבוע" ? "בתוך 3 ימים" : "בעוד שבוע"}.`);
    const weakArticle = weak ? recommendedArticleFor(weak.section.key, state.articles) : null;
    if (weakArticle) parts.push(`מומלץ להקצות את מאמר "${weakArticle.title}" מתוך מרכז הידע.`);
    return parts.join(" ");
  }, [rep, list.length, currentAvg, weakest, frequencyRec, withData, state.articles]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label className="text-sm">נציג:</Label>
        <Select value={repId} onValueChange={setRepId}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {state.reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {rep && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                סיכום מנהל - {rep.name}
              </CardTitle>
              <Badge variant="outline">מבוסס חוקים</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{summary}</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  3 יעדי שיפור מובילים
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {weakest.length === 0 ? (
                  <EmptyState title="אין נתונים מספיקים לגיבוש יעדים" compact className="py-4" />
                ) : weakest.map((w, i) => {
                  const article = recommendedArticleFor(w.section.key, state.articles);
                  return (
                  <div key={w.section.key} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-primary text-xs font-bold">{i + 1}</span>
                        {w.section.label}
                      </div>
                      <Badge variant="outline">ציון נוכחי: {w.avg}</Badge>
                    </div>
                    {article && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <BookOpen className="h-3.5 w-3.5" />
                        מאמר מומלץ: {article.title}
                      </div>
                    )}
                  </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  תוכנית פעולה
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <PlanRow label="ציון איכות נוכחי" value={String(currentAvg || "—")} />
                <PlanRow label="יעד ציון לחודש הבא" value={String(nextTargetScore)} tone="success" />
                <PlanRow label="תדירות האזנה מומלצת" value={frequencyRec} />
                <PlanRow label="פגישת מנהל הבאה" value={formatDateIL(nextMeeting)} />
                <PlanRow label="ימים מהאזנה אחרונה" value={last ? String(daysGap) : "טרם בוצע"} tone={daysGap > 14 ? "danger" : undefined} />
                <div className="pt-2 flex gap-2">
                  <Button size="sm" onClick={() => openNewFor(rep.id)}>
                    <Headphones className="ms-1 h-3.5 w-3.5" />פתיחת האזנה
                  </Button>
                  <Button size="sm" variant="outline">
                    <Award className="ms-1 h-3.5 w-3.5" />הקצאת מאמר
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <QualityHistoryChart list={list} />
          <RepBadges list={list} currentAvg={currentAvg} />
        </>
      )}
    </div>
  );
}

function PlanRow({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  const color = tone === "success" ? "text-success-foreground" : tone === "danger" ? "text-primary" : "text-foreground";
  return (
    <div className="flex items-center justify-between rounded-lg border p-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-bold", color)}>{value}</span>
    </div>
  );
}

function QualityHistoryChart({ list }: { list: Feedback[] }) {
  const data = [...list].sort((a, b) => (a.date < b.date ? -1 : 1)).map((f) => ({
    date: formatDateIL(f.date),
    ציון: f.score,
  }));
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">מגמת ציון איכות לאורך זמן</CardTitle></CardHeader>
      <CardContent>
        <div className="h-56 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={12} tickMargin={6} />
              <YAxis domain={[0, 100]} width={30} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="ציון" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function RepBadges({ list, currentAvg }: { list: Feedback[]; currentAvg: number }) {
  const perfectCompliance = list.length >= 3 && list.every((f) => f.criteria.regulation === "done");
  const has100 = list.some((f) => f.score === 100);
  const listeningChampion = list.length >= 5;
  const sortedByDate = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
  const firstAvg = sortedByDate.slice(0, Math.ceil(sortedByDate.length / 2)).reduce((a, f) => a + f.score, 0) / Math.max(1, Math.ceil(sortedByDate.length / 2));
  const lastAvg = sortedByDate.slice(-Math.ceil(sortedByDate.length / 2)).reduce((a, f) => a + f.score, 0) / Math.max(1, Math.ceil(sortedByDate.length / 2));
  const mostImproved = list.length >= 3 && lastAvg - firstAvg >= 15;
  const excellentImprovement = list.length >= 3 && lastAvg - firstAvg >= 10;

  const badges = [
    { has: has100, icon: Trophy, label: "100 באיכות" },
    { has: excellentImprovement, icon: TrendingUp, label: "שיפור מצוין" },
    { has: mostImproved, icon: Sparkles, label: "המשופר ביותר" },
    { has: listeningChampion, icon: Headphones, label: "אלוף האזנות" },
    { has: perfectCompliance, icon: ShieldCheck, label: "רגולציה מושלמת" },
    { has: currentAvg >= 85, icon: Award, label: "מצטיין איכות" },
  ];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Award className="h-4 w-4 text-primary" />הישגים והוקרה</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {badges.map((b) => {
            const Icon = b.icon;
            return (
              <div key={b.label} className={cn(
                "flex items-center gap-2 rounded-lg border p-2.5 text-sm",
                b.has ? "bg-primary/5 border-primary/30" : "opacity-40"
              )}>
                <div className={cn("grid h-8 w-8 place-items-center rounded-full", b.has ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className="font-medium">{b.label}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// -------------------- Calendar tab --------------------
function CalendarTab({ openNewFor }: { openNewFor: (repId?: string, scheduleId?: string) => void }) {
  const { state } = useApp();
  const { schedules, updateSchedule, removeSchedule, isLoading, isError } = useListening();
  const nameOf = (id: string) => state.reps.find((r) => r.id === id)?.name ?? "—";

  const grouped = useMemo(() => {
    const map = new Map<string, typeof schedules>();
    [...schedules].sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)).forEach((s) => {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    });
    return Array.from(map.entries());
  }, [schedules]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-primary" />
          יומן האזנות
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive text-center py-4">שגיאה בטעינת יומן ההאזנות. נסו לרענן את הדף.</p>
        ) : grouped.length === 0 ? (
          <EmptyState icon={CalendarIcon} title="אין האזנות מתוכננות" description="תזמנו האזנה כדי להוסיף ליומן." compact />
        ) : (
          <div className="space-y-4">
            {grouped.map(([date, items]) => (
              <div key={date}>
                <div className="text-sm font-semibold text-muted-foreground mb-2">{formatDateIL(date)}</div>
                <div className="space-y-2">
                  {items.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <div className="text-sm font-mono font-bold text-primary w-14">{s.time}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{nameOf(s.repId)}</div>
                        <div className="text-xs text-muted-foreground truncate">{s.topic}</div>
                      </div>
                      <Badge variant={s.status === "completed" ? "secondary" : s.status === "cancelled" ? "outline" : "default"}>
                        {s.status === "completed" ? "בוצעה" : s.status === "cancelled" ? "בוטלה" : "מתוכננת"}
                      </Badge>
                      <div className="flex items-center gap-1">
                        {s.status === "planned" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openNewFor(s.repId, s.id)}>
                              <CheckCircle2 className="ms-1 h-3.5 w-3.5" />בצע
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" aria-label={`ביטול ההאזנה עם ${nameOf(s.repId)}`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent dir="rtl">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>ביטול האזנה מתוכננת?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    ההאזנה המתוכננת עם {nameOf(s.repId)} בתאריך {formatDateIL(s.date)} תסומן כמבוטלת. ניתן יהיה למחוק את הרשומה בהמשך.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>חזרה</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => updateSchedule(s.id, { status: "cancelled" })}>
                                    ביטול ההאזנה
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                        {s.status !== "planned" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" aria-label={`מחיקת רשומת ההאזנה עם ${nameOf(s.repId)}`}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent dir="rtl">
                              <AlertDialogHeader>
                                <AlertDialogTitle>מחיקת רשומת ההאזנה?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  הפעולה תמחק לצמיתות את רשומת ההאזנה עם {nameOf(s.repId)} מתאריך {formatDateIL(s.date)}. לא ניתן לשחזר לאחר המחיקה.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>ביטול</AlertDialogCancel>
                                <AlertDialogAction onClick={() => removeSchedule(s.id)}>מחיקה</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// -------------------- Representative self-service: my tasks & notes --------------------
/**
 * Reps land here with real, reachable capability: rep_tasks RLS already allows a rep
 * to toggle (not add/delete) their own tasks, and rep_notes already lets them read
 * non-private notes about them — but until now nothing in the UI exposed either to a
 * representative session. Scoped to state.currentRepId; toggleTask/getTasks/getNotes
 * are themselves scoped identically at the query level (see rep-workspace.tsx).
 */
function MyTasksAndNotes() {
  const { state } = useApp();
  const { getTasks, toggleTask, getNotes, isLoading, isError } = useRepWorkspace();
  const repId = state.currentRepId;

  if (!repId) return null;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent className="pt-6"><div className="h-20 animate-pulse rounded-lg bg-muted" /></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="h-20 animate-pulse rounded-lg bg-muted" /></CardContent></Card>
      </div>
    );
  }
  if (isError) {
    return (
      <Card><CardContent className="pt-6 text-sm text-destructive">שגיאה בטעינת המשימות וההערות שלך.</CardContent></Card>
    );
  }

  const tasks = getTasks(repId);
  const notes = getNotes(repId);
  const openTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">המשימות שלי</CardTitle></CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="אין לך משימות פתוחות כרגע" compact />
          ) : (
            <div className="space-y-3">
              {openTasks.length > 0 && (
                <ul className="space-y-1.5">
                  {openTasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 rounded-xl border px-3 py-2">
                      <Checkbox checked={t.done} onCheckedChange={() => toggleTask(repId, t.id)} aria-label={`סימון המשימה ${t.title} כבוצעה`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{t.title}</div>
                        <div className="text-[11px] text-muted-foreground">{t.due ? formatDateIL(t.due) : "ללא תאריך"}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {doneTasks.length > 0 && (
                <ul className="space-y-1.5">
                  {doneTasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 rounded-xl border px-3 py-2 opacity-60">
                      <Checkbox checked={t.done} onCheckedChange={() => toggleTask(repId, t.id)} aria-label={`סימון המשימה ${t.title} כלא בוצעה`} />
                      <div className="text-sm line-through truncate">{t.title}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">הערות עבורי</CardTitle></CardHeader>
        <CardContent>
          {notes.length === 0 ? (
            <EmptyState icon={BookOpen} title="אין הערות שהמנהל שלך שיתף איתך" compact />
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-xl border p-3">
                  <div className="text-[11px] text-muted-foreground mb-1">{n.author} · {formatDateIL(n.date)}</div>
                  <p className="text-sm leading-relaxed">{n.text}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// -------------------- History table --------------------
function HistoryTable({ list, nameOf, teamNameOf, onView, isLoading, isError }: {
  list: Feedback[]; nameOf: (id: string) => string; teamNameOf: (id: string) => string; onView: (id: string) => void;
  isLoading?: boolean; isError?: boolean;
}) {
  if (isLoading) {
    return (
      <Card><CardContent className="pt-6 space-y-2">
        {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}
      </CardContent></Card>
    );
  }
  if (isError) {
    return (
      <Card><CardContent className="pt-6 text-sm text-destructive text-center">שגיאה בטעינת היסטוריית ההאזנות. נסו לרענן את הדף.</CardContent></Card>
    );
  }
  if (list.length === 0) {
    return (
      <Card><CardContent className="pt-6">
        <EmptyState icon={Headphones} title="עדיין לא נרשמו האזנות" description="פתחו האזנה חדשה כדי לתעד ציון וסיכום." compact />
      </CardContent></Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">היסטוריית האזנות</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>תאריך</TableHead>
                <TableHead>נציג</TableHead>
                <TableHead>צוות</TableHead>
                <TableHead>מזהה שיחה</TableHead>
                <TableHead>סוג</TableHead>
                <TableHead>מאזין</TableHead>
                <TableHead>נקודת חוזק</TableHead>
                <TableHead>לשיפור</TableHead>
                <TableHead>ציון</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>{formatDateIL(f.date)}</TableCell>
                  <TableCell className="font-medium">{nameOf(f.repId)}</TableCell>
                  <TableCell><Badge variant="secondary">{teamNameOf(f.repId)}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{f.callId}</TableCell>
                  <TableCell>{f.callType}</TableCell>
                  <TableCell>{f.listener}</TableCell>
                  <TableCell className="max-w-40 truncate text-xs text-muted-foreground">{f.keep}</TableCell>
                  <TableCell className="max-w-40 truncate text-xs text-muted-foreground">{f.improve}</TableCell>
                  <TableCell>
                    <span className={cn("font-bold", SCORE_TEXT_CLASS[scoreTone(f.score)])}>{f.score}</span>
                  </TableCell>
                  <TableCell>
                    {f.published
                      ? <Badge className="bg-[color:var(--success)]/15 text-success-foreground hover:bg-[color:var(--success)]/15 border-transparent">פורסם</Badge>
                      : <Badge variant="outline">טיוטה</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" aria-label="צפייה בהאזנה" onClick={() => onView(f.id)}><Eye className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// -------------------- Feedback view (read-only) --------------------
function FeedbackView({ f, isManager, onEdit, onPublish }: {
  f: Feedback; isManager?: boolean; onEdit?: () => void; onPublish?: () => void;
}) {
  return (
    <div className="space-y-4">
      {isManager && (
        <div className="flex items-center justify-between gap-2 rounded-xl border p-2.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">סטטוס:</span>
            {f.published
              ? <Badge className="bg-[color:var(--success)]/15 text-success-foreground hover:bg-[color:var(--success)]/15 border-transparent">פורסם לנציג</Badge>
              : <Badge variant="outline">טיוטה — לא גלוי לנציג</Badge>}
          </div>
          <div className="flex gap-2">
            {!f.published && onPublish && <Button size="sm" onClick={onPublish}>פרסום לנציג</Button>}
            {onEdit && <Button size="sm" variant="outline" onClick={onEdit}>עריכה</Button>}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Info label="תאריך" value={formatDateIL(f.date)} />
        <Info label="מזהה שיחה" value={f.callId} />
        <Info label="סוג שיחה" value={f.callType} />
        <Info label="מאזין" value={f.listener} />
      </div>
      <div className="text-center rounded-xl bg-secondary py-4">
        <div className="text-xs text-muted-foreground">ציון כללי</div>
        <div className="text-4xl font-extrabold text-primary">{f.score}</div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold">ציון לפי סעיף</div>
        <div className="grid grid-cols-2 gap-2">
          {SECTIONS.map((s) => {
            const v = sectionScoreFor(f, s.key);
            return (
              <div key={s.key} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                <span>{s.label}</span>
                <Badge variant="outline">{v ?? "—"}</Badge>
              </div>
            );
          })}
        </div>
      </div>
      <TextBlock label="נקודות לשימור" value={f.keep} />
      <TextBlock label="נקודות לשיפור" value={f.improve} />
      <TextBlock label="סיכום מנהל" value={f.managerSummary} />
      <TextBlock label="משימה להמשך" value={f.nextTask} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-semibold mb-1">{label}</div>
      <p className="text-sm rounded-lg bg-secondary p-3 whitespace-pre-wrap">{value || "—"}</p>
    </div>
  );
}

// -------------------- MiniKpi --------------------
function MiniKpi({ icon: Icon, label, value, sub, tone }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string;
  tone?: "success" | "danger";
}) {
  const color = tone === "success" ? "text-success-foreground" : tone === "danger" ? "text-primary" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-primary">
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className={cn("mt-2 text-2xl md:text-3xl font-extrabold", color)}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// -------------------- Feedback form dialog (sectioned) --------------------
function FeedbackFormDialog({ open, onOpenChange, defaultRepId, defaultScheduleId, editing }: {
  open: boolean; onOpenChange: (v: boolean) => void; defaultRepId?: string;
  defaultScheduleId?: string; editing?: Feedback | null;
}) {
  const { state, addFeedback, updateFeedback } = useApp();
  const { completeSchedule } = useListening();
  const teamOptions = useMemo(() => teamsFromReps(state.reps), [state.reps]);
  const initialRep = state.reps.find((r) => r.id === (editing?.repId ?? defaultRepId));
  const [teamId, setTeamId] = useState<string>(initialRep?.teamId ?? teamOptions[0]?.teamId ?? "");
  const [repId, setRepId] = useState<string>(editing?.repId ?? defaultRepId ?? "");
  const [date, setDate] = useState(editing?.date ?? new Date().toISOString().slice(0, 10));
  const [callId, setCallId] = useState(editing?.callId ?? "");
  const [callType, setCallType] = useState(editing?.callType ?? "חידוש");
  const [listener, setListener] = useState(editing?.listener ?? "");
  const allKeys = SECTIONS.flatMap((s) => s.criteriaKeys);
  const [criteria, setCriteria] = useState<Record<string, CriterionValue>>(
    editing?.criteria ?? (Object.fromEntries(allKeys.map((k) => [k, "done"])) as Record<string, CriterionValue>)
  );
  const [keep, setKeep] = useState(editing?.keep ?? "");
  const [improve, setImprove] = useState(editing?.improve ?? "");
  const [managerSummary, setManagerSummary] = useState(editing?.managerSummary ?? "");
  const [nextTask, setNextTask] = useState(editing?.nextTask ?? "");

  const score = computeScore(criteria);
  const teamReps = state.reps.filter((r) => r.teamId === teamId);

  // Reload the form whenever a different feedback record is opened for editing, or a
  // new "create for this rep" request comes in.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setRepId(editing.repId);
      const r = state.reps.find((x) => x.id === editing.repId);
      if (r?.teamId) setTeamId(r.teamId);
      setDate(editing.date);
      setCallId(editing.callId);
      setCallType(editing.callType);
      setListener(editing.listener);
      setCriteria(editing.criteria);
      setKeep(editing.keep);
      setImprove(editing.improve);
      setManagerSummary(editing.managerSummary);
      setNextTask(editing.nextTask);
    } else if (defaultRepId) {
      setRepId(defaultRepId);
      const r = state.reps.find((x) => x.id === defaultRepId);
      if (r?.teamId) setTeamId(r.teamId);
    }
  }, [editing, defaultRepId, open, state.reps]);

  const labelForCriterion = (k: string) => CRITERIA.find((c) => c.key === k)?.label ?? k;

  const resetForm = () => {
    setCallId(""); setListener(""); setKeep(""); setImprove(""); setManagerSummary(""); setNextTask("");
    setCriteria(Object.fromEntries(allKeys.map((k) => [k, "done"])) as Record<string, CriterionValue>);
  };

  const submit = () => {
    if (!repId) return toast.error("יש לבחור נציג");
    if (!callId.trim()) return toast.error("יש להזין מזהה שיחה");
    if (!listener.trim()) return toast.error("יש להזין שם מאזין");
    if (editing) {
      // Reassigning feedback to a different representative isn't supported here —
      // the rep/team pickers are locked during edit (see JSX below).
      updateFeedback(editing.id, {
        date, callId: callId.trim(), callType,
        listener: listener.trim(), criteria, keep, improve, managerSummary, nextTask,
      });
      toast.success(`המשוב עודכן. ציון: ${score}`);
    } else {
      addFeedback({
        repId, date, callId: callId.trim(), callType,
        listener: listener.trim(), criteria, keep, improve, managerSummary, nextTask,
        scheduleId: defaultScheduleId ?? null,
      });
      if (defaultScheduleId) completeSchedule(defaultScheduleId);
      toast.success(`ההאזנה נשמרה כטיוטה (ציון: ${score}). יש לפרסם אותה כדי שתוצג לנציג.`);
    }
    onOpenChange(false);
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? "עריכת משוב" : "טופס האזנה חכם"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1"><Label>צוות</Label>
              {editing ? (
                <Input disabled value={teamOptions.find((t) => t.teamId === teamId)?.teamName ?? "—"} />
              ) : (
                <Select value={teamId} onValueChange={(v) => { setTeamId(v); setRepId(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {teamOptions.map((t) => <SelectItem key={t.teamId} value={t.teamId}>{t.teamName}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1"><Label>שם הנציג</Label>
              {editing ? (
                <Input disabled value={state.reps.find((r) => r.id === repId)?.name ?? "—"} />
              ) : (
                <Select value={repId} onValueChange={setRepId}>
                  <SelectTrigger><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                  <SelectContent>
                    {teamReps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1"><Label>תאריך ההאזנה</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>מזהה שיחה פנימי</Label><Input value={callId} onChange={(e) => setCallId(e.target.value)} placeholder="למשל: CAR-1234" /></div>
            <div className="space-y-1"><Label>סוג השיחה</Label>
              <Select value={callType} onValueChange={setCallType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="חידוש">חידוש</SelectItem>
                  <SelectItem value="מכירה">מכירה</SelectItem>
                  <SelectItem value="שימור">שימור</SelectItem>
                  <SelectItem value="שירות">שירות</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>שם המאזין</Label><Input value={listener} onChange={(e) => setListener(e.target.value)} /></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-base">קריטריוני הערכה לפי סעיפים</Label>
              <div className="text-sm">ציון: <span className="font-extrabold text-primary text-lg">{score}</span></div>
            </div>
            <Progress value={score} className="h-2 mb-3" />
            <div className="space-y-3">
              {SECTIONS.map((s) => (
                <div key={s.key} className="rounded-lg border">
                  <div className="px-3 py-2 border-b bg-secondary/50 text-sm font-semibold">{s.label}</div>
                  <div className="divide-y">
                    {s.criteriaKeys.map((k) => (
                      <div key={k} className="p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                        <div className="md:w-1/2 text-sm">{labelForCriterion(k)}</div>
                        <RadioGroup
                          value={criteria[k]}
                          onValueChange={(v) => setCriteria({ ...criteria, [k]: v as CriterionValue })}
                          className="flex flex-wrap gap-3"
                        >
                          {VALUES.map((v) => (
                            <label key={v.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                              <RadioGroupItem value={v.key} id={`${k}-${v.key}`} />
                              <span>{v.label}</span>
                            </label>
                          ))}
                        </RadioGroup>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1"><Label>נקודות לשימור</Label><Textarea rows={3} value={keep} onChange={(e) => setKeep(e.target.value)} /></div>
            <div className="space-y-1"><Label>נקודות לשיפור</Label><Textarea rows={3} value={improve} onChange={(e) => setImprove(e.target.value)} /></div>
            <div className="space-y-1"><Label>סיכום מנהל</Label><Textarea rows={3} value={managerSummary} onChange={(e) => setManagerSummary(e.target.value)} /></div>
            <div className="space-y-1"><Label>משימה להמשך</Label><Textarea rows={3} value={nextTask} onChange={(e) => setNextTask(e.target.value)} /></div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button onClick={submit}>{editing ? "עדכון משוב" : "שמירת האזנה"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Admin: bulk-publish existing feedback --------------------
/**
 * Historical feedback created before the draft/publish workflow existed defaults to
 * published=false for safety (a rep must never suddenly see feedback they weren't
 * meant to yet). This is the admin-only, filtered, confirmed, audited action to make
 * that history visible on purpose — never automatic.
 */
function AdminBulkPublishDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { state } = useApp();
  const { pushActivity } = useUx();
  const preview = useServerFn(previewUnpublishedFeedback);
  const bulkPublish = useServerFn(publishFeedbackBulk);
  const teamOptions = useMemo(() => teamsFromReps(state.reps), [state.reps]);

  const [teamId, setTeamId] = useState(BULK_PUBLISH_NONE);
  const [repId, setRepId] = useState(BULK_PUBLISH_NONE);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [step, setStep] = useState<"filter" | "confirm">("filter");
  const [publishing, setPublishing] = useState(false);

  const teamReps = teamId === BULK_PUBLISH_NONE ? state.reps : state.reps.filter((r) => r.teamId === teamId);
  const filters = toBulkPublishFilters({ teamId, repId, from, to });

  const reset = () => {
    setTeamId(BULK_PUBLISH_NONE); setRepId(BULK_PUBLISH_NONE); setFrom(""); setTo("");
    setCount(null); setStep("filter");
  };

  const close = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const runPreview = async () => {
    setLoadingPreview(true);
    try {
      const res = await preview({ data: filters });
      setCount(res.count);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingPreview(false);
    }
  };

  const confirmPublish = async () => {
    setPublishing(true);
    try {
      const res = await bulkPublish({ data: filters });
      if (res.updated > 0) pushActivity({ kind: "feedback", text: `פורסמו ${res.updated} רשומות משוב קיימות` });
      toast.success(`פורסמו ${res.updated} רשומות משוב ליעדים שנבחרו.`);
      close(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>פרסום משובים קיימים</DialogTitle></DialogHeader>

        {step === "filter" ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              משוב שנשמר כטיוטה אינו גלוי לנציג עד לפרסום מפורש. ניתן לפרסם משובים קיימים לפי סינון —
              הפעולה תשפיע רק על רשומות בטיוטה שתואמות את הסינון שנבחר.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>צוות</Label>
                <Select value={teamId} onValueChange={(v) => { setTeamId(v); setRepId(BULK_PUBLISH_NONE); setCount(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BULK_PUBLISH_NONE}>כל הצוותים</SelectItem>
                    {teamOptions.map((t) => <SelectItem key={t.teamId} value={t.teamId}>{t.teamName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>נציג</Label>
                <Select value={repId} onValueChange={(v) => { setRepId(v); setCount(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BULK_PUBLISH_NONE}>כל הנציגים{teamId !== BULK_PUBLISH_NONE ? " בצוות" : ""}</SelectItem>
                    {teamReps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>מתאריך</Label>
                <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setCount(null); }} />
              </div>
              <div className="space-y-1">
                <Label>עד תאריך</Label>
                <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setCount(null); }} />
              </div>
            </div>

            <Button variant="outline" onClick={runPreview} disabled={loadingPreview}>
              {loadingPreview ? "בודק..." : "בדיקת כמות רשומות"}
            </Button>

            {count !== null && (
              <div className="rounded-lg border p-3 bg-muted/30">
                {count === 0
                  ? "לא נמצאו משובים בטיוטה התואמים לסינון שנבחר."
                  : `${count} רשומות משוב בטיוטה יפורסמו ויהפכו גלויות לנציגים המתאימים.`}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => close(false)}>סגירה</Button>
              <Button disabled={!count} onClick={() => setStep("confirm")}>המשך לאישור</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p className="font-semibold">לאשר פרסום של {count} רשומות משוב?</p>
              <p className="text-muted-foreground mt-1">
                הרשומות התואמות לסינון שנבחר יהפכו גלויות לנציגים המתאימים. הפעולה תתועד ביומן הביקורת.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep("filter")} disabled={publishing}>חזרה</Button>
              <Button onClick={confirmPublish} disabled={publishing}>
                {publishing ? "מפרסם..." : "אישור פרסום"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Schedule dialog --------------------
function ScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { state } = useApp();
  const { addSchedule } = useListening();
  const [repId, setRepId] = useState<string>("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("10:00");
  const [topic, setTopic] = useState("האזנה שבועית");

  const submit = () => {
    if (!repId) return toast.error("יש לבחור נציג");
    addSchedule({ repId, date, time, topic });
    toast.success("ההאזנה נוספה ליומן");
    onOpenChange(false);
    setRepId("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>תזמון האזנה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>נציג</Label>
            <Select value={repId} onValueChange={setRepId}>
              <SelectTrigger><SelectValue placeholder="בחר נציג" /></SelectTrigger>
              <SelectContent>
                {state.reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {r.teamName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>תאריך</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>שעה</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>נושא</Label><Input value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={submit}>שמירה ליומן</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
