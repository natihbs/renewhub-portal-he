/**
 * Home-screen cards shared by "המסך שלי" (representative) and "היום בצוות"
 * (team manager).
 *
 * These live outside index.tsx because both screens need the same three
 * answers — how current is the data, what is happening in the competitions,
 * what has been said in feedback — and the two screens must not answer them
 * differently. Every derivation is in home-domain.ts; the components here only
 * fetch, scope and render.
 *
 * All four async states are distinguished in every card (loading / error /
 * genuinely empty / ready). A pending query never reaches the same branch as a
 * confirmed absence: "אין משוב" is a statement about the world and is only
 * printed once the query that could have disproved it has succeeded.
 */

import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Award,
  CheckSquare,
  Database,
  Eye,
  Gauge,
  Headphones,
  ListChecks,
  Medal,
  Target,
  Trophy,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useApp, visibleFeedback } from "@/lib/store";
import { useAppMode } from "@/lib/app-mode";
import { useListening } from "@/lib/listening-store";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { getPerformanceDataFreshness } from "@/lib/dashboard.functions";
import { scoreTone, SCORE_BADGE_CLASS, todayIsoDate } from "@/lib/feedback-domain";
import {
  formatDateIL,
  formatMonthIL,
  formatNum,
  formatPct,
  workdaysInMonth,
  workdaysPassed,
} from "@/lib/format";
import { ACHIEVEMENT_BADGE_CLASS } from "@/lib/performance-domain";
import type { Rep } from "@/lib/seed";
import {
  activeCompetitions,
  competitionStandings,
  daysUntil,
  recentFeedback,
  sessionsToDo,
  splitByPace,
  standingFor,
  summariseMonthlyFreshness,
  summariseTasks,
  PACE_BUCKET_LABEL,
  type PaceInput,
} from "@/lib/home-domain";

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function CardError({ message }: { message?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div>
        <p className="text-destructive">{message ?? "שגיאה בטעינת הנתונים."}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          אין להסתמך על התוכן בכרטיס זה עד לטעינה מוצלחת.
        </p>
      </div>
    </div>
  );
}

function CardLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">טוען נתונים…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** Name lookup that never invents a person: an unknown id says so out loud. */
function repNameOf(reps: Rep[], repId: string): string {
  return reps.find((r) => r.id === repId)?.name ?? "נציג/ה שאינו/ה בהרשאתך";
}

// ---------------------------------------------------------------------------
// מצב הנתונים / עדכון אחרון
// ---------------------------------------------------------------------------

const FRESHNESS_TONE_CLASS: Record<"success" | "warning" | "danger" | "muted", string> = {
  success: "bg-[color:var(--success)]/12 text-success-foreground border-[color:var(--success)]/25",
  warning: "bg-[color:var(--warning)]/15 text-warning-foreground border-[color:var(--warning)]/30",
  danger: "bg-primary/10 text-primary border-primary/25",
  muted: "bg-muted text-muted-foreground border-border",
};

/**
 * One honest line about how current the figures above it are.
 *
 * Three separate facts are reported rather than merged, because a manager
 * acts differently on each: the reporting PERIOD is which month the numbers
 * describe, the last IMPORT is when data actually arrived in Pulse, and the
 * freshness STATE compares the period to the current month. For monthly
 * data the newest metric_date is the first of the month — a period marker —
 * so counting days from it and calling current-month figures "לא עדכני"
 * misreads a period as an update timestamp.
 */
