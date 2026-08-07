import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useApp, teamsFromReps } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { useAppMode } from "@/lib/app-mode";
import type { Rep } from "@/lib/seed";
import { formatDateIL, formatNum, formatPct, workdaysRemaining, workdaysInMonth, workdaysPassed } from "@/lib/format";
import { calculateAchievement, DEFAULT_KPI_PROFILE, KPI_PROFILE_LABEL, KPI_PROFILE_BADGE_CLASS, type KpiProfile } from "@/lib/performance-domain";
import { useVisibleTeams } from "@/lib/teams-hooks";
import { renewalTotalsForTeamHistorical } from "@/lib/kpi-values";
import { calculateRenewalRate, RENEWAL_RATE_UNAVAILABLE_LABEL } from "@/lib/renewal-rate";
import { useWorkspace } from "@/lib/workspace-context";
import { useTeamGoal, useRepresentativeGoal, useRepresentativeGoals } from "@/lib/goals-hooks";
import { listUsers } from "@/lib/user-admin.functions";
import { useResolvedRole } from "@/lib/use-resolved-role";
import type { AppRole } from "@/lib/navigation-config";
import {
  repsNeedingSupport, viewState, canAssertAbsence, type SupportInput, type ViewState,
} from "@/lib/dashboard-domain";
import { listDashboardActivity, type DashboardActivityItem } from "@/lib/dashboard.functions";
import {
  Users2, TrendingUp, TrendingDown, Award, Trophy, Headphones, BookOpen, Megaphone,
  Target, Gauge, CalendarClock, Lightbulb, Sparkles, Users, Activity, BarChart3, FileText, MessageSquare,
  UsersRound, AlertTriangle, ShieldCheck, RefreshCw, ArrowLeft, Database, Upload, Settings,
} from "lucide-react";
import { MorningRoutine } from "@/components/MorningRoutine";
import {
  DataFreshnessBar, TeamPaceCard, TeamFeedbackCard, TeamCompetitionsCard,
  MyFeedbackCard, MyCompetitionsCard, MyTasksCard,
} from "@/components/HomeCards";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "דף הבית · Pulse" },
      { name: "description", content: "מרכז שליטה ניהולי לצוותי המכירות - מצב צוות, התראות, משימות ותובנות בזמן אמת" },
      { property: "og:title", content: "דף הבית · Pulse" },
      { property: "og:description", content: "מרכז שליטה ניהולי לצוותי המכירות - מצב צוות, התראות, משימות ותובנות בזמן אמת" },
    ],
  }),
  component: HomePage,
});

// The admin scope line deliberately says "system administration", not
// "כלל הארגון": admin is a system administrator, and their home is a system
// console, not an organization-wide business dashboard.
const ADMIN_SCOPE_LABEL = "ניהול מערכת";
const NO_TEAM_LABEL = "ללא צוות משויך";

function HomePage() {
  const role = useResolvedRole();
  if (role === "admin") return <AdminHome />;
  if (role === "manager") return <ManagerHome />;
  return <RepresentativeHome />;
}

// ============================================================================
// Shared async-state primitives
//
// §P1. The dashboard previously had no loading and no error handling at all —
// zero occurrences of isLoading or isError in this file — while every hook it
// calls exposes both. Because useCloudCollection returns `rows: data ?? []`, a
// pending or failed query reached the same branch as a genuinely empty result,
// so the page rendered confident false statements ("לא הוגדר יעד חודשי לצוות
// זה") with a call to action attached, for teams whose target simply had not
// arrived yet. These components make the four states distinct.
// ============================================================================

function CardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">טוען נתונים…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

