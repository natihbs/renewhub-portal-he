import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useApp, teamsFromReps } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import type { Rep } from "@/lib/seed";
import type { Feedback } from "@/lib/feedback-domain";
import { useUx } from "@/lib/ux-store";
import { formatDateIL, formatNum, formatPct, workdaysRemaining, workdaysInMonth } from "@/lib/format";
import { calculateAchievement, DEFAULT_KPI_PROFILE, KPI_PROFILE_LABEL, KPI_PROFILE_BADGE_CLASS, type KpiProfile } from "@/lib/performance-domain";
import { useVisibleTeams } from "@/lib/teams-hooks";
import { renewalTotalsForTeam } from "@/lib/kpi-values";
import { calculateRenewalRate, RENEWAL_RATE_UNAVAILABLE_LABEL } from "@/lib/renewal-rate";
import { useWorkspace } from "@/lib/workspace-context";
import { useTeamGoal, useTeamGoals, useRepresentativeGoal, useRepresentativeGoals } from "@/lib/goals-hooks";
import { useResolvedRole } from "@/lib/use-resolved-role";
import type { AppRole } from "@/lib/navigation-config";
import {
  Users2, TrendingUp, TrendingDown, Award, Trophy, Headphones, BookOpen, Megaphone,
  Target, Gauge, CalendarClock, Lightbulb, Sparkles, Users, Activity, BarChart3, FileText, MessageSquare,
  UsersRound,
} from "lucide-react";
import { MorningRoutine } from "@/components/MorningRoutine";
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

const ORG_SCOPE_LABEL = "כלל הארגון";
const NO_TEAM_LABEL = "ללא צוות משויך";

function HomePage() {
  const role = useResolvedRole();
  if (role === "admin") return <AdminHome />;
  if (role === "manager") return <ManagerHome />;
  return <RepresentativeHome />;
}

/**
 * "שלום, {name}" + workspace scope — the exact two-line header every role
 * gets, differing only in the scope line's source: an admin always reads
 * the organization-wide scope (their identity, independent of whatever team
 * they've filtered other pages to); a manager reads their current Workspace
 * team; a representative reads their own authoritative linked team
 * (representatives.team_id via the reps list CloudRepsSync already
 * populates — never profiles.team_id, which is login-identity state, not
 * the representative's real assignment).
 */
function HomeHeader({ role, actions }: { role: AppRole; actions?: React.ReactNode }) {
  const { profile, user } = useAuth();
  const { workspace } = useWorkspace();
  const { state } = useApp();
  const me = state.reps.find((r) => r.id === state.currentRepId);
  const displayName = profile?.full_name || user?.email || "משתמש";
  const scopeLine =
    role === "admin" ? ORG_SCOPE_LABEL
    : role === "manager" ? (workspace.type === "team" ? workspace.teamName : NO_TEAM_LABEL)
    : (me?.teamName || NO_TEAM_LABEL);

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">שלום, {displayName}</h1>
        <p className="text-sm text-muted-foreground mt-1">{scopeLine}</p>
      </div>
      {actions}
    </div>
  );
}

