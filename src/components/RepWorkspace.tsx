import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { TEAM_LABEL, type Rep } from "@/lib/seed";
import { useRepWorkspace, type WorkspaceNote } from "@/lib/rep-workspace";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatNum, formatPct, formatDateIL, workdaysInMonth, workdaysPassed, workdaysRemaining } from "@/lib/format";
import { toast } from "sonner";
import {
  Headphones, Pencil, StickyNote, Trophy, BookOpen, ArrowUpRight, Plus,
  Trash2, CheckCircle2, Circle, Award, Flame, Star, Target, Calendar,
  TrendingUp, TrendingDown, Minus, User, LineChart as LineChartIcon,
  Clock, MessageSquare, Sparkles, X,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, CartesianGrid } from "recharts";

const MONTHS_HE = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

// ---------- deterministic demo helpers ----------
function hash(id: string) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return Math.abs(h); }
function pick<T>(id: string, salt: number, arr: T[]): T { return arr[(hash(id) + salt) % arr.length]; }

function monthlyHistory(rep: Rep, months = 6) {
  const seed = hash(rep.id);
  const now = new Date();
  const points: { month: string; value: number; target: number; pct: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const noise = ((seed >> (i * 3)) & 0x1f) / 31;
    const base = rep.monthlyTarget * (0.55 + noise * 0.75);
    const value = i === 0 ? rep.currentResult : Math.round(base);
    points.push({ month: MONTHS_HE[d.getMonth()], value, target: rep.monthlyTarget, pct: Math.round((value / rep.monthlyTarget) * 100) });
  }
  return points;
}

function trendPct(rep: Rep) {
  const h = monthlyHistory(rep);
  const prev = h[h.length - 2]?.value ?? 0;
  const cur = h[h.length - 1]?.value ?? 0;
  if (!prev) return 0;
  return ((cur - prev) / prev) * 100;
}

type Status = "above" | "onpace" | "attention";
function statusOf(rep: Rep): Status {
  const workdays = workdaysInMonth();
  const passed = Math.max(1, workdaysPassed());
  const expected = (rep.monthlyTarget / workdays) * passed;
  const paceDelta = rep.currentResult - expected;
  const pct = rep.monthlyTarget ? (rep.currentResult / rep.monthlyTarget) * 100 : 0;
  if (pct >= 100 || paceDelta >= rep.monthlyTarget * 0.05) return "above";
  if (paceDelta >= -rep.monthlyTarget * 0.05) return "onpace";
  return "attention";
}
const STATUS_LABEL: Record<Status, string> = { above: "מעל היעד", onpace: "בקצב", attention: "דורש טיפול" };

type RiskLevel = "low" | "medium" | "high";
function riskOf(rep: Rep): { level: RiskLevel; reasons: string[] } {
  const pct = rep.monthlyTarget ? (rep.currentResult / rep.monthlyTarget) * 100 : 0;
  const tp = trendPct(rep);
  let score = 0; const reasons: string[] = [];
  if (pct < 80) { score += 2; reasons.push("ביצוע מתחת ל-80%"); }
  else if (pct < 95) { score += 1; reasons.push("ביצוע מתחת לצפוי"); }
  if (tp <= -5) { score += 2; reasons.push("מגמת ירידה"); }
  else if (tp < 0) { score += 1; reasons.push("ירידה קלה"); }
  const h = hash(rep.id);
  if (h % 5 === 0) { score += 1; reasons.push("חסר משוב עדכני"); }
  if ((h >> 2) % 4 === 0) { score += 1; reasons.push("ללא האזנה השבוע"); }
  return { level: score >= 4 ? "high" : score >= 2 ? "medium" : "low", reasons };
}

const MANAGERS = ["דנה לוי", "יוסי כהן", "מיכל אברהם", "רון שני"];
function managerOf(rep: Rep) { return pick(rep.id, 2, MANAGERS); }