/** A failure the user can act on, rather than a card that silently shows nothing. */
function ErrorState({ message, onRetry, compact }: { message?: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm", compact && "p-2.5")}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="flex-1 min-w-0">
          <p className="text-destructive">{message ?? "שגיאה בטעינת הנתונים."}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            הנתונים בכרטיס זה עשויים להיות חסרים — אין להסתמך עליהם עד לטעינה מוצלחת.
          </p>
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} className="shrink-0">
            <RefreshCw className="ms-1 h-3.5 w-3.5" />נסו שוב
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * "שלום, {name}" + workspace scope.
 *
 * The admin home is a system-administration console and ignores the workspace
 * switcher entirely — there is no per-team system administration. What must
 * not happen is silence: the switcher visibly changes while this page does
 * not, so when a team is selected the header says the home is a system
 * console and offers the drill-down into that team's business view on
 * /performance, which does honor the workspace.
 */
function HomeHeader({ role, actions }: { role: AppRole; actions?: React.ReactNode }) {
  const { profile, user } = useAuth();
  const { workspace } = useWorkspace();
  const { state } = useApp();
  const me = state.reps.find((r) => r.id === state.currentRepId);
  const displayName = profile?.full_name || user?.email || "משתמש";
  const scopeLine =
    role === "admin" ? ADMIN_SCOPE_LABEL
    : role === "manager" ? (workspace.type === "team" ? workspace.teamName : NO_TEAM_LABEL)
    : (me?.teamName || NO_TEAM_LABEL);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">שלום, {displayName}</h1>
          <p className="text-sm text-muted-foreground mt-1">{scopeLine}</p>
        </div>
        {actions}
      </div>
      {role === "admin" && workspace.type === "team" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
          <span>
            דף הבית של מנהל המערכת הוא לוח ניהול מערכת. לצפייה בנתוני הביצועים של {workspace.teamName} עברו לעמוד הביצועים.
          </span>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/performance">
              מעבר לתצוגת {workspace.teamName}
              <ArrowLeft className="me-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Administrator — system administration console.
//
// §Role correction: admin is "מנהל מערכת", not a VP or business owner. The
// previous admin home was an organization-wide business dashboard (team cards
// with target attainment, top performers, business insights, competitions) —
// which framed the admin as the person running the business. That framing now
// belongs to team managers. The admin home is a system console: users, teams,
// representatives, data import, data readiness, and the audit trail. Every
// business page (Performance, Targets, Competitions…) remains reachable for
// support/QA — nothing was de-permissioned, only re-framed.
// ============================================================================
function AdminHome() {
  const { state } = useApp();
  const { reps } = state;
  const { teams: cloudTeams, isLoading: teamsLoading, isError: teamsError } = useVisibleTeams();
  const { isDemo } = useAppMode();

  // Same query key as /users so the two screens share one cache entry.
  const listUsersFn = useServerFn(listUsers);
  const usersQ = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => listUsersFn(),
    enabled: !isDemo,
    staleTime: 60_000,
  });
  const userRows = (usersQ.data?.users ?? []) as { active: boolean }[];
  const activeUsers = userRows.filter((u) => u.active).length;

  const activeTeams = cloudTeams.filter((t) => t.active).length;
  const teamsState = viewState({ isLoading: teamsLoading, isError: teamsError, isEmpty: cloudTeams.length === 0 });
  const repsState = viewState({ isLoading: state.repsLoading, isError: !!state.repsError, isEmpty: reps.length === 0 });
  const usersState: ViewState = isDemo ? "ready" : viewState({ isLoading: usersQ.isLoading, isError: usersQ.isError, isEmpty: userRows.length === 0 });

  return (
    <div className="space-y-8">
      <HomeHeader
        role="admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/users"><Users2 className="ms-1 h-4 w-4" />ניהול משתמשים</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/data-import"><Upload className="ms-1 h-4 w-4" />ייבוא נתונים</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/admin"><Settings className="ms-1 h-4 w-4" />ניהול המערכת</Link>
            </Button>
          </div>
        }
      />

      <DataFreshnessBar teamId={null} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          icon={Users}
          label="חשבונות משתמשים"
          value={isDemo ? "—" : String(userRows.length)}
          sub={isDemo ? "לא נטען במצב הדגמה" : `${activeUsers} פעילים`}
          state={usersState}
          to="/users"
        />
        <KPICard
          icon={UsersRound}
          label="צוותים פעילים"
          value={String(activeTeams)}
          sub={`מתוך ${cloudTeams.length} סה"כ`}
          state={teamsState}
          to="/teams"
        />
        <KPICard
          icon={Users2}
          label="נציגים"
          value={String(reps.length)}
          sub="פעילים בארגון"
          state={repsState}
          to="/representatives"
        />
      </div>

      <SystemGapsCard reps={reps} teams={cloudTeams} teamsLoading={teamsLoading} teamsError={teamsError} />

      <AdminShortcutsGrid />

      <RecentActivityCard />
    </div>
  );
}

/**
 * Structural gaps an administrator is actually responsible for closing —
 * entities whose wiring is incomplete, not business results. Performance
 * against targets, pace and competitions are deliberately absent: those
 * belong to team managers, and showing them here re-crowns the admin as a
 * business owner.
 */
