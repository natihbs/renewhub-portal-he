import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import type { Rep } from "@/lib/seed";
import { type Feedback, scoreTone, SCORE_TEXT_CLASS } from "@/lib/feedback-domain";
import { useRepWorkspace, type WorkspaceNote } from "@/lib/rep-workspace";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatNum, formatPct, formatDateIL, workdaysInMonth, workdaysPassed, workdaysRemaining } from "@/lib/format";
import { calculateAchievement, paceStatus, paceInfo as sharedPaceInfo, computeRisk as sharedComputeRisk, DEFAULT_KPI_PROFILE, KPI_PROFILE_LABEL } from "@/lib/performance-domain";
import { useVisibleTeams } from "@/lib/teams-hooks";
import { useRepresentativeGoal, currentGoalMonth } from "@/lib/goals-hooks";
import { renewalTotalsForMonth } from "@/lib/kpi-values";
import { calculateRenewalRate, RENEWAL_RATE_UNAVAILABLE_LABEL, renewalRateTone } from "@/lib/renewal-rate";
import { toast } from "sonner";
import {
  Headphones, Pencil, StickyNote, Plus,
  Trash2, CheckCircle2, Calendar, User, LineChart as LineChartIcon,
  Sparkles, ChevronRight,
} from "lucide-react";

function daysSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ---------- status / risk (derived entirely from real cloud data) ----------
// "no_target" is an honest, distinct state — a rep with no official personal
// target for the current month (representative_goals) never gets a
// fabricated pace/status derived from the legacy rep.monthlyTarget column
// (§11/§19). target is now an explicit parameter, not read off the rep.
type Status = "above" | "onpace" | "attention" | "no_target";
export function statusOf(rep: Rep, target: number | null): Status {
  if (target === null) return "no_target";
  return paceStatus(rep.currentResult, target, workdaysInMonth(), workdaysPassed());
}
const STATUS_LABEL: Record<Status, string> = { above: "מעל היעד", onpace: "בקצב", attention: "דורש טיפול", no_target: "לא הוגדר יעד" };

type RiskLevel = "low" | "medium" | "high";
/**
 * Every reason here comes from real target/result pace and real feedback records for
 * this rep — no random/fabricated signal (this used to be seeded from a hash of the
 * rep's id, which meant the same rep could be flagged or cleared for reasons that had
 * nothing to do with their actual data). target is explicit; when null (no official
 * target set) pct is passed as a neutral 100 so the pct-based risk reasons never fire
 * for a rep we simply can't measure yet — that's surfaced separately as "no_target".
 *
 * Thin wrapper kept for its existing call sites/tests — thresholds live in the shared
 * performance-domain module (also used by performance.tsx's computeRisk).
 */
export function riskOf(rep: Rep, target: number | null, avgScore: number | null, daysSinceLastFeedback: number | null): { level: RiskLevel; reasons: string[] } {
  const pct = target === null ? 100 : calculateAchievement(rep.currentResult, target);
  return sharedComputeRisk(pct, avgScore, daysSinceLastFeedback);
}

// ---------- helpers ----------
function StatusBadge({ s }: { s: Status }) {
  const cls = s === "above"
    ? "bg-[color:var(--success)]/12 text-success-foreground border-[color:var(--success)]/25"
    : s === "onpace"
    ? "bg-[color:var(--warning)]/15 text-warning-foreground border-[color:var(--warning)]/30"
    : s === "no_target"
    ? "bg-muted text-muted-foreground border-border"
    : "bg-primary/10 text-primary border-primary/25";
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", cls)}>{STATUS_LABEL[s]}</span>;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const map = {
    low: { label: "🟢 סיכון נמוך", cls: "bg-[color:var(--success)]/12 text-success-foreground border-[color:var(--success)]/25" },
    medium: { label: "🟡 סיכון בינוני", cls: "bg-[color:var(--warning)]/15 text-warning-foreground border-[color:var(--warning)]/30" },
    high: { label: "🔴 סיכון גבוה", cls: "bg-primary/10 text-primary border-primary/25" },
  } as const;
  const m = map[level];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", m.cls)}>{m.label}</span>;
}

