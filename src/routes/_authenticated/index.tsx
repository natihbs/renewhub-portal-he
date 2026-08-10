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
import {
  formatDateIL,
  formatMonthIL,
  formatNum,
  formatPct,
  workdaysRemaining,
  workdaysInMonth,
  workdaysPassed,
} from "@/lib/format";
import { calculateAchievement, DEFAULT_KPI_PROFILE, KPI_PROFILE_LABEL, KPI_PROFILE_BADGE_CLASS, type KpiProfile } from "@/lib/performance-domain";
import { useVisibleTeams } from "@/lib/teams-hooks";
import {
  calculateAssignedRenewalRate,
  ASSIGNED_RENEWAL_RATE_UNAVAILABLE_LABEL,
  ASSIGNED_RENEWALS_LABEL,
  CLOSED_RENEWALS_LABEL,
  PERSONAL_RENEWAL_RATE_LABEL,
  type AssignedRenewalRateResult,
} from "@/lib/renewal-rate";
import { useWorkspace, managerScopeLabel } from "@/lib/workspace-context";
import { useBusinessScope } from "@/lib/business-scope-hooks";
import {
  aggregateByProfile,
  buildScopeTeamRows,
  groupScopeRows,
  isScopedManagerKind,
  managerHeaderPrimaryLine,
  missingTargetsByTeam,
  SCOPE_SELECT_TEAM_HINT,
  SCOPE_SELECTED_TEAM_SECTION_TITLE,
  SCOPE_TARGETS_ACTION_LABEL,
  TEAM_TARGETS_ACTION_LABEL,
  type ScopedManagerKind,
  type ScopeHomeTeamInput,
} from "@/lib/scope-home";
import { ScopeMissingTargetsCard, ScopeOverviewCard } from "@/components/ScopeHomeCards";
import {
  useTeamGoal,
  useTeamGoals,
  useRepresentativeGoal,
  useRepresentativeGoals,
  currentGoalMonth,
} from "@/lib/goals-hooks";
import { listUsers } from "@/lib/user-admin.functions";
import { useRealAppRole, useResolvedRole } from "@/lib/use-resolved-role";
import type { AppRole } from "@/lib/navigation-config";
import {
  repsNeedingSupport, viewState, canAssertAbsence, computeStructuralGaps,
  type SupportInput, type ViewState,
} from "@/lib/dashboard-domain";
import { listDashboardActivity, type DashboardActivityItem } from "@/lib/dashboard.functions";
import {
  Users2, TrendingUp, TrendingDown, Award, Trophy, Headphones, BookOpen, Megaphone,
  Target, Gauge, CalendarClock, Lightbulb, Sparkles, Users, Activity, BarChart3, FileText, MessageSquare,
  UsersRound, AlertTriangle, ShieldCheck, RefreshCw, ArrowLeft, Database, Upload, Settings,
} from "lucide-react";
import { MorningRoutine } from "@/components/MorningRoutine";
import { ManualPerformanceDialog } from "@/components/ManualPerformanceDialog";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  DataFreshnessBar, TeamPaceCard, TeamFeedbackCard, TeamCompetitionsCard,
  MyFeedbackCard, MyCompetitionsCard, MyTasksCard,
} from "@/components/HomeCards";
import {
  HeroPanel,
  HeroStat,
  InitialsAvatar,
  ProgressRing,
  RankedRow,
  SectionHeading,
  StatTile,
} from "@/components/dashboard/Surfaces";
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
  const realRole = useRealAppRole();
  const { state } = useApp();
  const { workspace } = useWorkspace();
  if (role === "admin") return <AdminHome />;
  if (role === "manager") {
    // An admin lands in manager view still carrying their org-wide workspace —
    // a scope no real manager has. Rendering ManagerHome over the whole
    // organization would present a fake manager view, so ask for a team
    // instead. Only for real admins: a real manager's workspace is always one
    // of their own teams and this branch never triggers for them.
    if (realRole === "admin" && workspace.type !== "team") {
      return (
        <EmptyState
          icon={UsersRound}
          title="בחרו צוות לתצוגה"
          description="תצוגת מנהל צוות מציגה צוות אחד. בחרו צוות בבורר שבסרגל העליון כדי לצפות בו כפי שמנהל הצוות רואה אותו."
        />
      );
    }
    return <ManagerHome />;
  }
  // An admin viewing the representative presentation has no representative of
  // their own — RepresentativeHome would render a wall of per-rep cards each
  // explaining its own emptiness. Say the real situation once, honestly, and
  // never invent a representative to show instead.
  if (realRole === "admin" && !state.currentRepId) {
    return (
      <EmptyState
        icon={Users2}
        title="לא נבחר נציג לתצוגה"
        description="תצוגת נציג מציגה את המסך האישי של הנציג המחובר. לחשבון מנהל המערכת אין נציג משויך, ולכן אין נתונים אישיים להצגה."
      />
    );
  }
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
const ROLE_EYEBROW: Record<AppRole, string> = {
  admin: "קונסולת מערכת",
  manager: "לוח הניהול שלי",
  representative: "המסך שלי",
};