export function DataFreshnessBar({ teamId }: { teamId: string | null }) {
  const { isDemo } = useAppMode();
  const load = useServerFn(getPerformanceDataFreshness);
  const today = todayIsoDate();

  const q = useQuery({
    queryKey: ["home-freshness", teamId] as const,
    queryFn: () => load({ data: { team_id: teamId } }),
    enabled: !isDemo,
    staleTime: 60_000,
  });

  const summary = useMemo(
    () =>
      summariseMonthlyFreshness({
        // import_history.period is the authoritative reporting period; the
        // newest kpi metric_date is only a period marker fallback.
        period: q.data?.lastImportPeriod ?? q.data?.sourceDataDate ?? null,
        lastImportAt: q.data?.lastImportAt ?? null,
        lastImportStatus: q.data?.lastImportStatus ?? null,
        today,
      }),
    [q.data, today],
  );

  const reason = isDemo
    ? "מצב הדגמה — הנתונים אינם מגיעים ממקור אמיתי."
    : q.isLoading
      ? "בודק…"
      : "בדיקת מצב הנתונים נכשלה.";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border px-3.5 py-2.5 text-sm",
        FRESHNESS_TONE_CLASS[q.isError ? "danger" : summary.tone],
      )}
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <Database className="h-4 w-4" />
        מצב הנתונים
      </span>
      {isDemo || q.isLoading || q.isError ? (
        <span className="text-xs">{reason}</span>
      ) : (
        <>
          <span>{summary.stateLabel}</span>
          {summary.lines.map((line) => (
            <span key={line} className="text-xs opacity-90">
              {line}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// נציגים מעל / מתחת לקצב  (manager)
// ---------------------------------------------------------------------------

function PaceList({
  title,
  rows,
  reps,
  tone,
}: {
  title: string;
  rows: { repId: string; repName: string; achievementPct: number | null }[];
  reps: Rep[];
  tone: "success" | "warning" | "danger";
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-muted-foreground">
        {title} · {rows.length}
      </div>
      <ul className="space-y-1">
        {rows.slice(0, 5).map((r) => {
          const name = r.repName || repNameOf(reps, r.repId);
          return (
            <li
              key={r.repId}
              className="flex items-center gap-2 rounded-lg bg-surface-subtle px-2.5 py-1.5"
            >
              <InitialsAvatar name={name} className="h-7 w-7 text-[10px]" />
              <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
              <Badge
                variant="outline"
                className={cn("shrink-0 text-xs", ACHIEVEMENT_BADGE_CLASS[tone])}
              >
                {r.achievementPct !== null ? formatPct(r.achievementPct) : "—"}
              </Badge>
            </li>
          );
        })}
      </ul>

      {rows.length > 5 && (
        <div className="text-xs text-muted-foreground">ועוד {rows.length - 5} נציגים</div>
      )}
    </div>
  );
}

/**
 * Who is ahead of the required pace and who is behind it, by name.
 *
 * The pace bands come from paceStatus, the same function the Performance page
 * uses, so a representative cannot be "בקצב" here and "דורש טיפול" there.
 *
 * Representatives with no official target are shown as their own group and are
 * excluded from the pace denominator. They have not fallen behind — nothing has
 * been asked of them yet — and listing them under "מתחת לקצב" would send the
 * manager to coach a problem that is actually a missing target.
 */
export function TeamPaceCard({
  reps,
  goalsByRepId,
  isLoading,
  isError,
  className,
}: {
  reps: Rep[];
  goalsByRepId: Map<string, number>;
  isLoading?: boolean;
  isError?: boolean;
  className?: string;
}) {
  const workdaysTotal = useMemo(() => workdaysInMonth(), []);
  const passed = useMemo(() => workdaysPassed(), []);

  const split = useMemo(() => {
    const inputs: PaceInput[] = reps.map((r) => ({
      repId: r.id,
      repName: r.name,
      currentResult: r.currentResult,
      target: goalsByRepId.get(r.id) ?? null,
    }));
    return splitByPace(inputs, workdaysTotal, passed);
  }, [reps, goalsByRepId, workdaysTotal, passed]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-primary" />
          נציגים מעל ומתחת לקצב
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <CardLoading rows={3} />
        ) : isError ? (
          <CardError message="לא ניתן לטעון את נתוני הקצב של הצוות." />
        ) : split.total === 0 ? (
          <EmptyState icon={Gauge} title="אין נציגים בטווח התצוגה" compact />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {(["above", "onpace", "attention"] as const).map((bucket) => (
                <div key={bucket} className="rounded-xl border p-2.5">
                  <div
                    className={cn(
                      "num text-2xl font-bold",
                      bucket === "attention"
                        ? "text-primary"
                        : bucket === "above"
                          ? "text-success-foreground"
                          : "text-warning-foreground",
                    )}
                  >
                    {split[bucket].length}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {PACE_BUCKET_LABEL[bucket]}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              מתוך {split.measured} נציגים שהוגדר עבורם יעד לחודש {formatMonthIL(todayIsoDate())}
              {split.noTarget.length > 0 &&
                ` · ${split.noTarget.length} נציגים ללא יעד אינם נכללים בחישוב`}
            </p>

            <PaceList
              title={PACE_BUCKET_LABEL.attention}
              rows={split.attention}
              reps={reps}
              tone="danger"
            />
            <PaceList
              title={PACE_BUCKET_LABEL.above}
              rows={split.above}
              reps={reps}
              tone="success"
            />

            {split.noTarget.length > 0 && (
              <div className="rounded-lg border border-dashed p-2.5">
                <div className="text-xs font-semibold text-muted-foreground">
                  {PACE_BUCKET_LABEL.no_target} · {split.noTarget.length}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {split.noTarget
                    .slice(0, 4)
                    .map((r) => r.repName)
                    .join(" · ")}
                  {split.noTarget.length > 4 && ` ועוד ${split.noTarget.length - 4}`}
                </div>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link to="/targets">
                    <Target className="ms-1 h-3.5 w-3.5" />
                    הגדרת יעדים
                  </Link>
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// משובים שצריך לבצע + משובים אחרונים  (manager)
// ---------------------------------------------------------------------------

/**
 * The manager's feedback obligations and their recent history in one card.
 *
 * Overdue sessions are listed before today's, and counted with them, because a
 * listening session planned for last week and never held is the one that
 * silently disappears — today's is still on the calendar in front of them.
 */
export function TeamFeedbackCard({
  repIds,
  reps,
  className,
}: {
  repIds: string[];
  reps: Rep[];
  className?: string;
}) {
  const { state } = useApp();
  const listening = useListening();
  const today = todayIsoDate();
  const scoped = useMemo(() => new Set(repIds), [repIds]);

  const todo = useMemo(
    () =>
      sessionsToDo(
        listening.schedules.filter((s) => scoped.has(s.repId)),
        today,
      ),
    [listening.schedules, scoped, today],
  );
  const recent = useMemo(
    () =>
      recentFeedback(
        state.feedback.filter((f) => scoped.has(f.repId)),
        4,
      ),
    [state.feedback, scoped],
  );

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Headphones className="h-4 w-4 text-primary" />
          משוב והאזנות
        </CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to="/feedback">לעמוד המשוב</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* משובים שצריך לבצע */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">משובים שצריך לבצע</div>
          {listening.isLoading ? (
            <CardLoading rows={2} />
          ) : listening.isError ? (
            <CardError message="לא ניתן לטעון את לוח ההאזנות." />
          ) : todo.dueNow === 0 ? (
            <p className="text-sm text-muted-foreground">
              אין האזנות פתוחות למועד היום או קודם לכן.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {[...todo.overdue, ...todo.today].slice(0, 4).map((s) => {
                const late = s.date < today;
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">{repNameOf(reps, s.repId)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {s.topic || "ללא נושא"} · {s.time}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-xs",
                        late ? ACHIEVEMENT_BADGE_CLASS.danger : ACHIEVEMENT_BADGE_CLASS.warning,
                      )}
                    >
                      {late ? `באיחור · ${formatDateIL(s.date)}` : "היום"}
                    </Badge>
                  </li>
                );
              })}
              {todo.dueNow > 4 && (
                <li className="text-xs text-muted-foreground">ועוד {todo.dueNow - 4} האזנות</li>
              )}
            </ul>
          )}
        </div>

        {/* משובים אחרונים */}
        <div className="space-y-2 border-t pt-3">
          <div className="text-xs font-semibold text-muted-foreground">משובים אחרונים</div>
          {state.feedbackLoading ? (
            <CardLoading rows={2} />
          ) : state.feedbackError ? (
            <CardError message={state.feedbackError} />
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">טרם נרשמו משובים לנציגי הצוות.</p>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm">{repNameOf(reps, f.repId)}</div>
                    <div className="text-xs text-muted-foreground">{formatDateIL(f.date)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!f.published && (
                      <Badge variant="outline" className="text-xs">
                        טיוטה
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={cn("text-xs", SCORE_BADGE_CLASS[scoreTone(f.score)])}
                    >
                      {f.score}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// תחרויות פעילות
// ---------------------------------------------------------------------------

function CompetitionWindow({ endDate, today }: { endDate: string; today: string }) {
  const left = daysUntil(endDate, today);
  return (
    <span className="text-xs text-muted-foreground">
      {left === null
        ? `מסתיימת ב־${formatDateIL(endDate)}`
        : left === 0
          ? "מסתיימת היום"
          : `נותרו ${left} ימים · עד ${formatDateIL(endDate)}`}
    </span>
  );
}

/** Active competitions with the current top of the table, for a manager. */
export function TeamCompetitionsCard({ reps, className }: { reps: Rep[]; className?: string }) {
  const { state } = useApp();
  const today = todayIsoDate();
  const running = useMemo(
    () => activeCompetitions(state.competitions, today),
    [state.competitions, today],
  );

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-primary" />
          תחרויות פעילות
        </CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to="/competitions">לכל התחרויות</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {running.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="אין תחרות פעילה כרגע"
            description="תחרות פעילה תופיע כאן יחד עם מצב הניקוד העדכני."
            compact
          />
        ) : (
          running.slice(0, 3).map((c) => {
            const board = competitionStandings(c);
            return (
              <div key={c.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">{c.name}</div>
                  <CompetitionWindow endDate={c.endDate} today={today} />
                </div>
                {board.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">טרם נרשם ניקוד בתחרות זו.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {board.slice(0, 3).map((row) => (
                      <li
                        key={row.repId}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Medal className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate">
                            {row.rank}. {repNameOf(reps, row.repId)}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold">
                          {formatNum(row.total)} נק׳
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The same competitions, from the representative's own seat.
 *
 * A representative with no recorded score is told exactly that, and is NOT
 * ranked last: having nothing recorded and being in last place are different
 * facts, and only one of them is supported by the data.
 */
export function MyCompetitionsCard({
  repId,
  className,
}: {
  repId: string | null;
  className?: string;
}) {
  const { state } = useApp();
  const today = todayIsoDate();
  const running = useMemo(
    () => activeCompetitions(state.competitions, today),
    [state.competitions, today],
  );

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-primary" />
          תחרויות פעילות
        </CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to="/competitions">פרטים</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {running.length === 0 ? (
          <EmptyState icon={Trophy} title="אין תחרות פעילה כרגע" compact />
        ) : (
          running.slice(0, 3).map((c) => {
            const mine = repId ? standingFor(c, repId) : null;
            return (
              <div key={c.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">{c.name}</div>
                  <CompetitionWindow endDate={c.endDate} today={today} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {mine === null ? (
                    <span className="text-xs text-muted-foreground">
                      לא זוהה נציג משויך לחשבון זה.
                    </span>
                  ) : mine.rank === null ? (
                    <span className="text-xs text-muted-foreground">
                      טרם נרשם עבורך ניקוד בתחרות זו.
                    </span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5 text-sm">
                        <Award className="h-4 w-4 text-primary" />
                        <span className="font-bold tabular-nums">{formatNum(mine.total)}</span> נק׳
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        מקום {mine.rank} מתוך {mine.participants} נציגים עם ניקוד
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// משובים שקיבלתי  (representative)
// ---------------------------------------------------------------------------

/**
 * The feedback a representative has actually received — the evaluations
 * themselves, not a link to a page that might contain some.
 *
 * The list is filtered through visibleFeedback(), the single client-side mirror
 * of the RLS rule, so a draft can never surface here before its manager
 * publishes it.
 */
export function MyFeedbackCard({ repId, className }: { repId: string; className?: string }) {
  const { state } = useApp();
  const mine = useMemo(
    () => recentFeedback(visibleFeedback(state.feedback, false, repId), 3),
    [state.feedback, repId],
  );

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Headphones className="h-4 w-4 text-primary" />
          משובים שקיבלתי
        </CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to="/feedback">כל המשובים</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {state.feedbackLoading ? (
          <CardLoading rows={2} />
        ) : state.feedbackError ? (
          <CardError message={state.feedbackError} />
        ) : mine.length === 0 ? (
          <EmptyState
            icon={Headphones}
            title="טרם פורסם עבורך משוב"
            description="משוב מהאזנה יופיע כאן ברגע שמנהל/ת הצוות יפרסמו אותו."
            compact
          />
        ) : (
          <ul className="space-y-2">
            {mine.map((f) => (
              <li key={f.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{formatDateIL(f.date)}</div>
                  <Badge
                    variant="outline"
                    className={cn("text-xs", SCORE_BADGE_CLASS[scoreTone(f.score)])}
                  >
                    ציון {f.score}
                  </Badge>
                </div>
                {f.keep && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground/80">לשמר: </span>
                    {f.keep}
                  </p>
                )}
                {f.improve && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground/80">לשפר: </span>
                    {f.improve}
                  </p>
                )}
                {/* Deep-links into /feedback's "פירוט משוב" dialog for exactly
                    this evaluation — full details (score, sections, keep/
                    improve, manager summary, next task, revision history). */}
                <Button asChild size="sm" variant="outline" className="mt-2 h-7">
                  <Link to="/feedback" search={{ feedbackId: f.id }}>
                    <Eye className="ms-1 h-3.5 w-3.5" />
                    צפייה במשוב
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// משימות / התחייבויות פנימיות  (representative)
// ---------------------------------------------------------------------------

type RepTaskRow = {
  id: string;
  title: string;
  done: boolean;
  due_on: string | null;
  priority: string;
};

/**
 * The representative's open commitments.
 *
 * "אם קיימות" in the requirement is taken literally: the card renders nothing
 * at all when there is no source to read from (Demo Mode has no task fixture)
 * rather than showing an empty box that implies the person has no commitments.
 * An empty list from a query that genuinely succeeded IS shown, because that is
 * a real and useful answer.
 */
export function MyTasksCard({ repId, className }: { repId: string | null; className?: string }) {
  const today = todayIsoDate();
  const { live, rows, isLoading, isError } = useCloudCollection<RepTaskRow>("rep_tasks", {
    eq: repId ? { representative_id: repId } : undefined,
    order: { column: "due_on", ascending: true },
    enabled: !!repId,
  });

  const summary = useMemo(
    () =>
      summariseTasks(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          done: r.done,
          dueOn: r.due_on,
          priority: r.priority,
        })),
        today,
      ),
    [rows, today],
  );

  if (!live && !isLoading) return null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4 text-primary" />
          המשימות שלי
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <CardLoading rows={2} />
        ) : isError ? (
          <CardError message="לא ניתן לטעון את רשימת המשימות." />
        ) : summary.open.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {summary.total === 0
              ? "לא הוגדרו עבורך משימות."
              : `כל המשימות הושלמו (${summary.doneCount} מתוך ${summary.total}).`}
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {summary.open.length} משימות פתוחות מתוך {summary.total}
              {summary.overdue > 0 && ` · ${summary.overdue} באיחור`}
              {summary.dueToday > 0 && ` · ${summary.dueToday} להיום`}
            </p>
            <ul className="space-y-1.5">
              {summary.open.slice(0, 5).map((t) => {
                const late = t.dueOn !== null && t.dueOn < today;
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <CheckSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm">{t.title}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t.dueOn === null ? (
                        "ללא תאריך"
                      ) : late ? (
                        <span className="text-primary">באיחור · {formatDateIL(t.dueOn)}</span>
                      ) : (
                        formatDateIL(t.dueOn)
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {summary.open.length > 5 && (
              <div className="mt-2 text-xs text-muted-foreground">
                ועוד {summary.open.length - 5} משימות
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