function CircularProgress({ pct, status }: { pct: number | null; status: Status }) {
  const size = 132, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct ?? 0, 0), 100);
  const offset = c - (clamped / 100) * c;
  const color = status === "above" ? "var(--success)" : status === "onpace" ? "var(--warning)" : status === "no_target" ? "var(--muted-foreground)" : "var(--primary)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-muted" />
        {pct !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeLinecap="round" style={{ stroke: color, strokeDasharray: c, strokeDashoffset: offset, transition: "stroke-dashoffset 500ms ease" }} className="fill-none" />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          {pct === null ? (
            <div className="text-xs font-semibold text-muted-foreground px-3">לא הוגדר יעד</div>
          ) : (
            <div className="text-2xl font-extrabold tabular-nums leading-none">{Math.round(pct)}%</div>
          )}
          <div className="text-[10px] text-muted-foreground mt-1">עמידה ביעד</div>
        </div>
      </div>
    </div>
  );
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
  const { state } = useApp();
  const { getNotes, addNote, updateNote, deleteNote, getTasks, addTask, toggleTask, deleteTask } = useRepWorkspace();
  // Official monthly target (representative_goals) — the sole source of
  // truth for this rep's personal achievement/pace/forecast (§12/§19). No
  // fallback to the legacy rep.monthlyTarget column.
  const { targetValue: target } = useRepresentativeGoal(rep.id, currentGoalMonth());
  const status = statusOf(rep, target);
  const pct = target === null ? null : calculateAchievement(rep.currentResult, target);
  const pace = target === null ? null : sharedPaceInfo(target, rep.currentResult, workdaysInMonth(), workdaysPassed(), workdaysRemaining());
  const perDay = pace?.perDay ?? null;
  const forecast = pace?.forecast ?? null;

  const repFeedback = useMemo(
    () => state.feedback.filter((f) => f.repId === rep.id).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [state.feedback, rep.id],
  );
  const avgListen = repFeedback.length ? Math.round(repFeedback.reduce((s, f) => s + f.score, 0) / repFeedback.length) : 0;
  const daysSinceLast = repFeedback[0] ? daysSince(repFeedback[0].date) : null;
  const risk = riskOf(rep, target, repFeedback.length ? avgListen : null, daysSinceLast);

  // Renewal-specific section: only ever shown for a team whose KPI profile is
  // explicitly "renewals" — never inferred from the team's name — and only when
  // real dated values exist. calculateRenewalRate never derives from target/result.
  // Visible teams — this workspace is opened for a specific rep's own record,
  // including one whose team has since been deactivated (history must remain viewable).
  const { teams: cloudTeams } = useVisibleTeams();
  const kpiProfile = rep.teamId
    ? cloudTeams.find((t) => t.id === rep.teamId)?.kpiProfile ?? DEFAULT_KPI_PROFILE
    : DEFAULT_KPI_PROFILE;
  const renewalTotals = renewalTotalsForMonth(rep.id, state.kpiValues);
  const renewalRate = calculateRenewalRate(kpiProfile, renewalTotals.completed, renewalTotals.opportunities);

  const notes = getNotes(rep.id);
  const tasks = getTasks(rep.id);
  const openTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);

  const [openListening, setOpenListening] = useState<Feedback | null>(null);
  const [editingNote, setEditingNote] = useState<WorkspaceNote | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteVisibleToRep, setNoteVisibleToRep] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const summary = useMemo(() => {
    const parts: string[] = [];
    parts.push(pct === null
      ? `לא הוגדר יעד אישי ל${rep.name} לחודש זה`
      : `${rep.name} נמצא/ת כעת על ${Math.round(pct)}% מהיעד החודשי`);
    if (repFeedback.length > 0) parts.push(`בוצעו ${repFeedback.length} האזנות בציון ממוצע של ${avgListen}`);
    else parts.push("טרם תועדה האזנה לנציג/ה זה/זו");
    parts.push(openTasks.length ? `קיימות ${openTasks.length} משימות פתוחות` : "לא קיימות משימות פתוחות");
    return parts.join(". ") + ".";
  }, [rep.name, pct, repFeedback.length, avgListen, openTasks.length]);

  return (
    <>
      {/* Sticky header */}
      <SheetHeader className="p-4 pb-4 border-b bg-card sm:p-5">
        {/* Explicit back control: on a phone this sheet reads as a full page. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="sm:hidden -ms-2 self-start gap-1 text-muted-foreground"
        >
          <ChevronRight className="h-4 w-4" />
          חזרה
        </Button>
        <div className="flex items-start gap-3 pe-10">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary font-bold shrink-0 text-lg">
            {rep.name.slice(0, 1)}
          </div>

          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg text-start truncate">{rep.name}</SheetTitle>
            <SheetDescription className="text-start flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="outline" className="font-normal">{rep.teamName}</Badge>
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
                <SummaryRow label="יעד אישי" value={target === null ? "לא הוגדר" : formatNum(target)} />
                <SummaryRow label="ביצוע נוכחי" value={formatNum(rep.currentResult)} />
                <SummaryRow label="קצב יומי נדרש" value={perDay === null ? "—" : `${formatNum(perDay)}/יום`} />
                <SummaryRow
                  label="תחזית סוף חודש"
                  value={forecast === null ? "—" : formatNum(forecast)}
                  tone={forecast === null || target === null ? undefined : forecast >= target ? "success" : "danger"}
                />
                <SummaryRow label="האזנות שתועדו" value={formatNum(repFeedback.length)} />
                <SummaryRow label="משוב אחרון" value={daysSinceLast === null ? "אין עדיין" : `לפני ${daysSinceLast} ימים`} />
              </div>
            </div>
          </section>

          {/* Section 2 - Current performance */}
          <Section icon={LineChartIcon} title="ביצועים החודש">
            {target === null ? (
              <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground text-center">
                לא הוגדר יעד אישי לחודש זה — לא ניתן לחשב עמידה, קצב או תחזית. ביצוע נוכחי: {formatNum(rep.currentResult)}.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <AnalyticStat label="יעד" value={formatNum(target)} />
                  <AnalyticStat label="ביצוע" value={formatNum(rep.currentResult)} />
                  <AnalyticStat label="עמידה" value={formatPct(pct!)} tone={status === "above" ? "success" : status === "attention" ? "danger" : "warning"} />
                </div>
                <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", status === "above" ? "bg-[color:var(--success)]" : status === "onpace" ? "bg-[color:var(--warning)]" : "bg-primary")} style={{ width: `${Math.min(pct!, 100)}%` }} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground text-end">תחזית סוף חודש: {formatNum(forecast!)}</div>
              </>
            )}
          </Section>

          {/* Section 2b - Renewal KPIs: only for a real "renewals" profile team */}
          {kpiProfile === "renewals" && (
            <Section icon={LineChartIcon} title="מדדי חידושים">
              <div className="grid grid-cols-3 gap-3">
                <AnalyticStat label="הזדמנויות חידוש" value={renewalTotals.opportunities == null ? "אין נתונים" : formatNum(renewalTotals.opportunities)} />
                <AnalyticStat label="חידושים שבוצעו" value={renewalTotals.completed == null ? "אין נתונים" : formatNum(renewalTotals.completed)} />
                <AnalyticStat
                  label="אחוז חידוש"
                  value={renewalRate.available ? formatPct(renewalRate.pct) : "לא זמין"}
                  tone={renewalRateTone(renewalRate)}
                />
              </div>
              {!renewalRate.available && (
                <p className="mt-2 text-xs text-muted-foreground">{RENEWAL_RATE_UNAVAILABLE_LABEL[renewalRate.reason]}</p>
              )}
            </Section>
          )}

          {/* Section 3 - Listening history (real feedback records for this rep) */}
          <Section icon={Headphones} title="היסטוריית האזנות" right={repFeedback.length > 0 ? <span className="text-xs text-muted-foreground">ממוצע: <span className="font-semibold text-foreground">{avgListen}</span></span> : undefined}>
            {repFeedback.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4 rounded-lg border border-dashed">עדיין לא נרשמו האזנות לנציג/ה זה/זו.</p>
            ) : (
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
                    {repFeedback.map((f) => (
                      <TableRow key={f.id} onClick={() => setOpenListening(f)} className="cursor-pointer">
                        <TableCell className="text-xs tabular-nums whitespace-nowrap">{formatDateIL(f.date)}</TableCell>
                        <TableCell className="text-xs">{f.listener}</TableCell>
                        <TableCell className="text-end">
                          <span className={cn("font-bold tabular-nums", SCORE_TEXT_CLASS[scoreTone(f.score)])}>{f.score}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{f.managerSummary || f.keep || "—"}</TableCell>
                        <TableCell>
                          {f.published
                            ? <Badge className="text-[10px] bg-[color:var(--success)]/15 text-success-foreground hover:bg-[color:var(--success)]/15 border-transparent">פורסם</Badge>
                            : <Badge variant="outline" className="text-[10px]">טיוטה</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          {/* Section 4 - Manager notes */}
          <Section icon={StickyNote} title="הערות מנהל" right={
            <Button size="sm" variant="outline" onClick={() => { setEditingNote(null); setNoteText(""); setNoteVisibleToRep(false); }}>
              <Plus className="ms-1 h-4 w-4" />הוסף הערה
            </Button>
          }>
            <div className="space-y-2">
              <div className="rounded-xl border p-3">
                <Label className="text-xs">{editingNote ? "עריכת הערה" : "הערה חדשה"}</Label>
                <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="הערה פרטית לתיק הנציג..." className="mt-2 min-h-20" />
                {!editingNote && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox checked={noteVisibleToRep} onCheckedChange={(v) => setNoteVisibleToRep(v === true)} />
                    הצג הערה זו גם לנציג/ה (ברירת מחדל: פרטית למנהלים בלבד)
                  </label>
                )}
                <div className="mt-2 flex justify-end gap-2">
                  {editingNote && (
                    <Button variant="ghost" size="sm" onClick={() => { setEditingNote(null); setNoteText(""); }}>ביטול</Button>
                  )}
                  <Button size="sm" onClick={() => {
                    if (!noteText.trim()) return toast.error("יש להזין טקסט");
                    if (editingNote) { updateNote(rep.id, editingNote.id, noteText.trim()); toast.success("ההערה עודכנה"); }
                    else {
                      addNote(rep.id, noteText.trim(), { isPrivate: !noteVisibleToRep });
                      toast.success(noteVisibleToRep ? "ההערה נוספה וגלויה לנציג/ה" : "ההערה נוספה כהערה פרטית");
                    }
                    setEditingNote(null); setNoteText(""); setNoteVisibleToRep(false);
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
                      <div className="flex items-center gap-1.5">
                        {n.isPrivate
                          ? <Badge variant="outline" className="text-[10px]">פרטי</Badge>
                          : <Badge className="text-[10px] bg-primary/10 text-primary border-transparent hover:bg-primary/10">גלוי לנציג/ה</Badge>}
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

          {/* Section 5 - Tasks */}
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

          {/* Section 6 - Manager summary */}
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
              <div>
                <div className="text-muted-foreground text-xs mb-1">סיכום מנהל</div>
                <p>{openListening.managerSummary || openListening.keep || "—"}</p>
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
      <div className={cn("text-sm font-bold tabular-nums truncate", tone === "success" && "text-success-foreground", tone === "danger" && "text-primary")}>{value}</div>
    </div>
  );
}

function AnalyticStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="rounded-xl border p-3 text-center">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-base font-extrabold tabular-nums",
        tone === "success" && "text-success-foreground",
        tone === "warning" && "text-warning-foreground",
        tone === "danger" && "text-primary")}>{value}</div>
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete }: { task: { id: string; title: string; due: string; priority: "low" | "medium" | "high"; done: boolean }; onToggle: () => void; onDelete: () => void }) {
  const priorityCls = task.priority === "high" ? "text-primary" : task.priority === "medium" ? "text-warning-foreground" : "text-muted-foreground";
  const priorityLabel = { low: "נמוכה", medium: "בינונית", high: "גבוהה" }[task.priority];
  return (
    <li className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", task.done && "opacity-60")}>
      <Checkbox checked={task.done} onCheckedChange={onToggle} aria-label={`סימון המשימה ${task.title} כבוצעה`} />
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