function SystemGapsCard({ reps, teams, teamsLoading, teamsError }: {
  reps: Rep[];
  teams: { id: string; name: string; active: boolean }[];
  teamsLoading: boolean;
  teamsError: boolean;
}) {
  const { state } = useApp();
  const isLoading = state.repsLoading || teamsLoading;
  const isError = !!state.repsError || teamsError;
  const ready = canAssertAbsence({ isLoading, isError });

  const items = useMemo(() => {
    if (!ready) return [];
    const activeTeams = teams.filter((t) => t.active);
    const teamsWithoutReps = activeTeams.filter((t) => !reps.some((r) => r.teamId === t.id));
    const repsWithoutTeam = reps.filter((r) => !r.teamId);
    return [
      { label: "צוותים פעילים ללא נציגים", count: teamsWithoutReps.length, href: "/teams" as const },
      { label: "נציגים ללא צוות משויך", count: repsWithoutTeam.length, href: "/representatives" as const },
    ].filter((x) => x.count > 0);
  }, [ready, teams, reps]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          תקינות הגדרות המערכת
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/data-import"><Database className="ms-1 h-3.5 w-3.5" />ייבוא נתונים</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <CardSkeleton rows={2} />
        ) : isError ? (
          <ErrorState message="לא ניתן לבדוק את תקינות ההגדרות — חלק מהנתונים לא נטענו." />
        ) : items.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="אין פערים מבניים פתוחים" description="כל הצוותים הפעילים מאוישים וכל הנציגים משויכים לצוות." compact />
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.label}>
                <Link
                  to={it.href}
                  className="flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors hover:bg-accent/40"
                >
                  <span className="text-sm font-medium">{it.label}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{it.count}</Badge>
                    <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Quick links to every system-management destination, styled like /admin's cards. */
