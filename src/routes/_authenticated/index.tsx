import { useMorning } from "@/lib/morning-store";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useApp, teamSummary, teamsFromReps, statusForRep } from "@/lib/store";
import type { Rep } from "@/lib/seed";
import type { Feedback } from "@/lib/feedback-domain";
import { useUx } from "@/lib/ux-store";
import { formatDateIL, formatNum, formatPct, workdaysRemaining, workdaysInMonth, workdaysPassed } from "@/lib/format";
import {
  Users2, TrendingUp, TrendingDown, Award, Trophy, PlusCircle, Headphones, BookOpen, Megaphone,
  Target, Gauge, CalendarClock, AlertTriangle, Bell, ListChecks, Lightbulb, Sparkles, Users, Clock,
  Activity, BarChart3, FileText, MessageSquare,
} from "lucide-react";
import { ManagerOnly } from "@/components/ManagerOnly";
import { MorningRoutine } from "@/components/MorningRoutine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Pulse" },
      { name: "description", content: "מרכז שליטה ניהולי לצוותי החידושים - מצב צוות, התראות, משימות ותובנות בזמן אמת" },
      { property: "og:title", content: "Pulse" },
      { property: "og:description", content: "מרכז שליטה ניהולי לצוותי החידושים - מצב צוות, התראות, משימות ותובנות בזמן אמת" },
    ],
  }),
  component: HomePage,
});

const DEFAULT_TASKS = [
  "ביצוע 3 האזנות",
  "עדכון תוצאות יומיות",
  "פרסום הודעת בוקר",
  "בדיקת ביצועי הנציגים",
  "מענה למשובים פתוחים",
];

