import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
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
import { useApp, teamSummary } from "@/lib/store";
import { useMorning, type UnderwritingIssue, type UnderwritingPriority, type UnderwritingStatus, type ManagerCall } from "@/lib/morning-store";
import { formatDateIL, formatNum, formatPct, workdaysInMonth, workdaysPassed, workdaysRemaining } from "@/lib/format";
import { TEAM_LABEL, type Rep } from "@/lib/seed";
import { useRepWorkspace } from "@/lib/rep-workspace";

const CHECKLIST = [
  "בדיקת רענון נתונים",
  "בדיקת אחוז חידוש",
  "בדיקת נציגים מתחת לקצב",
  "תכנון האזנות",
  "מעבר על שיחות מנהל",
  "מעבר על נושאי חיתום",
  "שליחת עדכון בוקר",
];

export function MorningRoutine() {
  const { state } = useApp();
  const { reps, feedback } = state;
  const morning = useMorning();

  const wdPassed = Math.max(1, workdaysPassed());
  const wdTotal = workdaysInMonth();
  const wdRemaining = workdaysRemaining();

  const totalTarget = reps.reduce((a, r) => a + r.monthlyTarget, 0);
  const totalResult = reps.reduce((a, r) => a + r.currentResult, 0);
  const renewalPct = totalTarget > 0 ? (totalResult / totalTarget) * 100 : 0;
  const carSum = teamSummary(reps, "car");
  const homeSum = teamSummary(reps, "home");

  const repsWithData = reps.filter((r) => r.currentResult > 0 || r.lastUpdatedAt);
  const repsMissingData = reps.filter((r) => !(r.currentResult > 0 || r.lastUpdatedAt));
  const completeness = reps.length > 0 ? (repsWithData.length / reps.length) * 100 : 0;

  const underPace = useMemo(() => reps.filter((r) => {
    const expected = (r.monthlyTarget * wdPassed) / wdTotal;
    return r.currentResult < expected * 0.9;
  }), [reps, wdPassed, wdTotal]);

  const feedbackRepIds = new Set(feedback.map((f) => f.repId));
  const noRecentListening = reps.filter((r) => {
    const last = feedback.filter((f) => f.repId === r.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (!last) return true;
    const days = (Date.now() - new Date(last.date).getTime()) / 86400000;
    return days > 7;
  });
  const noFeedback = reps.filter((r) => !feedbackRepIds.has(r.id));

  const openCalls = morning.managerCalls.filter((c) => c.status !== "completed");
  const openUnderwriting = morning.underwriting.filter((u) => u.status !== "הושלם");

  const change = renewalPct - morning.yesterdayRenewalPct;

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
        {/* Row 1: Data status + Renewal KPI */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DataStatusCard completeness={completeness} withCount={repsWithData.length} missingCount={repsMissingData.length} />
          <RenewalCard renewalPct={renewalPct} change={change} carPct={carSum.pct} homePct={homeSum.pct} />
        </div>

        {/* Row 2: Quality check + Priorities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <QualityCheckCard reps={reps} repsMissingData={repsMissingData} />
          <PrioritiesCard
            underPace={underPace.length}
            noListening={noRecentListening.length}
            noFeedback={noFeedback.length}
            openCalls={openCalls.length}
            openUnderwriting={openUnderwriting.length}
            staleData={morning.refreshStatus !== "complete" ? 1 : 0}
          />
        </div>

        {/* Row 3: Listening + Manager calls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ListeningCard reps={reps} feedback={feedback} noRecentListening={noRecentListening} />
          <ManagerCallsCard reps={reps} />
        </div>

        {/* Row 4: Underwriting (full width) */}
        <UnderwritingCard reps={reps} />

        {/* Row 5: Update generator + Checklist */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <MorningUpdateCard
              renewalPct={renewalPct}
              carSum={carSum}
              homeSum={homeSum}
              reps={reps}
              wdRemaining={wdRemaining}
              totalTarget={totalTarget}
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
function DataStatusCard({ completeness, withCount, missingCount }: { completeness: number; withCount: number; missingCount: number }) {
  const m = useMorning();
  const tone = m.refreshStatus === "complete" ? "success" : m.refreshStatus === "partial" ? "warning" : "danger";
  const toneClass =
    tone === "success" ? "bg-[color:var(--success)]/10 text-[color:var(--success)] border-[color:var(--success)]/30" :
    tone === "warning" ? "bg-[color:var(--warning)]/10 text-[color:var(--warning)] border-[color:var(--warning)]/30" :
    "bg-primary/10 text-primary border-primary/30";
  const label = m.refreshStatus === "complete" ? "הושלם" : m.refreshStatus === "partial" ? "חלקי" : "נכשל";
  const dotClass =
    tone === "success" ? "bg-[color:var(--success)]" :
    tone === "warning" ? "bg-[color:var(--warning)]" : "bg-primary";

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
        <Stat label="רענון אחרון" value={m.lastRefreshAt ? new Date(m.lastRefreshAt).toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—"} />
        <Stat label="עדכני עד" value={formatDateIL(m.dataAsOf)} />
        <Stat label="נציגים עם נתונים" value={`${withCount}`} tone="success" />
        <Stat label="חסרים נתונים" value={`${missingCount}`} tone={missingCount > 0 ? "danger" : undefined} />
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>שלמות הנתונים</span>
          <span>{formatPct(completeness)}</span>
        </div>
        <Progress value={completeness} className="h-2" />
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          onClick={() => { m.simulateRefresh("complete"); toast.success("נתונים רועננו בהצלחה"); }}
        >
          <RefreshCw className="ms-1 h-4 w-4" />רענון נתונים
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/data-import">ייבוא ידני<ArrowLeft className="me-1 h-4 w-4" /></Link>
        </Button>
      </div>
    </div>
  );
}

/* ============ Quality Check ============ */
function QualityCheckCard({ reps, repsMissingData }: { reps: Rep[]; repsMissingData: Rep[] }) {
  const { open } = useRepWorkspace();
  const noTarget = reps.filter((r) => !r.monthlyTarget || r.monthlyTarget <= 0);
  const nameCounts = reps.reduce<Record<string, number>>((acc, r) => { acc[r.name] = (acc[r.name] ?? 0) + 1; return acc; }, {});
  const duplicates = reps.filter((r) => nameCounts[r.name] > 1);
  const unknownTeam = reps.filter((r) => r.team !== "car" && r.team !== "home");
  const stale = reps.filter((r) => r.lastUpdatedAt && (Date.now() - new Date(r.lastUpdatedAt).getTime()) / 86400000 > 1);
  const bigDrops: Rep[] = []; // no daily history; keep hook ready

  const warnings: { icon: typeof AlertTriangle; text: string; onClick?: () => void; href?: string }[] = [
    ...repsMissingData.map((r) => ({ icon: AlertTriangle, text: `נציג ללא ביצוע: ${r.name}`, onClick: () => open(r.id) })),
    ...noTarget.map((r) => ({ icon: AlertTriangle, text: `נציג ללא יעד: ${r.name}`, onClick: () => open(r.id) })),
    ...stale.map((r) => ({ icon: Clock, text: `נתונים לא עודכנו מאתמול: ${r.name}`, onClick: () => open(r.id) })),
    ...duplicates.map((r) => ({ icon: AlertTriangle, text: `כפילות בשם: ${r.name}`, href: "/admin" as const })),
    ...unknownTeam.map((r) => ({ icon: AlertTriangle, text: `צוות לא מזוהה: ${r.name}`, onClick: () => open(r.id) })),
    ...bigDrops.map((r) => ({ icon: TrendingDown, text: `ירידה חריגה: ${r.name}`, onClick: () => open(r.id) })),
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
            return (
              <li key={i}>
                {w.href ? <Link to={w.href}>{content}</Link> : <button type="button" onClick={w.onClick} className="w-full text-start">{content}</button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ============ Renewal KPI ============ */
function RenewalCard({ renewalPct, change, carPct, homePct }: { renewalPct: number; change: number; carPct: number; homePct: number }) {
  const m = useMorning();
  const up = change >= 0;
  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Percent className="h-4 w-4 text-primary" />
          <div className="font-semibold">אחוז חידוש</div>
        </div>
        <Badge variant="outline" className={cn("gap-1", up ? "text-[color:var(--success)]" : "text-primary")}>
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {up ? "+" : ""}{change.toFixed(1)}%
        </Badge>
      </div>
      <div className="mt-2 text-4xl font-extrabold tracking-tight">{formatPct(renewalPct)}</div>
      <div className="text-xs text-muted-foreground">מול {formatPct(m.yesterdayRenewalPct)} אתמול · ממוצע חודשי {formatPct(m.monthlyAvgRenewalPct)}</div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniStat label="חידושי רכב" value={formatPct(carPct)} />
        <MiniStat label="חידושי דירה" value={formatPct(homePct)} />
      </div>
    </div>
  );
}

/* ============ Priorities ============ */
function PrioritiesCard({ underPace, noListening, noFeedback, openCalls, openUnderwriting, staleData }: {
  underPace: number; noListening: number; noFeedback: number; openCalls: number; openUnderwriting: number; staleData: number;
}) {
  const items = [
    { label: "נציגים מתחת לקצב", count: underPace, href: "/performance", urgency: underPace * 3 },
    { label: "האזנות חסרות השבוע", count: noListening, href: "/feedback", urgency: noListening * 2 },
    { label: "נושאי חיתום פתוחים", count: openUnderwriting, href: "#underwriting", urgency: openUnderwriting * 2 },
    { label: "שיחות מנהל פתוחות", count: openCalls, href: "#calls", urgency: openCalls * 2 },
    { label: "נציגים ללא משוב", count: noFeedback, href: "/feedback", urgency: noFeedback },
    { label: "נתונים חסרים / לא מעודכנים", count: staleData, href: "/data-import", urgency: staleData * 5 },
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
          {items.map((it, idx) => (
            <li key={it.label}>
              <Link
                to={it.href.startsWith("#") ? "/" : it.href}
                hash={it.href.startsWith("#") ? it.href.slice(1) : undefined}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors hover:bg-accent/40",
                  idx === 0 && "border-primary/40 bg-primary/5"
                )}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className={cn("grid h-6 w-6 place-items-center rounded-md text-xs font-bold", idx === 0 ? "bg-primary text-primary-foreground" : "bg-accent text-primary")}>{idx + 1}</span>
                  <span className="font-medium">{it.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{it.count}</Badge>
                  <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============ Listening ============ */
function ListeningCard({ reps, feedback, noRecentListening }: { reps: Rep[]; feedback: { repId: string; score: number; date: string }[]; noRecentListening: Rep[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const completedToday = feedback.filter((f) => f.date.slice(0, 10) === today).length;
  const planned = 5;
  const remaining = Math.max(0, planned - completedToday);
  const avg = feedback.length > 0 ? feedback.reduce((a, f) => a + f.score, 0) / feedback.length : 0;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosen, setChosen] = useState<string>("");

  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold">
          <Headphones className="h-4 w-4 text-primary" />
          האזנות להיום
        </div>
        <Badge variant="outline">{completedToday}/{planned}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="מתוכננות" value={String(planned)} />
        <MiniStat label="הושלמו היום" value={String(completedToday)} />
        <MiniStat label="נותרו" value={String(remaining)} tone={remaining > 0 ? "warning" : "success"} />
        <MiniStat label="ציון ממוצע" value={Math.round(avg).toString()} />
      </div>
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
                {reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {TEAM_LABEL[r.team]}</SelectItem>)}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button asChild disabled={!chosen}>
                <Link to="/feedback" onClick={() => setPickerOpen(false)}>המשך להאזנה</Link>
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
    completed: { label: "הושלם", cls: "bg-[color:var(--success)]/10 text-[color:var(--success)]" },
  } as const;
  const m = map[status];
  return <Badge variant="secondary" className={m.cls}>{m.label}</Badge>;
}

function AddCallDialog({ open, onOpenChange, reps }: { open: boolean; onOpenChange: (o: boolean) => void; reps: Rep[] }) {
  const m = useMorning();
  const [repId, setRepId] = useState("");
  const [subject, setSubject] = useState("");
  const [when, setWhen] = useState(() => new Date(Date.now() + 3600e3).toISOString().slice(0, 16));
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
          <Button onClick={() => {
            if (!subject) return;
            m.addManagerCall({ repId, subject, scheduledAt: new Date(when).toISOString() });
            toast.success("שיחה נוספה");
            setSubject(""); setRepId("");
            onOpenChange(false);
          }}>הוסף</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CallSummaryDialog({ call, onClose }: { call: ManagerCall | null; onClose: () => void }) {
  const m = useMorning();
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
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
          <Button onClick={() => {
            if (!call) return;
            m.updateManagerCall(call.id, { status: "completed", summary, followUpAt: followUp ? new Date(followUp).toISOString() : undefined });
            if (followUp) {
              m.addManagerCall({ repId: call.repId, subject: `מעקב: ${call.subject}`, scheduledAt: new Date(followUp).toISOString() });
            }
            toast.success("השיחה סומנה כהושלמה");
            setSummary(""); setFollowUp("");
            onClose();
          }}>שמור</Button>
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
  const priorityCls = u.priority === "high" ? "bg-primary/10 text-primary" : u.priority === "medium" ? "bg-[color:var(--warning)]/10 text-[color:var(--warning)]" : "bg-accent text-foreground";
  const priorityLabel = UW_PRIORITIES.find((p) => p.value === u.priority)?.label;
  return { rep, priorityCls, priorityLabel };
}

function UwCard({ u, reps }: { u: UnderwritingIssue; reps: Rep[] }) {
  const m = useMorning();
  const { rep, priorityCls, priorityLabel } = useUwMeta(u, reps);
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
        <Select value={u.status} onValueChange={(v) => m.updateUnderwriting(u.id, { status: v as UnderwritingStatus })}>
          <SelectTrigger className="flex-1 text-sm" aria-label={`סטטוס עבור ${u.subject}`}><SelectValue /></SelectTrigger>
          <SelectContent>{UW_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="ghost" onClick={() => { m.removeUnderwriting(u.id); toast.success("נמחק"); }}>מחק</Button>
      </div>
    </div>
  );
}

function UwRow({ u, reps }: { u: UnderwritingIssue; reps: Rep[] }) {
  const m = useMorning();
  const { rep, priorityCls, priorityLabel } = useUwMeta(u, reps);
  return (
    <tr className="border-t">
      <td className="p-2">{rep?.name ?? "—"}</td>
      <td className="p-2">{u.subject}</td>
      <td className="p-2"><Badge variant="secondary" className={priorityCls}>{priorityLabel}</Badge></td>
      <td className="p-2 text-xs text-muted-foreground">{formatDateIL(u.openedAt)}</td>
      <td className="p-2">
        <Select value={u.status} onValueChange={(v) => m.updateUnderwriting(u.id, { status: v as UnderwritingStatus })}>
          <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={`סטטוס עבור ${u.subject}`}><SelectValue /></SelectTrigger>
          <SelectContent>{UW_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="p-2 text-xs">{u.owner}</td>
      <td className="p-2 text-xs text-muted-foreground">{formatDateIL(u.dueAt)}</td>
      <td className="p-2 text-end">
        <Button size="sm" variant="ghost" onClick={() => { m.removeUnderwriting(u.id); toast.success("נמחק"); }}>מחק</Button>
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
            m.addUnderwriting({ repId, subject, priority, owner, status: "חדש", dueAt });
            toast.success("נושא חיתום נוסף");
            setSubject(""); setRepId("");
            onOpenChange(false);
          }}>הוסף</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ Morning Update Generator ============ */
function MorningUpdateCard({ renewalPct, carSum, homeSum, reps, wdRemaining, totalTarget, totalResult }: {
  renewalPct: number; carSum: ReturnType<typeof teamSummary>; homeSum: ReturnType<typeof teamSummary>;
  reps: Rep[]; wdRemaining: number; totalTarget: number; totalResult: number;
}) {
  const m = useMorning();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);

  const generate = () => {
    const withPct = reps.map((r) => ({ ...r, pct: r.monthlyTarget ? (r.currentResult / r.monthlyTarget) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);
    const leaders = withPct.slice(0, 3).map((r) => `${r.name} (${formatPct(r.pct)})`).join(", ");
    const focus = withPct.slice(-2).reverse().map((r) => r.name).join(", ");
    const remaining = Math.max(0, totalTarget - totalResult);
    const perDay = wdRemaining > 0 ? Math.ceil(remaining / wdRemaining) : 0;

    const msg =
`בוקר טוב לצוות ☀️
עדכון בוקר ${formatDateIL(new Date())}

📊 אחוז חידוש כללי: ${formatPct(renewalPct)}
🚗 חידושי רכב: ${formatPct(carSum.pct)} (${formatNum(carSum.result)}/${formatNum(carSum.target)})
🏠 חידושי דירה: ${formatPct(homeSum.pct)} (${formatNum(homeSum.result)}/${formatNum(homeSum.target)})

⭐ מובילים: ${leaders}
🎯 פוקוס להיום: ${focus}

💪 יעד להיום: ${formatNum(perDay)} חידושים לנציג בממוצע
בואו נצא לדרך - יום מצוין ומוצלח!`;
    setText(msg);
    setEditing(false);
  };

  const copy = async () => {
    if (!text) generate();
    const t = text || "";
    try { await navigator.clipboard.writeText(t); toast.success("הועתק ל-WhatsApp"); }
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
        <Button size="sm" variant="ghost" onClick={() => { if (text) { m.saveTemplate(text); toast.success("נשמר כתבנית"); } }} disabled={!text}>
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
  const done = CHECKLIST.filter((t) => m.isChecked(t)).length;
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
                <Checkbox checked={checked} onCheckedChange={() => m.toggleChecklist(t)} aria-label={t} />
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
  const color = tone === "success" ? "text-[color:var(--success)]" : tone === "danger" ? "text-primary" : tone === "warning" ? "text-[color:var(--warning)]" : "text-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-semibold", color)}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" | "warning" }) {
  const color = tone === "success" ? "text-[color:var(--success)]" : tone === "danger" ? "text-primary" : tone === "warning" ? "text-[color:var(--warning)]" : "text-foreground";
  return (
    <div className="rounded-lg border p-2 text-center bg-card">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-extrabold", color)}>{value}</div>
    </div>
  );
}