// Timeline demo
const TIMELINE_TEMPLATES: { kind: string; text: string; icon: "listen" | "target" | "goal" | "note" | "trophy" | "training" }[] = [
  { kind: "listen", text: "בוצעה האזנה", icon: "listen" },
  { kind: "target", text: "עודכן יעד חודשי", icon: "target" },
  { kind: "goal", text: "עבר את היעד השבועי", icon: "goal" },
  { kind: "note", text: "נוספה הערת מנהל", icon: "note" },
  { kind: "trophy", text: "זכה בתחרות פנימית", icon: "trophy" },
  { kind: "training", text: "הושלמה הדרכה", icon: "training" },
  { kind: "listen", text: "בוצעה האזנה עם ציון גבוה", icon: "listen" },
  { kind: "goal", text: "רצף של 3 ימים מעל היעד", icon: "goal" },
];
function timelineOf(rep: Rep) {
  const h = hash(rep.id);
  const items: { date: Date; text: string; icon: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const t = TIMELINE_TEMPLATES[(h + i * 3) % TIMELINE_TEMPLATES.length];
    const daysAgo = i * 2 + ((h >> i) % 2);
    items.push({ date: new Date(Date.now() - daysAgo * 86400000), text: t.text, icon: t.icon });
  }
  return items;
}

// Listening history
const LISTENERS = ["דנה לוי", "יוסי כהן", "מיכל אברהם", "רון שני"];
const CALL_SUMMARIES = [
  "פתיחה מצוינת, יש לחזק סגירה",
  "טיפול טוב בהתנגדות מחיר",
  "הוצע שדרוג בטבעיות",
  "חסר סיכום שיחה מסודר",
  "בירור צרכים יסודי מאוד",
];
function listeningHistoryOf(rep: Rep) {
  const h = hash(rep.id);
  const arr = [] as { id: string; date: Date; listener: string; score: number; summary: string; status: "reviewed" | "pending" }[];
  for (let i = 0; i < 5; i++) {
    const daysAgo = 3 + i * 6 + ((h >> i) % 4);
    arr.push({
      id: `l-${rep.id}-${i}`,
      date: new Date(Date.now() - daysAgo * 86400000),
      listener: LISTENERS[(h + i) % LISTENERS.length],
      score: 60 + ((h >> (i * 2)) % 40),
      summary: CALL_SUMMARIES[(h + i * 2) % CALL_SUMMARIES.length],
      status: i === 0 && ((h >> 4) % 3 === 0) ? "pending" : "reviewed",
    });
  }
  return arr;
}

// Achievements
function achievementsOf(rep: Rep) {
  const pct = rep.monthlyTarget ? (rep.currentResult / rep.monthlyTarget) * 100 : 0;
  const h = hash(rep.id);
  const all = [
    { id: "star", label: "מצטיין השבוע", icon: "🏆", earned: pct >= 100, desc: "עבר את היעד החודשי" },
    { id: "streak", label: "5 ימים מעל היעד", icon: "🔥", earned: h % 3 !== 0, desc: "רצף התמדה" },
    { id: "quality", label: "100% איכות", icon: "⭐", earned: (h >> 2) % 4 === 0, desc: "ציון מלא בהאזנה" },
    { id: "peak", label: "שיא חודשי", icon: "🎯", earned: pct >= 110, desc: "שבירת שיא אישי" },
    { id: "coach", label: "מוביל צוותי", icon: "🚀", earned: (h >> 3) % 5 === 0, desc: "השפעה חיובית על עמיתים" },
    { id: "learner", label: "מסיים הדרכות", icon: "📘", earned: (h >> 1) % 2 === 0, desc: "השלים 3 קורסים" },
  ];
  return all;
}

// Training
const COURSES = [
  { id: "c1", title: "טיפול בהתנגדות מחיר" },
  { id: "c2", title: "שדרוג כיסויים ברכב" },
  { id: "c3", title: "רגולציה בביטוח דירה" },
  { id: "c4", title: "פתיחת שיחה אפקטיבית" },
  { id: "c5", title: "מנורה ON - עדכונים" },
];
function trainingOf(rep: Rep) {
  const h = hash(rep.id);
  return COURSES.map((c, i) => {
    const progress = ((h >> i) % 5) * 25;
    return { ...c, progress: progress > 100 ? 100 : progress };
  });
}