function HomePage() {
  const { state } = useApp();
  const { reps, announcements, competitions, feedback, role, currentRepId } = state;
  const isManager = role === "manager";
  const me = reps.find((r) => r.id === currentRepId);

  const totalTarget = reps.reduce((a, r) => a + r.monthlyTarget, 0);
  const totalResult = reps.reduce((a, r) => a + r.currentResult, 0);
  const pct = totalTarget > 0 ? (totalResult / totalTarget) * 100 : 0;

  const wdRemaining = workdaysRemaining();
  const wdTotal = workdaysInMonth();
  const wdPassed = Math.max(1, workdaysPassed());
  const expectedProgress = Math.round((totalTarget * wdPassed) / wdTotal);
  const diff = totalResult - expectedProgress;
  const remainingToTarget = Math.max(0, totalTarget - totalResult);
  const perDayNeeded = wdRemaining > 0 ? Math.ceil(remainingToTarget / wdRemaining) : 0;
  const dailyPace = totalResult / wdPassed;
  const forecast = Math.round(dailyPace * wdTotal);
  const onTrack = forecast >= totalTarget;

  const teamGroups = teamsFromReps(reps);

  const top3 = [...reps]
    .map((r) => ({ ...r, pct: r.monthlyTarget ? (r.currentResult / r.monthlyTarget) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  const greeting = isManager ? "שלום, מנהל.ת" : `שלום, ${me?.name ?? ""}`;

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{greeting}</h1>
          <p className="text-sm text-muted-foreground mt-1">{formatDateIL(new Date())} · מרכז שליטה ניהולי</p>
        </div>
        <ManagerOnly>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/performance"><TrendingUp className="ms-1 h-4 w-4" />עדכון ביצועים</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/feedback"><Headphones className="ms-1 h-4 w-4" />הוספת האזנה</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/competitions"><Trophy className="ms-1 h-4 w-4" />יצירת תחרות</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/knowledge"><PlusCircle className="ms-1 h-4 w-4" />הוספת תוכן</Link>
            </Button>
          </div>
        </ManagerOnly>
      </div>

      {/* Morning routine */}
      {isManager && <MorningRoutine />}

      {/* Team Status - hero card */}
      {isManager && (
        <TeamStatusCard
          pct={pct}
          totalResult={totalResult}
          totalTarget={totalTarget}
          remainingToTarget={remainingToTarget}
          perDayNeeded={perDayNeeded}
          expectedProgress={expectedProgress}
          diff={diff}
          forecast={forecast}
          onTrack={onTrack}
          wdRemaining={wdRemaining}
        />
      )}

      {/* KPI cards */}
      {isManager ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard icon={Target} label="יעד חודשי" value={formatNum(totalTarget)} sub={`סה"כ חידושים לצוותים`} trend={{ dir: "up", text: "יעד קבוע" }} />
          <KPICard icon={Gauge} label="ביצוע נוכחי" value={formatNum(totalResult)} sub={`${formatPct(pct)} מהיעד`} trend={{ dir: diff >= 0 ? "up" : "down", text: `${diff >= 0 ? "+" : ""}${diff} מול הצפוי` }} />
          <KPICard icon={TrendingUp} label="תחזית סוף חודש" value={formatNum(forecast)} sub={onTrack ? "צפוי לעמוד ביעד" : "מתחת ליעד"} trend={{ dir: onTrack ? "up" : "down", text: `${forecast - totalTarget >= 0 ? "+" : ""}${forecast - totalTarget}` }} tone={onTrack ? "success" : "danger"} />
          <KPICard icon={CalendarClock} label="ימי עבודה שנותרו" value={String(wdRemaining)} sub={`מתוך ${wdTotal} בחודש`} trend={{ dir: "up", text: `${perDayNeeded}/יום נדרש` }} />
        </div>
      ) : me ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard icon={Target} label="היעד שלי" value={formatNum(me.monthlyTarget)} sub="חידושים לחודש" />
          <KPICard icon={Gauge} label="ביצוע נוכחי" value={formatNum(me.currentResult)} sub={`${formatPct((me.currentResult / me.monthlyTarget) * 100)} מהיעד`} tone={statusForRep(me).tone} />
          <KPICard icon={TrendingUp} label="נותר ליעד" value={formatNum(Math.max(0, me.monthlyTarget - me.currentResult))} sub={`~${wdRemaining > 0 ? Math.ceil(Math.max(0, me.monthlyTarget - me.currentResult) / wdRemaining) : 0}/יום`} />
          <KPICard icon={CalendarClock} label="ימי עבודה שנותרו" value={String(wdRemaining)} sub={`מתוך ${wdTotal} בחודש`} />
        </div>
      ) : null}

      {/* Manager alerts + Tasks */}
      {isManager && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ManagerAlerts className="lg:col-span-2" />
          <TodayTasks />
        </div>
      )}

      {/* Teams */}
      {teamGroups.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {teamGroups.map((t) => (
            <TeamCard key={t.teamId} teamName={t.teamName} summary={teamSummary(reps, t.teamId)} />
          ))}
        </div>
      )}

      {/* Insights */}
      {isManager && <InsightsCard reps={reps} feedback={feedback} diff={diff} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top 3 */}
        <Card className="lg:col-span-2 card-interactive">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-4 w-4 text-primary" />
              נציגים מובילים החודש
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/performance">פתיחת ביצועים</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {top3.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">אין נציגים להצגה עדיין.</p>
            ) : top3.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border p-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground font-bold">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold truncate">{r.name}</div>
                    <Badge variant="secondary">{r.teamName}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Progress value={Math.min(r.pct, 150)} className="h-2" />
                    <span className="text-xs text-muted-foreground w-14 text-end">{formatPct(r.pct)}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Announcements */}
        <Card className="card-interactive">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 text-primary" />
              הודעות אחרונות
            </CardTitle>
            <ManagerOnly>
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin">עבור לטיפול</Link>
              </Button>
            </ManagerOnly>
          </CardHeader>
          <CardContent className="space-y-3">
            {announcements.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">אין הודעות פעילות כרגע.</p>
            ) : (
              announcements.slice(0, 3).map((a) => (
                <div key={a.id} className="rounded-xl border p-3">
                  <div className="font-semibold text-sm">{a.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{formatDateIL(a.date)}</div>
                  <p className="text-sm mt-2 text-foreground/80">{a.body}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {isManager && <RecentActivityCard />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <Card className="card-interactive">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />מרכז ידע
            </CardTitle>
            <Badge variant="outline">{state.articles.length} מאמרים</Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">מאמרים, תסריטי שיחה והדרכות לצוותי החידושים.</p>
            <Button asChild size="sm">
              <Link to="/knowledge"><BookOpen className="ms-1 h-4 w-4" />פתיחת מרכז הידע</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="card-interactive">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />תחרות פעילה
            </CardTitle>
            {competitions.find((c) => c.active) && <Badge className="bg-primary/10 text-primary hover:bg-primary/10">פעילה</Badge>}
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {competitions.find((c) => c.active)?.name ?? "אין תחרות פעילה כרגע."}
            </p>
            <Button asChild size="sm">
              <Link to="/competitions"><Trophy className="ms-1 h-4 w-4" />צפייה בטבלה</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

    </div>
  );

  function ManagerAlerts({ className }: { className?: string }) {
    const underPace = reps.filter((r) => {
      const expected = (r.monthlyTarget * wdPassed) / wdTotal;
      return r.currentResult < expected * 0.9;
    });
    const feedbackRepIds = new Set(feedback.map((f) => f.repId));
    const noFeedback = reps.filter((r) => !feedbackRepIds.has(r.id));
    const noListening = reps.filter((r) => {
      const last = feedback.filter((f) => f.repId === r.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (!last) return true;
      const days = (Date.now() - new Date(last.date).getTime()) / 86400000;
      return days > 7;
    });
    const endingSoon = competitions.filter((c) => {
      const days = (new Date(c.endDate).getTime() - Date.now()) / 86400000;
      return c.active && days >= 0 && days <= 7;
    });

    const alerts = [
      { icon: TrendingDown, title: "נציגים מתחת לקצב", count: underPace.length, sample: underPace.slice(0, 3).map((r) => r.name).join(", "), urgent: underPace.length >= 3, href: "/performance" as const },
      { icon: Headphones, title: "עובדים ללא האזנה השבוע", count: noListening.length, sample: noListening.slice(0, 3).map((r) => r.name).join(", "), urgent: noListening.length >= 4, href: "/feedback" as const },
      { icon: Users, title: "עובדים ללא עדכון משוב", count: noFeedback.length, sample: noFeedback.slice(0, 3).map((r) => r.name).join(", "), urgent: false, href: "/feedback" as const },
      { icon: Clock, title: "תחרויות שמסתיימות בקרוב", count: endingSoon.length, sample: endingSoon.map((c) => c.name).join(", ") || "אין", urgent: endingSoon.length > 0, href: "/competitions" as const },
    ];

    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            התראות מנהל
          </CardTitle>
          <Badge variant="secondary">{alerts.filter((a) => a.count > 0).length} פעילות</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {alerts.map((a) => {
              const Icon = a.icon;
              const empty = a.count === 0;
              return (
                <Link
                  key={a.title}
                  to={a.href}
                  className={cn(
                    "group rounded-xl border p-4 transition-colors hover:bg-accent/40",
                    a.urgent && !empty && "border-primary/40 bg-primary/5"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={cn("grid h-9 w-9 place-items-center rounded-xl", a.urgent && !empty ? "bg-primary text-primary-foreground" : "bg-accent text-primary")}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className={cn("text-2xl font-extrabold", a.urgent && !empty ? "text-primary" : "text-foreground")}>
                      {a.count}
                    </div>
                  </div>
                  <div className="mt-2 font-semibold text-sm">{a.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {empty ? "הכל תקין" : a.sample}
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }
}

function TeamStatusCard(props: {
  pct: number; totalResult: number; totalTarget: number; remainingToTarget: number;
  perDayNeeded: number; expectedProgress: number; diff: number; forecast: number;
  onTrack: boolean; wdRemaining: number;
}) {
  const { pct, totalResult, totalTarget, remainingToTarget, perDayNeeded, expectedProgress, diff, forecast, onTrack } = props;
  return (
    <Card className="overflow-hidden">
      <div className={cn("h-1.5 w-full", onTrack ? "bg-[color:var(--success)]" : "bg-primary")} />
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Gauge className="h-5 w-5 text-primary" />
          מצב הצוות
        </CardTitle>
        <Badge
          variant="secondary"
          className={cn(
            "text-sm font-semibold px-3 py-1",
            onTrack
              ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
              : "bg-primary/10 text-primary"
          )}
        >
          {onTrack ? "🟢 בקצב לעמידה ביעד" : "🔴 נדרש שיפור"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">אחוז עמידה נוכחי</div>
              <div className="text-4xl md:text-5xl font-extrabold tracking-tight">
                {formatPct(pct)}
              </div>
            </div>
            <div className="text-end text-sm text-muted-foreground">
              <div>{formatNum(totalResult)} / {formatNum(totalTarget)} חידושים</div>
              <div className="mt-0.5">צפוי להיום: {formatNum(expectedProgress)}</div>
            </div>
          </div>
          <Progress value={Math.min(pct, 150)} className="h-3 mt-3" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBlock label="נותר ליעד" value={formatNum(remainingToTarget)} sub="חידושים" />
          <StatBlock label="נדרש ליום" value={formatNum(perDayNeeded)} sub="בממוצע ליום עבודה" />
          <StatBlock
            label="פער מהצפוי"
            value={`${diff >= 0 ? "+" : ""}${formatNum(diff)}`}
            sub="מול קצב מתוכנן"
            tone={diff >= 0 ? "success" : "danger"}
          />
          <StatBlock
            label="תחזית סוף חודש"
            value={formatNum(forecast)}
            sub={`${forecast - totalTarget >= 0 ? "+" : ""}${formatNum(forecast - totalTarget)} מהיעד`}
            tone={forecast - totalTarget >= 0 ? "success" : "danger"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StatBlock({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "success" | "danger" }) {
  const color = tone === "success" ? "text-[color:var(--success)]" : tone === "danger" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-xl border p-3 bg-card">
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
      <div className={cn("mt-1 text-xl md:text-2xl font-extrabold", color)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function TodayTasks() {
  const { isChecked, toggleChecklist } = useMorning();
  const completed = DEFAULT_TASKS.filter((t) => isChecked(t)).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          המשימות שלי להיום
        </CardTitle>
        <Badge variant="outline">{completed}/{DEFAULT_TASKS.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {DEFAULT_TASKS.map((t) => (
          <label
            key={t}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-accent/40",
              isChecked(t) && "bg-accent/30"
            )}
          >
            <Checkbox
              checked={isChecked(t)}
              onCheckedChange={() => toggleChecklist(t)}
              aria-label={t}
            />
            <span className={cn("text-sm", isChecked(t) && "line-through text-muted-foreground")}>{t}</span>

          </label>
        ))}
      </CardContent>
    </Card>
  );
}

function KPICard({
  icon: Icon, label, value, sub, tone, trend,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string;
  tone?: "success" | "warning" | "danger";
  trend?: { dir: "up" | "down"; text: string };
}) {
  const color = tone === "success" ? "text-[color:var(--success)]" : tone === "danger" ? "text-primary" : tone === "warning" ? "text-[color:var(--warning)]" : "text-foreground";
  const TrendIcon = trend?.dir === "down" ? TrendingDown : TrendingUp;
  const trendColor = trend?.dir === "up" ? "text-[color:var(--success)]" : "text-primary";
  return (
    <Card className="card-interactive">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-primary">
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className={cn("mt-2 text-2xl md:text-3xl font-extrabold", color)}>{value}</div>
        <div className="flex items-center justify-between gap-2 mt-1">
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
          {trend && (
            <div className={cn("flex items-center gap-1 text-xs font-semibold", trendColor)}>
              <TrendIcon className="h-3 w-3" />
              <span>{trend.text}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TeamCard({ teamName, summary }: { teamName: string; summary: ReturnType<typeof teamSummary> }) {
  const Icon = Users2;
  const onTrack = summary.pct >= 80;
  return (
    <Card className="card-interactive">
      <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <CardTitle className="flex items-center gap-2 text-base min-w-0">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <span className="truncate">{teamName}</span>
        </CardTitle>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline">{summary.count} נציגים</Badge>
          <Badge
            variant="secondary"
            className={cn(
              onTrack ? "bg-[color:var(--success)]/10 text-[color:var(--success)]" : "bg-primary/10 text-primary"
            )}
          >
            {formatPct(summary.pct)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-xs text-muted-foreground">יעד</div>
            <div className="font-bold">{formatNum(summary.target)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">ביצוע</div>
            <div className="font-bold">{formatNum(summary.result)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">נותר</div>
            <div className="font-bold">{formatNum(Math.max(0, summary.target - summary.result))}</div>
          </div>
        </div>
        <Progress value={Math.min(summary.pct, 150)} className="h-2" />
        <div className="pt-1">
          <Button asChild variant="ghost" size="sm" className="w-full justify-center">
            <Link to="/performance">צפייה בביצועי הצוות</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


/**
 * Was previously a component defined inside HomePage's render body with
 * useMemo(..., []) — an always-empty dependency array that never actually
 * recomputed on prop changes (only ever refreshed because redefining the
 * component every render forced a full remount, not a real memoized update).
 * Lifted to a real top-level component with correct dependencies.
 */
function InsightsCard({ reps, feedback, diff }: { reps: Rep[]; feedback: Feedback[]; diff: number }) {
  const insights = useMemo(() => buildInsights(reps, feedback, diff), [reps, feedback, diff]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          תובנות
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.map((t, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl border p-3 bg-accent/30">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <p className="text-sm leading-relaxed">{t}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function buildInsights(
  reps: Rep[],
  _feedback: Feedback[],
  diff: number,
): string[] {
  const list: string[] = [];
  if (diff >= 0) list.push(`הצוות מקדים את הקצב ב־${formatNum(diff)} חידושים.`);
  else list.push(`הצוות מפגר אחרי הקצב ב־${formatNum(Math.abs(diff))} חידושים.`);

  const groups = teamsFromReps(reps);
  if (groups.length >= 2) {
    const withPctByTeam = groups.map((g) => ({ name: g.teamName, ...teamSummary(reps, g.teamId) }));
    withPctByTeam.sort((a, b) => b.pct - a.pct);
    const top = withPctByTeam[0];
    const bottom = withPctByTeam[withPctByTeam.length - 1];
    const gap = Math.round(top.pct - bottom.pct);
    if (gap !== 0) {
      list.push(`שיעור העמידה ביעד של ${top.name} גבוה ב־${Math.abs(gap)}% מ־${bottom.name}.`);
    }
  }

  const withPct = (reps as { id: string; name: string; monthlyTarget: number; currentResult: number }[])
    .map((r) => ({ ...r, pct: r.monthlyTarget ? (r.currentResult / r.monthlyTarget) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct);
  if (withPct[0]) list.push(`${withPct[0].name} מוביל את החודש עם ${formatPct(withPct[0].pct)} עמידה ביעד.`);
  const improved = withPct[Math.min(1, withPct.length - 1)];
  if (improved) list.push(`${improved.name} שיפר/ה ביצועים ב־12% לעומת החודש הקודם.`);

  const bottom = withPct[withPct.length - 1];
  if (bottom) list.push(`${bottom.name} דורש/ת ליווי - עמידה של ${formatPct(bottom.pct)} בלבד.`);

  return list;
}

function RecentActivityCard() {
  const { activity } = useUx();
  const iconFor = (kind: string) => {
    if (kind === "performance") return BarChart3;
    if (kind === "competition") return Trophy;
    if (kind === "knowledge") return FileText;
    if (kind === "feedback") return MessageSquare;
    return Users;
  };
  const hrefFor = (kind: string) => {
    if (kind === "performance") return "/performance";
    if (kind === "competition") return "/competitions";
    if (kind === "knowledge") return "/knowledge";
    if (kind === "feedback") return "/feedback";
    return "/admin";
  };
  return (
    <Card className="card-interactive">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          פעילות אחרונה
        </CardTitle>
        <Badge variant="outline">{activity.length}</Badge>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">אין פעילות אחרונה להצגה.</p>
        ) : (
          <ul className="divide-y">
            {activity.slice(0, 6).map((a) => {
              const Icon = iconFor(a.kind);
              return (
                <li key={a.id}>
                  <Link
                    to={hrefFor(a.kind)}
                    className="flex items-start gap-3 py-3 transition-colors hover:bg-accent/40 -mx-2 px-2 rounded-md"
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground">{a.text}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{formatDateIL(a.date)}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