function AdminShortcutsGrid() {
  const shortcuts = [
    { title: "ניהול משתמשים", desc: "חשבונות, תפקידים וקישור נציגים", icon: Users, to: "/users" as const },
    { title: "ניהול צוותים", desc: "יצירה, עריכה והשבתה של צוותים", icon: UsersRound, to: "/teams" as const },
    { title: "ניהול נציגים", desc: "הוספה, השבתה והעברה בין צוותים", icon: Users2, to: "/representatives" as const },
    { title: "ייבוא נתונים", desc: "ייבוא קבצי ביצועים והיסטוריית ייבוא", icon: Upload, to: "/data-import" as const },
    { title: "ניהול המערכת", desc: "הודעות, תכנים ותחרויות", icon: Settings, to: "/admin" as const },
    { title: "יומן שינויים", desc: "מה השתנה בכל גרסה של Pulse", icon: FileText, to: "/changelog" as const },
  ];
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">ניהול מערכת</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {shortcuts.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.to} to={c.to} className="group focus:outline-none">
              <Card className="h-full card-interactive">
                <CardContent className="pt-5">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="mt-3 font-bold">{c.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{c.desc}</div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Team Manager
// ============================================================================
function ManagerHome() {
  const { state } = useApp();
  const { reps, announcements, competitions } = state;
  const { workspace } = useWorkspace();
  const workspaceTeamId = workspace.type === "team" ? workspace.teamId : null;
  const scopedReps = useMemo(
    () => (workspaceTeamId ? reps.filter((r) => r.teamId === workspaceTeamId) : reps),
    [reps, workspaceTeamId],
  );
  const { teams: cloudTeams, isLoading: teamsLoading, isError: teamsError } = useVisibleTeams();
  const profileByTeamId = useMemo(() => new Map(cloudTeams.map((t) => [t.id, t.kpiProfile])), [cloudTeams]);
  const teamGoal = useTeamGoal(workspaceTeamId);
  const scopedRepIds = useMemo(() => scopedReps.map((r) => r.id), [scopedReps]);
  const repGoals = useRepresentativeGoals(scopedRepIds);

  const renewal = workspaceTeamId && (profileByTeamId.get(workspaceTeamId) ?? DEFAULT_KPI_PROFILE) === "renewals"
    ? (() => {
        const totals = renewalTotalsForTeamHistorical(workspaceTeamId, state.kpiValues);
        return { totals, rate: calculateRenewalRate("renewals", totals.completed, totals.opportunities) };
      })()
    : null;

  return (
    <div className="space-y-8">
      <HomeHeader
        role="manager"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/performance"><TrendingUp className="ms-1 h-4 w-4" />עדכון ביצועים</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/feedback"><Headphones className="ms-1 h-4 w-4" />הוספת האזנה</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/targets"><Target className="ms-1 h-4 w-4" />יעדי הצוות</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/competitions"><Trophy className="ms-1 h-4 w-4" />יצירת תחרות</Link>
            </Button>
          </div>
        }
      />

      <DataFreshnessBar teamId={workspaceTeamId} />

      <MorningRoutine />

      {workspace.type === "team" && (
        <TeamCard
          teamName={workspace.teamName}
          teamActive={cloudTeams.find((t) => t.id === workspace.teamId)?.active ?? true}
          reps={scopedReps}
          teamTarget={teamGoal.targetValue}
          targetsLoading={teamGoal.isLoading || teamsLoading}
          targetsError={teamGoal.isError || teamsError}
          kpiProfile={profileByTeamId.get(workspace.teamId) ?? DEFAULT_KPI_PROFILE}
          renewal={renewal}
        />
      )}

      <InsightsCard
        reps={scopedReps}
        repGoalsByRepId={repGoals.goalsByRepId}
        isLoading={state.repsLoading || repGoals.isLoading}
        isError={!!state.repsError || repGoals.isError}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TeamPaceCard
          reps={scopedReps}
          goalsByRepId={repGoals.goalsByRepId}
          isLoading={state.repsLoading || repGoals.isLoading}
          isError={!!state.repsError || repGoals.isError}
          className="lg:col-span-2"
        />
        <TeamCompetitionsCard reps={scopedReps} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TeamFeedbackCard repIds={scopedRepIds} reps={scopedReps} className="lg:col-span-2" />
        <AnnouncementsCard announcements={announcements} isStaff />
      </div>

      <TopPerformersCard
        reps={scopedReps}
        goalsByRepId={repGoals.goalsByRepId}
        isLoading={state.repsLoading || repGoals.isLoading}
        isError={!!state.repsError || repGoals.isError}
      />

      <RecentActivityCard />

      <ContentShortcutsRow articleCount={state.articles.length} activeCompetition={competitions.find((c) => c.active)?.name ?? null} />
    </div>
  );
}

// ============================================================================
// Representative
// ============================================================================
function RepresentativeHome() {
  const { state } = useApp();
  const { reps, announcements, competitions, currentRepId } = state;
  const me = reps.find((r) => r.id === currentRepId);
  const myGoal = useRepresentativeGoal(me?.id ?? null);
  const wdRemaining = workdaysRemaining();
  const wdTotal = workdaysInMonth();

  // §P1: "no personal target" is a claim about the world, sayable only once
  // the query that would have proved otherwise has actually succeeded. Before
  // this, a representative whose target query was still in flight — or had
  // failed — was told "לא הוגדר יעד אישי לחודש זה" and invited to contact
  // their manager about a target that existed.
  const targetsSettled = canAssertAbsence({ isLoading: myGoal.isLoading, isError: myGoal.isError });
  const hasTarget = targetsSettled && myGoal.targetValue !== null;
  const pct = hasTarget && me ? calculateAchievement(me.currentResult, myGoal.targetValue as number) : null;
  const remaining = hasTarget && me ? Math.max(0, (myGoal.targetValue as number) - me.currentResult) : null;
  const perDay = remaining !== null && wdRemaining > 0 ? Math.ceil(remaining / wdRemaining) : null;

  return (
    <div className="space-y-8">
      <HomeHeader role="representative" />

      <DataFreshnessBar teamId={me?.teamId ?? null} />

      {state.repsLoading ? (
        <CardSkeleton rows={2} />
      ) : state.repsError ? (
        <ErrorState message={state.repsError} />
      ) : me ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {myGoal.isLoading ? (
            <Card className="sm:col-span-2 lg:col-span-3"><CardContent className="pt-5"><CardSkeleton rows={1} /></CardContent></Card>
          ) : myGoal.isError ? (
            <Card className="sm:col-span-2 lg:col-span-3"><CardContent className="pt-5">
              <ErrorState message="לא ניתן לטעון את היעד האישי שלך כרגע." compact />
            </CardContent></Card>
          ) : hasTarget ? (
            <>
              <KPICard icon={Target} label="היעד שלי" value={formatNum(myGoal.targetValue as number)} sub="יחידות לחודש" />
              <KPICard icon={Gauge} label="ביצוע נוכחי" value={formatNum(me.currentResult)} sub={pct !== null ? `${formatPct(pct)} מהיעד` : undefined} />
              <KPICard icon={TrendingUp} label="נותר ליעד" value={formatNum(remaining ?? 0)} sub={perDay !== null ? `~${perDay}/יום` : undefined} />
            </>
          ) : (
            <Card className="sm:col-span-2 lg:col-span-3">
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-primary"><Target className="h-4 w-4" /></div>
                  <div>
                    <div className="font-semibold">לא הוגדר יעד אישי לחודש זה</div>
                    <div className="text-xs text-muted-foreground mt-0.5">ביצוע נוכחי: {formatNum(me.currentResult)} יחידות. פנו למנהל/ת הצוות להגדרת יעד רשמי.</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          <KPICard icon={CalendarClock} label="ימי עבודה שנותרו" value={String(wdRemaining)} sub={`מתוך ${wdTotal} בחודש`} />
        </div>
      ) : (
        <EmptyState icon={Users2} title="אין עדיין נתוני ביצוע" description="נתוני היעד והביצוע שלך יופיעו כאן לאחר עדכון ראשוני." compact />
      )}

      {/*
        §MVP. "המשוב שלי" was previously a card whose entire content was a link
        to /feedback — it asserted nothing and could not tell a representative
        whether there was anything waiting for them. It now renders the actual
        published evaluations, and keeps the link for the full history.
      */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MyFeedbackCard repId={currentRepId} />
        <MyCompetitionsCard repId={me?.id ?? null} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MyTasksCard repId={me?.id ?? null} />
        <AnnouncementsCard announcements={announcements} isStaff={false} />
      </div>

      <ContentShortcutsRow articleCount={state.articles.length} activeCompetition={competitions.find((c) => c.active)?.name ?? null} />
    </div>
  );
}

function TopPerformersCard({ reps, goalsByRepId, isLoading, isError, className }: {
  reps: Rep[]; goalsByRepId: Map<string, number>; isLoading?: boolean; isError?: boolean; className?: string;
}) {
  // Only representatives with an official personal target this month can be
  // ranked by achievement — never fabricate a pct for one that has none.
  const top3 = reps
    .filter((r) => goalsByRepId.has(r.id))
    .map((r) => ({ ...r, pct: calculateAchievement(r.currentResult, goalsByRepId.get(r.id) as number) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  return (
    <Card className={cn("card-interactive", className)}>
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
        {isLoading ? (
          <CardSkeleton rows={3} />
        ) : isError ? (
          <ErrorState message="לא ניתן לדרג נציגים — נתוני היעדים לא נטענו." compact />
        ) : top3.length === 0 ? (
          <EmptyState
            icon={Award}
            title={reps.length === 0 ? "אין נציגים להצגה עדיין" : "לא הוגדרו יעדים אישיים החודש"}
            description={reps.length > 0 ? "לא ניתן לדרג ביצועים ללא יעד רשמי לכל נציג." : undefined}
            compact
          />
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
  );
}

function AnnouncementsCard({ announcements, isStaff }: { announcements: { id: string; title: string; date: string; body: string }[]; isStaff: boolean }) {
  return (
    <Card className="card-interactive">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-4 w-4 text-primary" />
          הודעות אחרונות
        </CardTitle>
        {isStaff && (
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">עבור לטיפול</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {announcements.length === 0 ? (
          <EmptyState icon={Megaphone} title="אין הודעות פעילות כרגע" compact />
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
  );
}

function ContentShortcutsRow({ articleCount, activeCompetition }: { articleCount: number; activeCompetition: string | null }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="card-interactive">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />מרכז ידע
          </CardTitle>
          <Badge variant="outline">{articleCount} מאמרים</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">מאמרים, תסריטי שיחה והדרכות לצוותי המכירות.</p>
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
          {activeCompetition && <Badge className="bg-primary/10 text-primary hover:bg-primary/10">פעילה</Badge>}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">{activeCompetition ?? "אין תחרות פעילה כרגע."}</p>
          <Button asChild size="sm">
            <Link to="/competitions"><Trophy className="ms-1 h-4 w-4" />צפייה בטבלה</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function KPICard({
  icon: Icon, label, value, sub, tone, trend, state, to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string;
  tone?: "success" | "warning" | "danger";
  trend?: { dir: "up" | "down"; text: string };
  state?: ViewState;
  /** Makes the whole card a drill-down. */
  to?: "/teams" | "/representatives" | "/performance" | "/competitions" | "/targets" | "/users";
}) {
  const color = tone === "success" ? "text-success-foreground" : tone === "danger" ? "text-primary" : tone === "warning" ? "text-warning-foreground" : "text-foreground";
  const TrendIcon = trend?.dir === "down" ? TrendingDown : TrendingUp;
  const trendColor = trend?.dir === "up" ? "text-success-foreground" : "text-primary";

  const body = (
    <CardContent className="pt-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-muted-foreground font-medium">{label}</div>
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      {state === "loading" ? (
        <div className="mt-2 h-9 w-20 animate-pulse rounded bg-muted" aria-label="טוען" />
      ) : state === "error" ? (
        <div className="mt-2 text-2xl font-extrabold text-destructive">—</div>
      ) : (
        <div className={cn("mt-2 text-2xl md:text-3xl font-extrabold truncate", color)}>{value}</div>
      )}
      <div className="flex items-center justify-between gap-2 mt-1">
        {state === "error" ? (
          <div className="text-xs text-destructive">שגיאה בטעינה — הערך אינו זמין</div>
        ) : state === "loading" ? null : sub ? (
          <div className="text-xs text-muted-foreground">{sub}</div>
        ) : null}
        {trend && state !== "loading" && state !== "error" && (
          <div className={cn("flex items-center gap-1 text-xs font-semibold", trendColor)}>
            <TrendIcon className="h-3 w-3" />
            <span>{trend.text}</span>
          </div>
        )}
      </div>
    </CardContent>
  );

  if (to) {
    return (
      <Card className="card-interactive">
        <Link to={to} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link>
      </Card>
    );
  }
  return <Card className="card-interactive">{body}</Card>;
}

type TeamCardRenewal = { totals: { opportunities: number | null; completed: number | null }; rate: ReturnType<typeof calculateRenewalRate> };

/**
 * teamTarget is the official monthly team target (team_goals), never a sum of
 * representative targets.
 *
 * §P1: `null` no longer means "no target set" on its own — it means that only
 * once targetsLoading and targetsError are both false. While the goals query
 * is pending or failed the card says so, instead of asserting the absence of
 * a target and offering a button to create one that already exists.
 */
function TeamCard({ teamName, teamActive, reps, teamTarget, targetsLoading, targetsError, kpiProfile, renewal }: {
  teamName: string; teamActive?: boolean; reps: Rep[]; teamTarget: number | null;
  targetsLoading?: boolean; targetsError?: boolean;
  kpiProfile?: KpiProfile;
  renewal?: TeamCardRenewal | null;
}) {
  const Icon = Users2;
  const result = reps.reduce((a, r) => a + r.currentResult, 0);
  const settled = canAssertAbsence({ isLoading: !!targetsLoading, isError: !!targetsError });
  const hasTarget = settled && teamTarget !== null;
  const pct = hasTarget ? calculateAchievement(result, teamTarget as number) : null;
  const onTrack = pct !== null && pct >= 80;
  return (
    <Card className="card-interactive">
      <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <CardTitle className="flex items-center gap-2 text-base min-w-0">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <span className="truncate">{teamName}</span>
          {teamActive === false && <Badge variant="outline" className="shrink-0">מושבת</Badge>}
          {kpiProfile && <Badge variant="secondary" className={cn("shrink-0", KPI_PROFILE_BADGE_CLASS[kpiProfile])}>{KPI_PROFILE_LABEL[kpiProfile]}</Badge>}
        </CardTitle>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline">{reps.length} נציגים</Badge>
          {hasTarget && pct !== null && (
            <Badge
              variant="secondary"
              className={cn(onTrack ? "bg-[color:var(--success)]/10 text-success-foreground" : "bg-primary/10 text-primary")}
            >
              {formatPct(pct)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* §P2: an active team with no representatives is a real, actionable
            state. It used to be counted in the KPI above and then never
            rendered at all, so nothing said which team was empty. */}
        {reps.length === 0 && (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            אין נציגים פעילים בצוות זה. לא ניתן לחשב ביצוע עד לשיוך נציגים.
          </div>
        )}
        {targetsLoading ? (
          <CardSkeleton rows={1} />
        ) : targetsError ? (
          <ErrorState message="לא ניתן לטעון את יעד הצוות." compact />
        ) : hasTarget ? (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-xs text-muted-foreground">יעד צוות</div>
                <div className="font-bold">{formatNum(teamTarget as number)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">ביצוע</div>
                <div className="font-bold">{formatNum(result)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">נותר</div>
                <div className="font-bold">{formatNum(Math.max(0, (teamTarget as number) - result))}</div>
              </div>
            </div>
            <Progress value={Math.min(pct ?? 0, 150)} className="h-2" />
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            לא הוגדר יעד חודשי לצוות זה · ביצוע נוכחי: {formatNum(result)} יחידות
          </div>
        )}
        {renewal && (
          <div className="rounded-lg border p-2.5 text-xs">
            {/* Labeled with its period, because the totals default to the
                current month while the numbers beside them are month-to-date
                too — an unlabeled figure invites the reader to assume
                whichever period suits them. */}
            <div className="font-semibold mb-1.5">מדדי חידושים · החודש</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-muted-foreground">הזדמנויות</div>
                <div className="font-bold">{renewal.totals.opportunities == null ? "—" : formatNum(renewal.totals.opportunities)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">חידושים</div>
                <div className="font-bold">{renewal.totals.completed == null ? "—" : formatNum(renewal.totals.completed)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">אחוז חידוש</div>
                <div className="font-bold">{renewal.rate.available ? formatPct(renewal.rate.pct) : "לא זמין"}</div>
              </div>
            </div>
            {!renewal.rate.available && (
              <div className="mt-1.5 text-muted-foreground">{RENEWAL_RATE_UNAVAILABLE_LABEL[renewal.rate.reason]}</div>
            )}
          </div>
        )}
        <div className="pt-1 flex gap-2">
          <Button asChild variant="ghost" size="sm" className="flex-1 justify-center">
            <Link to="/performance">צפייה בביצועי הצוות</Link>
          </Button>
          {/* The CTA is gated on the absence being CONFIRMED, never on a
              pending or failed query (§P1: no CTA based on unconfirmed absence). */}
          {settled && !hasTarget && (
            <Button asChild variant="outline" size="sm" className="flex-1 justify-center">
              <Link to="/targets"><Target className="ms-1 h-3.5 w-3.5" />הגדרת יעד</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InsightsCard({ reps, repGoalsByRepId, teamGoalsByTeamId, isLoading, isError }: {
  reps: Rep[]; repGoalsByRepId: Map<string, number>; teamGoalsByTeamId?: Map<string, number>;
  isLoading?: boolean; isError?: boolean;
}) {
  const wdTotal = workdaysInMonth();
  const wdPassed = workdaysPassed();
  const insights = useMemo(
    () => (isLoading || isError ? [] : buildInsights(reps, repGoalsByRepId, teamGoalsByTeamId, wdTotal, wdPassed)),
    [reps, repGoalsByRepId, teamGoalsByTeamId, isLoading, isError, wdTotal, wdPassed],
  );
  // Insights are supplementary — while data is loading or broken the card
  // stays out of the way rather than publishing a half-computed conclusion.
  if (isLoading || isError || insights.length === 0) return null;
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

/**
 * Every insight is computed only from representatives/teams that have an
 * official target for the month — a rep or team with no target is excluded,
 * never assigned a fabricated 0%/100%.
 *
 * §P2 support threshold. The "needs support" insight used to be
 * unconditional: `bottom = withPct[withPct.length - 1]` — literally whoever
 * sorted last — with no floor at all, so on a team where everyone beat target
 * it announced that the representative at 145% "דורש/ת ליווי". It now goes
 * through repsNeedingSupport, which measures pace via the shared primitive.
 * Someone has to be last on every list; that is not a finding, and saying it
 * about a person who is exceeding their target is simply false.
 */
export function buildInsights(
  reps: Rep[],
  repGoalsByRepId: Map<string, number>,
  teamGoalsByTeamId: Map<string, number> | undefined,
  workdaysTotal: number,
  workdaysPassedCount: number,
): string[] {
  const list: string[] = [];

  if (teamGoalsByTeamId) {
    const groups = teamsFromReps(reps);
    const withPctByTeam = groups
      .map((g) => {
        const target = teamGoalsByTeamId.get(g.teamId);
        if (target === undefined) return null;
        const result = reps.filter((r) => r.teamId === g.teamId).reduce((a, r) => a + r.currentResult, 0);
        return { name: g.teamName, pct: calculateAchievement(result, target) };
      })
      .filter((x): x is { name: string; pct: number } => x !== null);
    if (withPctByTeam.length >= 2) {
      withPctByTeam.sort((a, b) => b.pct - a.pct);
      const top = withPctByTeam[0];
      const bottom = withPctByTeam[withPctByTeam.length - 1];
      const gap = Math.round(top.pct - bottom.pct);
      if (gap !== 0) {
        list.push(`שיעור העמידה ביעד של ${top.name} גבוה ב־${Math.abs(gap)}% מ־${bottom.name}.`);
      }
    }
  }

  const withPct = reps
    .filter((r) => repGoalsByRepId.has(r.id))
    .map((r) => ({ ...r, pct: calculateAchievement(r.currentResult, repGoalsByRepId.get(r.id) as number) }))
    .sort((a, b) => b.pct - a.pct);
  if (withPct[0]) list.push(`${withPct[0].name} מוביל/ה את החודש עם ${formatPct(withPct[0].pct)} עמידה ביעד.`);

  const supportInputs: SupportInput[] = withPct.map((r) => ({
    repId: r.id,
    repName: r.name,
    achievementPct: r.pct,
    currentResult: r.currentResult,
    target: repGoalsByRepId.get(r.id) ?? null,
    workdaysTotal,
    workdaysPassed: workdaysPassedCount,
  }));
  const needing = repsNeedingSupport(supportInputs);
  if (needing.length === 1) {
    list.push(`${needing[0].repName} מתחת לקצב הנדרש — עמידה של ${formatPct(needing[0].achievementPct ?? 0)}.`);
  } else if (needing.length > 1) {
    list.push(`${needing.length} נציגים מתחת לקצב הנדרש החודש ודורשים ליווי.`);
  }

  return list;
}

/**
 * §P1 honest activity feed.
 *
 * This read public.activity_events — a table with a `USING (true)` SELECT
 * policy, readable by every authenticated user in the organization,
 * representatives included — populated by exactly two writers, both feedback
 * publishes, while rendering five event kinds and a badge showing
 * `activity.length`, which was capped by the query's own `limit: 30` and
 * therefore reported the fetch limit as a fact about the business.
 *
 * It is now built from audit_log via listDashboardActivity, which authorizes
 * the caller, scopes rows server-side (admin org-wide; manager only entries
 * about representatives or teams they manage), and projects a whitelisted set
 * of actions. Every kind rendered has a real producer, the count is real, and
 * loading/error/empty are distinct.
 */
function RecentActivityCard() {
  const { workspace } = useWorkspace();
  const { isDemo } = useAppMode();
  const load = useServerFn(listDashboardActivity);
  const [items, setItems] = useState<DashboardActivityItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the retry button so the effect re-runs a real fetch.
  const [retryToken, setRetryToken] = useState(0);
  const teamId = workspace.type === "team" ? workspace.teamId : null;

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    setError(null);
    setItems(null);
    load({ data: { team_id: teamId, limit: 6 } })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [isDemo, teamId, load, retryToken]);

  const iconFor = (kind: string) => {
    if (kind === "performance") return BarChart3;
    if (kind === "competition") return Trophy;
    if (kind === "knowledge") return FileText;
    if (kind === "feedback") return MessageSquare;
    if (kind === "underwriting") return AlertTriangle;
    return Users;
  };

  if (isDemo) return null;

  return (
    <Card className="card-interactive">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          פעילות אחרונה
        </CardTitle>
        {items !== null && !error && <Badge variant="outline">{total}</Badge>}
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorState message={error} onRetry={() => setRetryToken((n) => n + 1)} compact />
        ) : items === null ? (
          <CardSkeleton rows={3} />
        ) : items.length === 0 ? (
          <EmptyState icon={Activity} title="אין פעילות אחרונה להצגה" compact />
        ) : (
          <ul className="divide-y">
            {items.map((a) => {
              const Icon = iconFor(a.kind);
              return (
                <li key={a.id}>
                  <Link
                    to={a.href}
                    className="flex items-start gap-3 py-3 transition-colors hover:bg-accent/40 -mx-2 px-2 rounded-md"
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground">
                        {a.label}
                        {a.representativeName ? ` · ${a.representativeName}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatDateIL(a.createdAt.slice(0, 10))}
                        {a.actorName ? ` · ${a.actorName}` : ""}
                      </div>
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