// ---------- helpers ----------
function StatusBadge({ s }: { s: Status }) {
  const cls = s === "above"
    ? "bg-[color:var(--success)]/12 text-[color:var(--success)] border-[color:var(--success)]/25"
    : s === "onpace"
    ? "bg-[color:var(--warning)]/15 text-[color:oklch(0.45_0.14_75)] border-[color:var(--warning)]/30"
    : "bg-primary/10 text-primary border-primary/25";
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", cls)}>{STATUS_LABEL[s]}</span>;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const map = {
    low: { label: "🟢 סיכון נמוך", cls: "bg-[color:var(--success)]/12 text-[color:var(--success)] border-[color:var(--success)]/25" },
    medium: { label: "🟡 סיכון בינוני", cls: "bg-[color:var(--warning)]/15 text-[color:oklch(0.45_0.14_75)] border-[color:var(--warning)]/30" },
    high: { label: "🔴 סיכון גבוה", cls: "bg-primary/10 text-primary border-primary/25" },
  } as const;
  const m = map[level];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", m.cls)}>{m.label}</span>;
}

function CircularProgress({ pct, status }: { pct: number; status: Status }) {
  const size = 132, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct, 0), 100);
  const offset = c - (clamped / 100) * c;
  const color = status === "above" ? "var(--success)" : status === "onpace" ? "var(--warning)" : "var(--primary)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeLinecap="round" style={{ stroke: color, strokeDasharray: c, strokeDashoffset: offset, transition: "stroke-dashoffset 500ms ease" }} className="fill-none" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-2xl font-extrabold tabular-nums leading-none">{Math.round(pct)}%</div>
          <div className="text-[10px] text-muted-foreground mt-1">עמידה ביעד</div>
        </div>
      </div>
    </div>
  );
}

function TimelineIcon({ icon }: { icon: string }) {
  const map: Record<string, { i: React.ComponentType<{ className?: string }>; cls: string }> = {
    listen: { i: Headphones, cls: "bg-primary/10 text-primary" },
    target: { i: Target, cls: "bg-blue-500/10 text-blue-600" },
    goal: { i: TrendingUp, cls: "bg-[color:var(--success)]/15 text-[color:var(--success)]" },
    note: { i: StickyNote, cls: "bg-amber-500/10 text-amber-600" },
    trophy: { i: Trophy, cls: "bg-yellow-500/15 text-yellow-600" },
    training: { i: BookOpen, cls: "bg-purple-500/10 text-purple-600" },
  };
  const m = map[icon] ?? map.note;
  const I = m.i;
  return <span className={cn("grid h-8 w-8 place-items-center rounded-lg shrink-0", m.cls)}><I className="h-4 w-4" /></span>;
}

function TrendPill({ pct }: { pct: number }) {
  const rounded = Math.round(pct);
  if (Math.abs(rounded) < 1) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Minus className="h-3 w-3" />יציב</span>;
  if (rounded > 0) return <span className="inline-flex items-center gap-1 text-xs text-[color:var(--success)] font-medium"><TrendingUp className="h-3 w-3" />+{rounded}%</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-primary font-medium"><TrendingDown className="h-3 w-3" />{rounded}%</span>;
}

// ---------- main workspace ----------
export function RepWorkspace() {
  const { openRepId, close } = useRepWorkspace();
  const { state } = useApp();
  const rep = state.reps.find((r) => r.id === openRepId) ?? null;

  return (
    <Sheet open={!!rep} onOpenChange={(v) => !v && close()}>
      <SheetContent side="left" className="w-full sm:max-w-2xl p-0 overflow-hidden flex flex-col" dir="rtl">
        {rep ? <WorkspaceBody rep={rep} onClose={close} /> : <div />}
      </SheetContent>
    </Sheet>
  );
}