function HomeHeader({
  role,
  actions,
  metrics,
}: {
  role: AppRole;
  actions?: React.ReactNode;
  /** Hero-weight figures rendered beside the greeting on wide screens. */
  metrics?: React.ReactNode;
}) {
  const { profile, user } = useAuth();
  const { workspace, ready } = useWorkspace();
  const { state } = useApp();
  const { teams: visibleTeams } = useVisibleTeams();
  const me = state.reps.find((r) => r.id === state.currentRepId);
  const displayName = profile?.full_name || user?.email || "משתמש";
  // Managed teams = teams.manager_id names this user — the ownership source.
  // profiles.team_id is profile membership and is never consulted here, so a
  // manager whose profile points at a team they don't manage can't get a
  // wrong label from it (and one who does manage their team can't lose it).
  const managedTeams = useMemo(
    () => visibleTeams.filter((t) => t.managerId === user?.id),
    [visibleTeams, user],
  );
  // The resolved BUSINESS scope (מנהל צוות / מנהל מוקד / מנהל פעילות /
  // סמנכ"ל) — a manager-only "היקף צפייה" line. Admin keeps the system-
  // administrator framing and never gets a business-executive label;
  // representatives see only their own team name above.
  const { scope: businessScope } = useBusinessScope();
  // A business-scope manager's identity line is their business title
  // ("מנהל מוקד · דירות וחידושים") — having no profile team and no direct
  // teams.manager_id rows is a VALID setup for them, so they must never see
  // the "לא הוגדר צוות לניהול" warning. Everyone else keeps the exact
  // workspace-derived label they had.
  const scopeLine =
    role === "admin"
      ? ADMIN_SCOPE_LABEL
      : role === "manager"
        ? managerHeaderPrimaryLine(
            businessScope,
            managerScopeLabel({ workspace, managedTeams, ready }),
          )
        : me?.teamName || NO_TEAM_LABEL;

  return (
    <div className="space-y-3">
      {/* Hero zone: identity and the month's headline figures on one dominant
          brand surface, so the first screen has an obvious entry point
          instead of an even stack of equal cards. */}
      <HeroPanel>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
              {ROLE_EYEBROW[role]}
            </div>
            <h1 className="mt-1.5 font-display text-2xl font-extrabold tracking-tight md:text-3xl">
              שלום, {displayName}
            </h1>
            <p className="mt-1 text-sm text-white/75">{scopeLine}</p>
            {role === "manager" && businessScope?.scopeLabel && (
              <p className="mt-0.5 text-xs text-white/60">{businessScope.scopeLabel}</p>
            )}
          </div>
          {metrics}
        </div>
      </HeroPanel>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
        metrics={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:w-auto">
            <HeroStat
              label="חשבונות"
              value={isDemo || usersState !== "ready" ? "—" : String(userRows.length)}
              sub={isDemo ? "מצב הדגמה" : usersState === "ready" ? `${activeUsers} פעילים` : "לא נטען"}
            />
            <HeroStat
              label="צוותים פעילים"
              value={teamsState === "error" ? "—" : String(activeTeams)}
              sub={`מתוך ${cloudTeams.length}`}
            />
            <HeroStat
              label="נציגים"
              value={repsState === "error" ? "—" : String(reps.length)}
              sub="פעילים בארגון"
            />
          </div>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/users"><Users2 className="ms-1 h-4 w-4" />ניהול משתמשים</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/data-import"><Upload className="ms-1 h-4 w-4" />ייבוא נתונים</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/admin"><Settings className="ms-1 h-4 w-4" />ניהול המערכת</Link>
            </Button>
          </>
        }
      />

      <DataFreshnessBar teamId={null} />

      <div className="space-y-3">
        <SectionHeading title="מצב המערכת" hint="לחיצה על כרטיס פותחת את מסך הניהול המתאים" />
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
  teams: { id: string; name: string; active: boolean; managerId: string | null }[];
  teamsLoading: boolean;
  teamsError: boolean;
}) {
  const { state } = useApp();
  const isLoading = state.repsLoading || teamsLoading;
  const isError = !!state.repsError || teamsError;
  const ready = canAssertAbsence({ isLoading, isError });

  const items = useMemo(() => {
    if (!ready) return [];
    return computeStructuralGaps(
      teams.map((t) => ({ id: t.id, name: t.name, active: t.active, managerId: t.managerId })),
      reps.map((r) => ({ teamId: r.teamId })),
    );
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
          <EmptyState icon={ShieldCheck} title="אין פערים מבניים פתוחים" description="לכל צוות מאויש מוגדר מנהל צוות, כל הצוותים הפעילים מאוישים וכל הנציגים משויכים לצוות." compact />
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
      <SectionHeading title="ניהול מערכת" />
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
  const { workspace, setWorkspaceTeam } = useWorkspace();
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

  // Business-scope managers (מנהל מוקד / מנהל פעילות / סמנכ"ל) lead with the
  // TEAMS in their scope, grouped by their hierarchy level; the single
  // selected team becomes the secondary drill-down. A plain team manager
  // keeps the unchanged single-team layout below.
  const { scope, isLoading: scopeLoading, isError: scopeError } = useBusinessScope();
  const scopedManager = isScopedManagerKind(scope?.kind);
  const scopeTeamInputs = useMemo<ScopeHomeTeamInput[]>(() => {
    if (!scopedManager || !scope) return [];
    const unitByTeam = new Map(scope.teamUnits.map((t) => [t.id, t.businessUnitId]));
    return scope.teams.map((t) => ({
      id: t.id,
      name: t.name,
      kpiProfile: profileByTeamId.get(t.id) ?? DEFAULT_KPI_PROFILE,
      businessUnitId: unitByTeam.get(t.id) ?? null,
    }));
  }, [scopedManager, scope, profileByTeamId]);
  const scopeTeamIds = useMemo(() => scopeTeamInputs.map((t) => t.id), [scopeTeamInputs]);
  const scopeAllReps = useMemo(() => {
    const ids = new Set(scopeTeamIds);
    return reps.filter((r) => r.teamId && ids.has(r.teamId));
  }, [reps, scopeTeamIds]);
  const scopeTeamGoals = useTeamGoals(scopeTeamIds);
  const scopeAllRepIds = useMemo(() => scopeAllReps.map((r) => r.id), [scopeAllReps]);
  const scopeRepGoals = useRepresentativeGoals(scopeAllRepIds);
  const scopeRows = useMemo(
    () =>
      buildScopeTeamRows({
        teams: scopeTeamInputs,
        reps: scopeAllReps.map((r) => ({
          id: r.id,
          teamId: r.teamId,
          currentResult: r.currentResult,
        })),
        goalsByTeamId: scopeTeamGoals.goalsByTeamId,
        goalsByRepId: scopeRepGoals.goalsByRepId,
      }),
    [scopeTeamInputs, scopeAllReps, scopeTeamGoals.goalsByTeamId, scopeRepGoals.goalsByRepId],
  );
  const scopeGroups = useMemo(
    () =>
      scopedManager && scope
        ? groupScopeRows({
            kind: scope.kind as ScopedManagerKind,
            rows: scopeRows,
            units: scope.units,
          })
        : [],
    [scopedManager, scope, scopeRows],
  );
  const scopeAggregates = useMemo(() => aggregateByProfile(scopeRows), [scopeRows]);
  const scopeMissing = useMemo(() => missingTargetsByTeam(scopeRows), [scopeRows]);
  const scopeCardsLoading =
    scopeLoading ||
    teamsLoading ||
    state.repsLoading ||
    scopeTeamGoals.isLoading ||
    scopeRepGoals.isLoading;
  const scopeCardsError =
    scopeError ||
    teamsError ||
    !!state.repsError ||
    scopeTeamGoals.isError ||
    scopeRepGoals.isError;

  // Renewals business model: the team's official monthly goal IS the assigned
  // renewal book (מיועדות חודשיות) and current_result is closed renewals — so
  // the rate is computable from data this screen already has, with or without
  // imported kpi_values.
  const renewal = workspaceTeamId && (profileByTeamId.get(workspaceTeamId) ?? DEFAULT_KPI_PROFILE) === "renewals"
    ? (() => {
        const completed = scopedReps.reduce((a, r) => a + r.currentResult, 0);
        const assigned = teamGoal.targetValue ?? null;
        return { assigned, completed, rate: calculateAssignedRenewalRate("renewals", completed, assigned) };
      })()
    : null;

  return (
    <div className="space-y-8">
      <HomeHeader
        role="manager"
        actions={
          <div className="flex flex-wrap gap-2">
            <ManualPerformanceDialog
              sourceScreen="manager-home"
              trigger={
                <Button variant="outline" size="sm">
                  <TrendingUp className="ms-1 h-4 w-4" />
                  עדכון ביצועים ידני
                </Button>
              }
            />
            <Button asChild variant="outline" size="sm">
              <Link to="/feedback"><Headphones className="ms-1 h-4 w-4" />הוספת האזנה</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              {/* One selected team is a team-manager assumption — a scope
                  manager sets targets across teams, so the label says so. */}
              <Link to="/targets">
                <Target className="ms-1 h-4 w-4" />
                {scopedManager ? SCOPE_TARGETS_ACTION_LABEL : TEAM_TARGETS_ACTION_LABEL}
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/competitions"><Trophy className="ms-1 h-4 w-4" />יצירת תחרות</Link>
            </Button>
          </div>
        }
      />

      {/* §Simplification (progressive disclosure): the first screen answers
          only the manager's four operating questions — how fresh is the data,
          where does the team stand against this month's target, who is off
          pace, and what do I do next (header quick actions). Everything else
          stays one click away in collapsed sections below; nothing was
          removed. */}
      <DataFreshnessBar teamId={workspaceTeamId} />

      {/* A business-scope manager's PRIMARY view is the teams in their scope
          — grouped by their level, labeled by each team's own KPI profile —
          with missing targets broken down by team. The per-rep pace detail
          becomes a drill-down into the selected team below. A plain team
          manager keeps the exact single-team layout. */}
      {scopedManager && (
        <>
          <ScopeOverviewCard
            groups={scopeGroups}
            aggregates={scopeAggregates}
            isLoading={scopeCardsLoading}
            isError={scopeCardsError}
            onSelectTeam={setWorkspaceTeam}
          />
          <ScopeMissingTargetsCard
            rows={scopeMissing}
            isLoading={scopeCardsLoading}
            isError={scopeCardsError}
          />
        </>
      )}

      {!scopedManager && workspace.type === "team" && (
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

      {!scopedManager && (
        <TeamPaceCard
          reps={scopedReps}
          goalsByRepId={repGoals.goalsByRepId}
          isLoading={state.repsLoading || repGoals.isLoading}
          isError={!!state.repsError || repGoals.isError}
        />
      )}

      {/* For a scope manager the per-rep pace detail is SECONDARY: it lives
          behind the selected-team fold, not on the first screen. */}
      {scopedManager && (
        <CollapsibleSection title={SCOPE_SELECTED_TEAM_SECTION_TITLE}>
          {workspace.type === "team" ? (
            <div className="space-y-4">
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
              <TeamPaceCard
                reps={scopedReps}
                goalsByRepId={repGoals.goalsByRepId}
                isLoading={state.repsLoading || repGoals.isLoading}
                isError={!!state.repsError || repGoals.isError}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
              {SCOPE_SELECT_TEAM_HINT}
            </div>
          )}
        </CollapsibleSection>
      )}

      <CollapsibleSection title="שגרת בוקר מלאה">
        <MorningRoutine />
      </CollapsibleSection>

      <CollapsibleSection title="תובנות ומצטיינים">
        <InsightsCard
          reps={scopedReps}
          repGoalsByRepId={repGoals.goalsByRepId}
          isLoading={state.repsLoading || repGoals.isLoading}
          isError={!!state.repsError || repGoals.isError}
        />
        <TopPerformersCard
          reps={scopedReps}
          goalsByRepId={repGoals.goalsByRepId}
          isLoading={state.repsLoading || repGoals.isLoading}
          isError={!!state.repsError || repGoals.isError}
        />
      </CollapsibleSection>

      <CollapsibleSection title="משוב, תחרויות והודעות">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <TeamFeedbackCard repIds={scopedRepIds} reps={scopedReps} className="lg:col-span-2" />
          <TeamCompetitionsCard reps={scopedReps} />
        </div>
        <AnnouncementsCard announcements={announcements} isStaff />
      </CollapsibleSection>

      <CollapsibleSection title="פעילות אחרונה וקיצורי תוכן">
        <RecentActivityCard />
        <ContentShortcutsRow articleCount={state.articles.length} activeCompetition={competitions.find((c) => c.active)?.name ?? null} />
      </CollapsibleSection>
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
  // Renewals wording: for a renewals-profile team the personal goal IS the
  // assigned renewal book, so the cards speak the business language.
  const { teams: repHomeTeams } = useVisibleTeams();
  const isRenewals =
    !!me?.teamId &&
    (repHomeTeams.find((t) => t.id === me.teamId)?.kpiProfile ?? DEFAULT_KPI_PROFILE) ===
      "renewals";
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

      {/* No freshness bar here — import freshness is an operator's concern
          (manager/admin homes keep it). A representative can't act on "טרם
          בוצע ייבוא נתונים", and the warning read as if something was wrong
          with THEIR data. Real loading/error states on the personal cards
          below are untouched. */}

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
              <KPICard
                icon={Target}
                label={isRenewals ? ASSIGNED_RENEWALS_LABEL : "היעד שלי"}
                value={formatNum(myGoal.targetValue as number)}
                sub={`יעד ${formatMonthIL(currentGoalMonth())}`}
              />
              <KPICard
                icon={Gauge}
                label={isRenewals ? CLOSED_RENEWALS_LABEL : "ביצוע נוכחי"}
                value={formatNum(me.currentResult)}
                sub={
                  pct !== null
                    ? isRenewals
                      ? `${formatPct(pct)} ${PERSONAL_RENEWAL_RATE_LABEL}`
                      : `${formatPct(pct)} מהיעד`
                    : undefined
                }
              />
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

type TeamCardRenewal = { assigned: number | null; completed: number; rate: AssignedRenewalRateResult };

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
                <div className="text-xs text-muted-foreground">יעד {formatMonthIL(currentGoalMonth())}</div>
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
            לא הוגדר יעד לצוות זה לחודש {formatMonthIL(currentGoalMonth())} · ביצוע נוכחי: {formatNum(result)} יחידות
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
                <div className="text-muted-foreground">{ASSIGNED_RENEWALS_LABEL}</div>
                <div className="font-bold">{renewal.assigned == null ? "—" : formatNum(renewal.assigned)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{CLOSED_RENEWALS_LABEL}</div>
                <div className="font-bold">{formatNum(renewal.completed)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">אחוז חידוש</div>
                <div className="font-bold">{renewal.rate.available ? formatPct(renewal.rate.pct) : "לא זמין"}</div>
              </div>
            </div>
            {!renewal.rate.available && (
              <div className="mt-1.5 text-muted-foreground">
                {ASSIGNED_RENEWAL_RATE_UNAVAILABLE_LABEL[renewal.rate.reason]}
              </div>
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