// ============================================================================
// Administrator — organizational overview, cross-team visibility. No "your
// team" framing anywhere on this page; an admin manages the system, not one
// team's day-to-day.
// ============================================================================
function AdminHome() {
  const { state } = useApp();
  const { reps, announcements, competitions } = state;
  // Visible teams — the dashboard's KPI-profile lookups must resolve for a
  // deactivated team too, and "X מתוך Y סה״כ" below must count every team.
  const { teams: cloudTeams } = useVisibleTeams();
  const teamGroups = teamsFromReps(reps);
  const profileByTeamId = useMemo(() => new Map(cloudTeams.map((t) => [t.id, t.kpiProfile])), [cloudTeams]);
  const teamIds = useMemo(() => teamGroups.map((t) => t.teamId), [teamGroups]);
  const teamGoals = useTeamGoals(teamIds);
  const repIds = useMemo(() => reps.map((r) => r.id), [reps]);
  const repGoals = useRepresentativeGoals(repIds);

  const activeTeams = cloudTeams.filter((t) => t.active).length;
  const activeReps = reps.filter((r) => r.currentResult > 0 || r.lastUpdatedAt).length;

  return (
    <div className="space-y-8">
      <HomeHeader role="admin" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard icon={UsersRound} label="צוותים פעילים" value={String(activeTeams)} sub={`מתוך ${cloudTeams.length} סה"כ`} />
        <KPICard icon={Users2} label="נציגים" value={String(reps.length)} sub={`${activeReps} עם נתוני ביצוע`} />
        <KPICard icon={Trophy} label="תחרות פעילה" value={competitions.find((c) => c.active)?.name ?? "אין"} sub={competitions.filter((c) => c.active).length > 1 ? `+${competitions.filter((c) => c.active).length - 1} נוספות` : "כלל הארגון"} />
      </div>

      {teamGroups.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-semibold">צוותים</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {teamGroups.map((t) => (
              <TeamCard
                key={t.teamId}
                teamName={t.teamName}
                reps={reps.filter((r) => r.teamId === t.teamId)}
                teamTarget={teamGoals.goalsByTeamId.get(t.teamId) ?? null}
                kpiProfile={profileByTeamId.get(t.teamId) ?? DEFAULT_KPI_PROFILE}
                renewal={
                  (profileByTeamId.get(t.teamId) ?? DEFAULT_KPI_PROFILE) === "renewals"
                    ? (() => {
                        const totals = renewalTotalsForTeam(reps.filter((r) => r.teamId === t.teamId).map((r) => r.id), state.kpiValues);
                        return { totals, rate: calculateRenewalRate("renewals", totals.completed, totals.opportunities) };
                      })()
                    : null
                }
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TopPerformersCard reps={reps} goalsByRepId={repGoals.goalsByRepId} className="lg:col-span-2" />
        <AnnouncementsCard announcements={announcements} isStaff />
      </div>

      <InsightsCard reps={reps} repGoalsByRepId={repGoals.goalsByRepId} teamGoalsByTeamId={teamGoals.goalsByTeamId} />

      <RecentActivityCard />

      <ContentShortcutsRow articleCount={state.articles.length} activeCompetition={competitions.find((c) => c.active)?.name ?? null} />
    </div>
  );
}

// ============================================================================
// Team Manager — daily team-management workflow. MorningRoutine is the
// single authoritative surface for the morning workflow (achievement,
// priorities, checklist) — see the sprint report for what used to duplicate
// it here and was removed.
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
  const { teams: cloudTeams } = useVisibleTeams();
  const profileByTeamId = useMemo(() => new Map(cloudTeams.map((t) => [t.id, t.kpiProfile])), [cloudTeams]);
  const teamGoal = useTeamGoal(workspaceTeamId);
  const scopedRepIds = useMemo(() => scopedReps.map((r) => r.id), [scopedReps]);
  const repGoals = useRepresentativeGoals(scopedRepIds);

  const renewal = workspaceTeamId && (profileByTeamId.get(workspaceTeamId) ?? DEFAULT_KPI_PROFILE) === "renewals"
    ? (() => {
        const totals = renewalTotalsForTeam(scopedReps.map((r) => r.id), state.kpiValues);
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

      <MorningRoutine />

      {workspace.type === "team" && (
        <TeamCard
          teamName={workspace.teamName}
          reps={scopedReps}
          teamTarget={teamGoal.targetValue}
          kpiProfile={profileByTeamId.get(workspace.teamId) ?? DEFAULT_KPI_PROFILE}
          renewal={renewal}
        />
      )}

      <InsightsCard reps={scopedReps} repGoalsByRepId={repGoals.goalsByRepId} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TopPerformersCard reps={scopedReps} goalsByRepId={repGoals.goalsByRepId} className="lg:col-span-2" />
        <AnnouncementsCard announcements={announcements} isStaff />
      </div>

      <RecentActivityCard />

      <ContentShortcutsRow articleCount={state.articles.length} activeCompetition={competitions.find((c) => c.active)?.name ?? null} />
    </div>
  );
}

// ============================================================================
// Representative — personal performance workspace, never management
// language or controls.
// ============================================================================
function RepresentativeHome() {
  const { state } = useApp();
  const { reps, announcements, competitions, currentRepId } = state;
  const me = reps.find((r) => r.id === currentRepId);
  const myGoal = useRepresentativeGoal(me?.id ?? null);
  const wdRemaining = workdaysRemaining();
  const wdTotal = workdaysInMonth();

  const hasTarget = myGoal.targetValue !== null;
  const pct = hasTarget && me ? calculateAchievement(me.currentResult, myGoal.targetValue as number) : null;
  const remaining = hasTarget && me ? Math.max(0, (myGoal.targetValue as number) - me.currentResult) : null;
  const perDay = remaining !== null && wdRemaining > 0 ? Math.ceil(remaining / wdRemaining) : null;

  return (
    <div className="space-y-8">
      <HomeHeader role="representative" />

      {me ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {hasTarget ? (
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AnnouncementsCard announcements={announcements} isStaff={false} />
        <Card className="card-interactive">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Headphones className="h-4 w-4 text-primary" />המשוב שלי
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">האזנות ומשוב שפורסמו עבורך.</p>
            <Button asChild size="sm">
              <Link to="/feedback"><Headphones className="ms-1 h-4 w-4" />צפייה במשוב שלי</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <ContentShortcutsRow articleCount={state.articles.length} activeCompetition={competitions.find((c) => c.active)?.name ?? null} />
    </div>
  );
}

function TopPerformersCard({ reps, goalsByRepId, className }: { reps: Rep[]; goalsByRepId: Map<string, number>; className?: string }) {
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
        {top3.length === 0 ? (
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
  icon: Icon, label, value, sub, tone, trend,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string;
  tone?: "success" | "warning" | "danger";
  trend?: { dir: "up" | "down"; text: string };
}) {
  const color = tone === "success" ? "text-success-foreground" : tone === "danger" ? "text-primary" : tone === "warning" ? "text-warning-foreground" : "text-foreground";
  const TrendIcon = trend?.dir === "down" ? TrendingDown : TrendingUp;
  const trendColor = trend?.dir === "up" ? "text-success-foreground" : "text-primary";
  return (
    <Card className="card-interactive">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-primary">
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className={cn("mt-2 text-2xl md:text-3xl font-extrabold truncate", color)}>{value}</div>
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

type TeamCardRenewal = { totals: { opportunities: number | null; completed: number | null }; rate: ReturnType<typeof calculateRenewalRate> };

/**
 * teamTarget is the official monthly team target (team_goals), never a sum
 * of representative targets — null means genuinely "no official target set
 * this month," rendered as an honest missing state, never 0%.
 */
function TeamCard({ teamName, reps, teamTarget, kpiProfile, renewal }: {
  teamName: string; reps: Rep[]; teamTarget: number | null;
  kpiProfile?: KpiProfile;
  renewal?: TeamCardRenewal | null;
}) {
  const Icon = Users2;
  const result = reps.reduce((a, r) => a + r.currentResult, 0);
  const hasTarget = teamTarget !== null;
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
        {hasTarget ? (
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
            <div className="font-semibold mb-1.5">מדדי חידושים</div>
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
          {!hasTarget && (
            <Button asChild variant="outline" size="sm" className="flex-1 justify-center">
              <Link to="/targets"><Target className="ms-1 h-3.5 w-3.5" />הגדרת יעד</Link>
            </Button>
          )}
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
function InsightsCard({ reps, repGoalsByRepId, teamGoalsByTeamId }: {
  reps: Rep[]; repGoalsByRepId: Map<string, number>; teamGoalsByTeamId?: Map<string, number>;
}) {
  const insights = useMemo(
    () => buildInsights(reps, repGoalsByRepId, teamGoalsByTeamId),
    [reps, repGoalsByRepId, teamGoalsByTeamId],
  );
  if (insights.length === 0) return null;
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
 * Every insight here is computed only from representatives/teams that have
 * an official target for the month — a rep or team with no target is simply
 * excluded, never assigned a fabricated 0%/100% to make the comparison work.
 */
function buildInsights(
  reps: Rep[],
  repGoalsByRepId: Map<string, number>,
  teamGoalsByTeamId?: Map<string, number>,
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

  const bottom = withPct[withPct.length - 1];
  if (bottom && withPct.length > 1) list.push(`${bottom.name} דורש/ת ליווי - עמידה של ${formatPct(bottom.pct)} בלבד.`);

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
          <EmptyState icon={Activity} title="אין פעילות אחרונה להצגה" compact />
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