function WorkspaceBody({ rep, onClose }: { rep: Rep; onClose: () => void }) {
  const { getNotes, addNote, updateNote, deleteNote, getTasks, addTask, toggleTask, deleteTask } = useRepWorkspace();
  const status = statusOf(rep);
  const pct = rep.monthlyTarget ? (rep.currentResult / rep.monthlyTarget) * 100 : 0;
  const tp = trendPct(rep);
  const risk = riskOf(rep);
  const workdays = workdaysInMonth();
  const passed = Math.max(1, workdaysPassed());
  const remaining = workdaysRemaining();
  const perDay = Math.max(0, Math.ceil((rep.monthlyTarget - rep.currentResult) / Math.max(1, remaining)));
  const forecast = Math.round((rep.currentResult / passed) * workdays);
  const history6 = monthlyHistory(rep, 6);
  const history3 = history6.slice(-3);
  const timeline = timelineOf(rep);
  const listening = listeningHistoryOf(rep);
  const avgListen = Math.round(listening.reduce((s, l) => s + l.score, 0) / listening.length);
  const achievements = achievementsOf(rep);
  const training = trainingOf(rep);
  const notes = getNotes(rep.id);
  const tasks = getTasks(rep.id);
  const openTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);

  const [openListening, setOpenListening] = useState<null | typeof listening[number]>(null);
  const [editingNote, setEditingNote] = useState<WorkspaceNote | null>(null);
  const [noteText, setNoteText] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const summary = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${rep.name} נמצא/ת כעת על ${Math.round(pct)}% מהיעד החודשי`);
    if (tp >= 1) parts.push(`עם מגמת שיפור של ${Math.round(tp)}% לעומת החודש הקודם`);
    else if (tp <= -1) parts.push(`עם ירידה של ${Math.round(Math.abs(tp))}% לעומת החודש הקודם`);
    else parts.push("במגמה יציבה לעומת החודש הקודם");
    parts.push(`בוצעו ${listening.length} האזנות בציון ממוצע של ${avgListen}`);
    parts.push(openTasks.length ? `קיימות ${openTasks.length} משימות פתוחות` : "לא קיימות משימות פתוחות");
    return parts.join(". ") + ".";
  }, [rep.name, pct, tp, listening.length, avgListen, openTasks.length]);

  return (
    <>
      {/* Sticky header */}
      <SheetHeader className="p-5 pb-4 border-b bg-card">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary font-bold shrink-0 text-lg">
            {rep.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg text-start truncate">{rep.name}</SheetTitle>
            <SheetDescription className="text-start flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="outline" className="font-normal">{TEAM_LABEL[rep.team]}</Badge>
              <StatusBadge s={status} />
              <RiskBadge level={risk.level} />
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 space-y-6">
          {/* Section 1 - Summary */}
          <section className="rounded-2xl border bg-gradient-to-l from-muted/30 to-transparent p-5">
            <div className="flex items-center gap-5">
              <CircularProgress pct={pct} status={status} />
              <div className="min-w-0 flex-1 grid grid-cols-2 gap-3">
                <SummaryRow label="יעד חודשי" value={formatNum(rep.monthlyTarget)} />
                <SummaryRow label="ביצוע נוכחי" value={formatNum(rep.currentResult)} />
                <SummaryRow label="קצב יומי נדרש" value={`${formatNum(perDay)}/יום`} />
                <SummaryRow label="תחזית סוף חודש" value={formatNum(forecast)} tone={forecast >= rep.monthlyTarget ? "success" : "danger"} />
                <SummaryRow label="ראש צוות" value={managerOf(rep)} />
                <SummaryRow label="עודכן לאחרונה" value={formatDateIL(new Date())} />
              </div>
            </div>
          </section>

          {/* Section 3 - Analytics with tabs */}
          <Section icon={LineChartIcon} title="ניתוח ביצועים">
            <Tabs defaultValue="6m">
              <TabsList>
                <TabsTrigger value="current">חודש נוכחי</TabsTrigger>
                <TabsTrigger value="3m">3 חודשים</TabsTrigger>
                <TabsTrigger value="6m">6 חודשים</TabsTrigger>
              </TabsList>
              <TabsContent value="current" className="mt-3">
                <div className="grid grid-cols-3 gap-3">
                  <AnalyticStat label="יעד" value={formatNum(rep.monthlyTarget)} />
                  <AnalyticStat label="ביצוע" value={formatNum(rep.currentResult)} />
                  <AnalyticStat label="עמידה" value={formatPct(pct)} tone={status === "above" ? "success" : status === "attention" ? "danger" : "warning"} />
                </div>
                <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", status === "above" ? "bg-[color:var(--success)]" : status === "onpace" ? "bg-[color:var(--warning)]" : "bg-primary")} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <TrendPill pct={tp} />
                  <span>תחזית: {formatNum(forecast)}</span>
                </div>
              </TabsContent>
              <TabsContent value="3m" className="mt-3">
                <ChartAndSummary data={history3} avgPct={Math.round(history3.reduce((s, d) => s + d.pct, 0) / history3.length)} tp={tp} target={rep.monthlyTarget} />
              </TabsContent>
              <TabsContent value="6m" className="mt-3">
                <ChartAndSummary data={history6} avgPct={Math.round(history6.reduce((s, d) => s + d.pct, 0) / history6.length)} tp={tp} target={rep.monthlyTarget} />
              </TabsContent>
            </Tabs>
          </Section>

          {/* Section 2 - Timeline */}
          <Section icon={Clock} title="ציר זמן פעילות">
            <ol className="relative border-s ps-4 space-y-3">
              {timeline.map((t, i) => (
                <li key={i} className="flex items-start gap-3">
                  <TimelineIcon icon={t.icon} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t.text}</div>
                    <div className="text-[11px] text-muted-foreground">{formatDateIL(t.date)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          {/* Section 4 - Listening history */}
          <Section icon={Headphones} title="היסטוריית האזנות" right={<span className="text-xs text-muted-foreground">ממוצע: <span className="font-semibold text-foreground">{avgListen}</span></span>}>
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>תאריך</TableHead>
                    <TableHead>מאזין</TableHead>
                    <TableHead className="text-end">ציון</TableHead>
                    <TableHead>תקציר</TableHead>
                    <TableHead>סטטוס</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listening.map((l) => (
                    <TableRow key={l.id} onClick={() => setOpenListening(l)} className="cursor-pointer">
                      <TableCell className="text-xs tabular-nums whitespace-nowrap">{formatDateIL(l.date)}</TableCell>
                      <TableCell className="text-xs">{l.listener}</TableCell>
                      <TableCell className="text-end">
                        <span className={cn("font-bold tabular-nums", l.score >= 85 ? "text-[color:var(--success)]" : l.score >= 70 ? "text-foreground" : "text-primary")}>{l.score}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{l.summary}</TableCell>
                      <TableCell>
                        {l.status === "pending"
                          ? <Badge variant="outline" className="text-[10px]">ממתין לסקירה</Badge>
                          : <Badge className="text-[10px] bg-[color:var(--success)]/15 text-[color:var(--success)] hover:bg-[color:var(--success)]/15 border-transparent">נסקר</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>

          {/* Section 5 - Manager notes */}
          <Section icon={StickyNote} title="הערות מנהל" right={
            <Button size="sm" variant="outline" onClick={() => { setEditingNote(null); setNoteText(""); }}>
              <Plus className="ms-1 h-4 w-4" />הוסף הערה
            </Button>
          }>
            <div className="space-y-2">
              <div className="rounded-xl border p-3">
                <Label className="text-xs">{editingNote ? "עריכת הערה" : "הערה חדשה"}</Label>
                <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="הערה פרטית לתיק הנציג..." className="mt-2 min-h-20" />
                <div className="mt-2 flex justify-end gap-2">
                  {editingNote && (
                    <Button variant="ghost" size="sm" onClick={() => { setEditingNote(null); setNoteText(""); }}>ביטול</Button>
                  )}
                  <Button size="sm" onClick={() => {
                    if (!noteText.trim()) return toast.error("יש להזין טקסט");
                    if (editingNote) { updateNote(rep.id, editingNote.id, noteText.trim()); toast.success("ההערה עודכנה"); }
                    else { addNote(rep.id, noteText.trim()); toast.success("ההערה נוספה"); }
                    setEditingNote(null); setNoteText("");
                  }}>{editingNote ? "שמירה" : "הוספה"}</Button>
                </div>
              </div>
              {notes.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">אין הערות עדיין - הוסף את הראשונה למעלה.</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                      <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{n.author} · {formatDateIL(n.date)}</span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingNote(n); setNoteText(n.text); }}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { deleteNote(rep.id, n.id); toast.success("ההערה נמחקה"); }}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed">{n.text}</p>
                  </div>
                ))
              )}
            </div>
          </Section>

          {/* Section 6 - Tasks */}
          <Section icon={CheckCircle2} title="משימות" right={
            <Button size="sm" variant="outline" onClick={() => setNewTaskOpen(true)}>
              <Plus className="ms-1 h-4 w-4" />הוסף משימה
            </Button>
          }>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1.5">פתוחות ({openTasks.length})</div>
                {openTasks.length === 0
                  ? <p className="text-xs text-muted-foreground text-center py-3 rounded-lg border border-dashed">אין משימות פתוחות</p>
                  : <ul className="space-y-1.5">{openTasks.map((t) => (
                      <TaskRow key={t.id} task={t} onToggle={() => toggleTask(rep.id, t.id)} onDelete={() => { deleteTask(rep.id, t.id); toast.success("המשימה נמחקה"); }} />
                    ))}</ul>}
              </div>
              {doneTasks.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1.5">הושלמו ({doneTasks.length})</div>
                  <ul className="space-y-1.5">{doneTasks.map((t) => (
                    <TaskRow key={t.id} task={t} onToggle={() => toggleTask(rep.id, t.id)} onDelete={() => deleteTask(rep.id, t.id)} />
                  ))}</ul>
                </div>
              )}
            </div>
          </Section>

          {/* Section 7 - Achievements */}
          <Section icon={Award} title="הישגים">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {achievements.map((a) => (
                <div key={a.id} className={cn(
                  "rounded-xl border p-3 text-center transition-all",
                  a.earned ? "bg-gradient-to-b from-primary/5 to-transparent" : "opacity-40 grayscale"
                )}>
                  <div className="text-2xl leading-none">{a.icon}</div>
                  <div className="mt-1.5 text-xs font-semibold">{a.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{a.desc}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* Section 8 - Training */}
          <Section icon={BookOpen} title="הדרכות ומאמרים">
            <div className="space-y-2">
              {training.map((c) => (
                <div key={c.id} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium truncate">{c.title}</div>
                    <span className={cn("text-xs font-semibold tabular-nums shrink-0", c.progress === 100 ? "text-[color:var(--success)]" : c.progress === 0 ? "text-muted-foreground" : "text-primary")}>
                      {c.progress === 100 ? "הושלם" : c.progress === 0 ? "טרם התחיל" : `${c.progress}%`}
                    </span>
                  </div>
                  <Progress value={c.progress} className="mt-2 h-1.5" />
                </div>
              ))}
            </div>
          </Section>

          {/* Section 10 - Manager Summary */}
          <Section icon={Sparkles} title="סיכום ניהולי אוטומטי">
            <p className="rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed">{summary}</p>
            {risk.reasons.length > 0 && (
              <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
                {risk.reasons.map((r, i) => <li key={i}>• {r}</li>)}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {/* Sticky Quick Actions */}
      <div className="border-t bg-card/95 backdrop-blur p-3 shrink-0">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <QuickAction icon={Plus} label="האזנה" onClick={() => toast.success(`נפתח טופס האזנה עבור ${rep.name}`)} />
          <QuickAction icon={Pencil} label="ערוך יעד" onClick={() => toast.success(`עריכת יעד עבור ${rep.name}`)} />
          <QuickAction icon={StickyNote} label="הוסף הערה" onClick={() => { const el = document.querySelector<HTMLTextAreaElement>('textarea'); el?.focus(); }} />
          <QuickAction icon={Trophy} label="תחרות" onClick={() => toast.success("הוספת נקודות לתחרות")} />
          <QuickAction icon={BookOpen} label="שיוך מאמר" onClick={() => toast.success("שיוך מאמר לנציג")} />
          <QuickAction icon={ArrowUpRight} label="ביצועים" onClick={() => toast.success("פתיחת דוח ביצועים מלא")} />
        </div>
      </div>

      {/* Listening details dialog */}
      <Dialog open={!!openListening} onOpenChange={(v) => !v && setOpenListening(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>פירוט האזנה</DialogTitle>
          </DialogHeader>
          {openListening && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">תאריך</span>
                <span className="font-medium">{formatDateIL(openListening.date)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">מאזין</span>
                <span className="font-medium">{openListening.listener}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ציון כולל</span>
                <span className="font-bold text-lg tabular-nums">{openListening.score}</span>
              </div>
              <Separator />
              <div>
                <div className="text-muted-foreground text-xs mb-1">תקציר</div>
                <p>{openListening.summary}</p>
              </div>
              <div className="rounded-lg border p-3 bg-muted/30 text-xs text-muted-foreground">
                לפתיחת ההערכה המלאה עברו לעמוד "האזנות ומשוב".
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <NewTaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} onSave={(t) => { addTask(rep.id, t); toast.success("המשימה נוספה"); }} />
    </>
  );
}

// ---------- small pieces ----------
function Section({ icon: Icon, title, right, children }: { icon: React.ComponentType<{ className?: string }>; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />{title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold tabular-nums truncate", tone === "success" && "text-[color:var(--success)]", tone === "danger" && "text-primary")}>{value}</div>
    </div>
  );
}

function AnalyticStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="rounded-xl border p-3 text-center">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-base font-extrabold tabular-nums",
        tone === "success" && "text-[color:var(--success)]",
        tone === "warning" && "text-[color:oklch(0.45_0.14_75)]",
        tone === "danger" && "text-primary")}>{value}</div>
    </div>
  );
}

function ChartAndSummary({ data, avgPct, tp, target }: { data: ReturnType<typeof monthlyHistory>; avgPct: number; tp: number; target: number }) {
  return (
    <div className="space-y-3">
      <div className="h-44 rounded-xl border p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
            <XAxis dataKey="month" reversed tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={10} tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [formatNum(v), "ביצוע"]} labelFormatter={(l) => `חודש ${l}`} />
            <ReferenceLine y={target} stroke="var(--muted-foreground)" strokeDasharray="4 4" opacity={0.6} />
            <Bar dataKey="value" fill="var(--primary)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <AnalyticStat label="יעד ממוצע" value={formatNum(target)} />
        <AnalyticStat label="ביצוע ממוצע" value={formatNum(Math.round(data.reduce((s, d) => s + d.value, 0) / data.length))} />
        <AnalyticStat label="עמידה ממוצעת" value={`${avgPct}%`} tone={avgPct >= 100 ? "success" : avgPct >= 90 ? "warning" : "danger"} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <TrendPill pct={tp} />
        <span className="text-muted-foreground">מגמה חודש אחרון</span>
      </div>
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete }: { task: { id: string; title: string; due: string; priority: "low" | "medium" | "high"; done: boolean }; onToggle: () => void; onDelete: () => void }) {
  const priorityCls = task.priority === "high" ? "text-primary" : task.priority === "medium" ? "text-[color:oklch(0.45_0.14_75)]" : "text-muted-foreground";
  const priorityLabel = { low: "נמוכה", medium: "בינונית", high: "גבוהה" }[task.priority];
  return (
    <li className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", task.done && "opacity-60")}>
      <Checkbox checked={task.done} onCheckedChange={onToggle} />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm truncate", task.done && "line-through")}>{task.title}</div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{task.due ? formatDateIL(task.due) : "ללא תאריך"}</span>
          <span className={priorityCls}>· עדיפות {priorityLabel}</span>
        </div>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
    </li>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} className="flex flex-col h-auto py-2 gap-1">
      <Icon className="h-4 w-4" />
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </Button>
  );
}

function NewTaskDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (t: { title: string; due: string; priority: "low" | "medium" | "high" }) => void }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const submit = () => {
    if (!title.trim()) return toast.error("יש להזין כותרת משימה");
    onSave({ title: title.trim(), due, priority });
    setTitle(""); setPriority("medium"); onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>משימה חדשה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>כותרת</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: תרגול תסריט שדרוג" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>תאריך יעד</Label><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>עדיפות</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as "low" | "medium" | "high")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">גבוהה</SelectItem>
                  <SelectItem value="medium">בינונית</SelectItem>
                  <SelectItem value="low">נמוכה</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={submit}>הוספה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Reusable rep name link
export function RepNameLink({ repId, children, className }: { repId: string; children: React.ReactNode; className?: string }) {
  const { open } = useRepWorkspace();
  return (
    <button type="button" onClick={() => open(repId)} className={cn("story-link font-medium text-start", className)}>
      {children}
    </button>
  );
}
