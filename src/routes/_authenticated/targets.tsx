import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Target, ChevronRight, ChevronLeft, Users2, Save, Copy, AlertTriangle, Gauge } from "lucide-react";
import { requireRole } from "@/lib/require-role";
import { formatMonthIL, formatNum, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  calculateAchievement,
  DEFAULT_KPI_PROFILE,
  KPI_PROFILE_BADGE_CLASS,
  KPI_PROFILE_LABEL,
  type KpiProfile,
} from "@/lib/performance-domain";
import { useApp } from "@/lib/store";
import { useWorkspace } from "@/lib/workspace-context";
import { useVisibleTeams } from "@/lib/teams-hooks";
import { useResolvedRole } from "@/lib/use-resolved-role";
import { useBusinessScope } from "@/lib/business-scope-hooks";
import {
  buildActivityCenterBoard,
  buildExecutiveActivityBoard,
  buildScopeTeamRows,
  EXECUTIVE_NO_ACTIVITIES_MESSAGE,
  isScopedManagerKind,
  SCOPE_DIRECT_ACTIVITY_GROUP_LABEL,
  SCOPE_METRIC_LABELS,
  SCOPE_UNATTACHED_GROUP_LABEL,
  type ScopeHomeTeamInput,
} from "@/lib/scope-home";
import {
  ActivityTargetsBoard,
  CenterTargetsBoard,
  ExecutiveTargetsBoard,
} from "@/components/TargetScopeBoards";
import { InitialsAvatar, MetricCard } from "@/components/dashboard/Surfaces";
import {
  useTeamGoal,
  useTeamGoals,
  useRepresentativeGoal,
  useRepresentativeGoals,
  currentGoalMonth,
  goalMonthKind,
} from "@/lib/goals-hooks";
import {
  getTargetWorkspace, setTeamGoal, setRepresentativeGoals, copyGoalsFromPreviousMonth,
  type TargetWorkspaceRep, type CopyGoalsPreview,
} from "@/lib/goals.functions";

export const Route = createFileRoute("/_authenticated/targets")({
  beforeLoad: () => requireRole(["admin", "manager", "representative"]),
  head: () => ({
    meta: [
      { title: "יעדים · Pulse" },
      { name: "description", content: "ניהול יעדים חודשיים לצוות ולנציגים" },
      { property: "og:title", content: "יעדים · Pulse" },
      { property: "og:description", content: "ניהול יעדים חודשיים לצוות ולנציגים" },
    ],
  }),
  component: TargetsPage,
});

// useTeamGoal/useTeamGoals/useRepresentativeGoals (goals-hooks.ts) read
// team_goals/representative_goals through useCloudCollection, keyed
// ["cloud", table, opts] — a completely separate cache namespace from this
// page's own ["targets","workspace",...] query. Exported and unit-tested
// directly (see targets-cache.test.ts): every save/copy mutation here must
// invalidate these too, or Dashboard/MorningRoutine/Performance keep showing
// the pre-save target while this page already shows the new one.
export function invalidateTeamGoalReaders(qc: QueryClient): Promise<unknown> {
  return qc.invalidateQueries({ queryKey: ["cloud", "team_goals"] });
}

export function invalidateRepresentativeGoalReaders(qc: QueryClient): Promise<unknown> {
  return qc.invalidateQueries({ queryKey: ["cloud", "representative_goals"] });
}

const monthLabel = formatMonthIL;

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * The month command area — the page's primary context: every figure and every
 * save below belongs to the displayed month and to it alone.
 *
 * It now lives at PAGE level rather than inside the team workspace, because
 * the scope boards above are month-specific too: before this, a scope manager
 * looking at "which teams are missing targets" had no way to change the month
 * until they had already picked a team. Navigation semantics (shiftMonth,
 * goalMonthKind, return-to-current) are unchanged.
 */
function MonthCommandBar({
  month,
  onMonthChange,
  scopeLine,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  scopeLine?: string;
}) {
  const kind = goalMonthKind(month);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="חודש קודם"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="min-w-36 px-2 text-center">
          <div className="font-display text-lg font-extrabold leading-tight">{monthLabel(month)}</div>
          <Badge
            variant={kind === "current" ? "default" : "secondary"}
            className="mt-0.5 text-[11px]"
          >
            {kind === "current"
              ? "החודש הנוכחי"
              : kind === "future"
                ? "חודש עתידי · תכנון"
                : "חודש קודם · היסטוריה"}
          </Badge>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="חודש הבא"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {kind !== "current" && (
          <Button variant="ghost" size="sm" onClick={() => onMonthChange(currentGoalMonth())}>
            חזרה לחודש הנוכחי
          </Button>
        )}
      </div>
      {scopeLine && (
        <span className="inline-flex items-center rounded-full bg-surface-subtle px-3 py-1.5 text-xs text-muted-foreground">
          {scopeLine}
        </span>
      )}
      <p className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1 sm:text-end">
        כל חודש עומד בפני עצמו — חודש ללא יעדים יוצג ריק ולא יירש ערכים מחודש אחר.
      </p>
    </div>
  );
}

function TargetsPage() {
  const role = useResolvedRole();
  return (
    <div className="space-y-6" dir="rtl">
      {role === "representative" ? <RepresentativeTargetsView /> : <ManagerAdminTargetsView />}
    </div>
  );
}

// ============================================================================
// Representative — read-only: my target, my team's target. No edit controls.
// ============================================================================
function RepresentativeTargetsView() {
  const { state } = useApp();
  const me = state.reps.find((r) => r.id === state.currentRepId);
  const myGoal = useRepresentativeGoal(me?.id ?? null);
  const teamGoal = useTeamGoal(me?.teamId ?? null);

  if (!me) {
    return (
      <>
        <PageHeader
          title="היעד שלי"
          icon={Target}
          description="היעד האישי והצוותי שלך לחודש הנוכחי"
        />
        <Card><CardContent className="p-0"><EmptyState icon={Target} title="אין עדיין נתוני נציג" compact /></CardContent></Card>
      </>
    );
  }

  const hasPersonal = myGoal.targetValue !== null;
  const personalPct = hasPersonal ? calculateAchievement(me.currentResult, myGoal.targetValue as number) : null;
  const personalGap = hasPersonal ? me.currentResult - (myGoal.targetValue as number) : null;

  const hasTeam = teamGoal.targetValue !== null;

  return (
    <>
      <PageHeader
        title="היעד שלי"
        icon={Target}
        description={`${monthLabel(currentGoalMonth())} · ${me.teamName}`}
      />
      {/* READ ONLY — visual alignment with the canonical Pulse language only;
          no management control is added here. A missing target stays missing:
          the ring renders only when a real personal target exists. */}
      {hasPersonal ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <MetricCard
            icon={Target}
            label="היעד שלי"
            value={formatNum(myGoal.targetValue as number)}
            sub={monthLabel(currentGoalMonth())}
            tone="primary"
          />
          <MetricCard
            icon={Gauge}
            label="ביצוע נוכחי"
            value={formatNum(me.currentResult)}
            sub={personalPct !== null ? `${formatPct(personalPct)} עמידה ביעד` : undefined}
            tone="accent"
          />
          <MetricCard
            icon={Users2}
            label="פער"
            value={`${(personalGap ?? 0) >= 0 ? "+" : ""}${formatNum(personalGap ?? 0)}`}
            sub={(personalGap ?? 0) >= 0 ? "היעד הושג" : undefined}
            tone={(personalGap ?? 0) >= 0 ? "success" : "primary"}
          />
          <MetricCard
            icon={Users2}
            label="יעד הצוות"
            value={hasTeam ? formatNum(teamGoal.targetValue as number) : "—"}
            sub={hasTeam ? me.teamName : "לא הוגדר יעד חודשי לצוות"}
            tone="primary"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={Target}
                title="לא הוגדר יעד אישי"
                description="פנו למנהל/ת הצוות להגדרת יעד רשמי לחודש זה."
                compact
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users2 className="h-4 w-4 text-primary" />יעד הצוות
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hasTeam ? (
                <div className="num text-center font-display text-2xl font-extrabold">
                  {formatNum(teamGoal.targetValue as number)}
                </div>
              ) : (
                <EmptyState icon={Users2} title="לא הוגדר יעד חודשי לצוות" compact />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}


// ============================================================================
// Manager / Admin — full target management workspace.
// ============================================================================
function ManagerAdminTargetsView() {
  const { workspace, options, setWorkspaceTeam } = useWorkspace();
  // Visible teams — target *history* for a deactivated team must stay
  // reachable; the workspace switcher itself is what actually restricts which
  // team a manager may currently be scoped into.
  const { teams: cloudTeams } = useVisibleTeams();
  const [month, setMonth] = useState(currentGoalMonth());

  const selectedTeamId = workspace.type === "team" ? workspace.teamId : null;
  const needsTeamPicker = options.length > 1 || (options.length >= 1 && !selectedTeamId);

  const profileByTeamId = useMemo(
    () => new Map(cloudTeams.map((t) => [t.id, t.kpiProfile])),
    [cloudTeams],
  );

  // A business-scope manager (מנהל מוקד / מנהל פעילות / סמנכ"ל) doesn't manage
  // one team — the page opens with the target status of EVERY team in their
  // scope for the selected month, and a team is picked from there for editing.
  // The team options themselves come from the workspace switcher, which is
  // already scope-limited, and the server re-verifies every write through the
  // RLS scope funnel — this overview adds visibility, never reach.
  const { scope } = useBusinessScope();
  const scopedManager = isScopedManagerKind(scope?.kind);
  // The management level decides the board, exactly as on ManagerHome:
  // center → teams; activity → centers (teams one drill down); executive →
  // activities (centers, then teams, one drill level each).
  const centerManager = scope?.kind === "center";
  const activityManager = scope?.kind === "activity";

  return (
    <>
      <PageHeader
        title="ניהול יעדים"
        icon={Target}
        description={
          scopedManager
            ? "יעדים בהיקף — סטטוס היעדים בהיקף הניהול, ובחירת צוות לעריכה."
            : "יעד חודשי רשמי לצוות ולכל נציג — המקור היחיד לחישובי עמידה ביעד, קצב ותחזית."
        }
      />

      {/* Month first: the boards below and every save are month-specific. */}
      <MonthCommandBar month={month} onMonthChange={setMonth} scopeLine={scope?.title} />

      {scopedManager && scope && (
        <ScopeTargetsOverview
          scope={scope}
          month={month}
          profileByTeamId={profileByTeamId}
          selectedTeamId={selectedTeamId}
          onSelectTeam={setWorkspaceTeam}
          level={centerManager ? "center" : activityManager ? "activity" : "executive"}
        />
      )}

      {needsTeamPicker && !scopedManager && (
        <Card>
          <CardContent className="pt-5 flex flex-wrap items-center gap-3">
            <Label className="text-sm">צוות</Label>
            <Select value={selectedTeamId ?? ""} onValueChange={(v) => setWorkspaceTeam(v)}>
              <SelectTrigger className="w-64" aria-label="בחירת צוות לניהול יעדים"><SelectValue placeholder="בחרו צוות" /></SelectTrigger>
              <SelectContent>
                {options.filter((o) => o.type === "team").map((o) => (
                  <SelectItem key={o.type === "team" ? o.teamId : "org"} value={o.type === "team" ? o.teamId : ""}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {!selectedTeamId ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Users2}
              title={cloudTeams.length === 0 ? "עדיין לא הוגדרו צוותים" : "בחרו צוות לניהול יעדים"}
              description={
                cloudTeams.length === 0
                  ? "יש להוסיף צוות ראשון בעמוד ניהול צוותים."
                  : scopedManager
                    ? 'בחרו צוות מהלוח שלמעלה בלחיצה על "ניהול יעדים".'
                    : undefined
              }
              compact
            />
          </CardContent>
        </Card>
      ) : (
        <TargetWorkspacePanel
          teamId={selectedTeamId}
          month={month}
          kpiProfile={profileByTeamId.get(selectedTeamId) ?? DEFAULT_KPI_PROFILE}
        />
      )}
    </>
  );
}

/**
 * Scope-level target status for a business-scope manager, for the selected
 * month, presented at the level they actually manage from: center → flat
 * teams; activity → its centers, then teams; executive → ACTIVITIES, then
 * centers, then teams. Empty units stay on the board and covered teams outside
 * the hierarchy keep their honest group, so nothing in scope disappears. Every
 * row is labeled by its OWN kpi_profile and a missing target reads "לא הוגדר",
 * never 0. Reuses the scope-home domain, so this page and ManagerHome cannot
 * disagree about who is missing targets.
 */
function ScopeTargetsOverview({
  scope,
  month,
  profileByTeamId,
  selectedTeamId,
  onSelectTeam,
  level,
}: {
  scope: NonNullable<ReturnType<typeof useBusinessScope>["scope"]>;
  month: string;
  profileByTeamId: Map<string, KpiProfile>;
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  /** Which board this manager manages from — executive keeps the old view. */
  level: "center" | "activity" | "executive";
}) {
  const { state } = useApp();
  const teamInputs = useMemo<ScopeHomeTeamInput[]>(() => {
    const unitByTeam = new Map(scope.teamUnits.map((t) => [t.id, t.businessUnitId]));
    return scope.teams.map((t) => ({
      id: t.id,
      name: t.name,
      kpiProfile: profileByTeamId.get(t.id) ?? DEFAULT_KPI_PROFILE,
      businessUnitId: unitByTeam.get(t.id) ?? null,
    }));
  }, [scope, profileByTeamId]);
  const teamIds = useMemo(() => teamInputs.map((t) => t.id), [teamInputs]);
  const scopeReps = useMemo(() => {
    const ids = new Set(teamIds);
    return state.reps.filter((r) => r.teamId && ids.has(r.teamId));
  }, [state.reps, teamIds]);
  const teamGoals = useTeamGoals(teamIds, month);
  const repGoals = useRepresentativeGoals(
    useMemo(() => scopeReps.map((r) => r.id), [scopeReps]),
    month,
  );
  const rows = useMemo(
    () =>
      buildScopeTeamRows({
        teams: teamInputs,
        reps: scopeReps.map((r) => ({
          id: r.id,
          teamId: r.teamId,
          currentResult: r.currentResult,
        })),
        goalsByTeamId: teamGoals.goalsByTeamId,
        goalsByRepId: repGoals.goalsByRepId,
      }),
    [teamInputs, scopeReps, teamGoals.goalsByTeamId, repGoals.goalsByRepId],
  );
  const loading = teamGoals.isLoading || repGoals.isLoading || state.repsLoading;

  // ACTIVITY manager: the SAME subtree-filtered center board the Activity
  // Home uses (PR #53) — centers by `parentId === scope.unitId`, empty centers
  // included, foreign centers excluded, and covered teams outside the subtree
  // kept honestly in the unattached bucket.
  const activityBoard = useMemo(
    () =>
      level === "activity"
        ? buildActivityCenterBoard({
            units: scope.units,
            rows,
            activityUnitId: scope.unitId,
          })
        : null,
    [level, scope, rows],
  );
  // EXECUTIVE: the SAME activity board the Executive Home uses — ACTIVITIES
  // first, empty activities and empty centers preserved, and nothing covered
  // dropped from the board while still counted.
  const executiveBoard = useMemo(
    () =>
      level === "executive"
        ? buildExecutiveActivityBoard({ units: scope.units, rows })
        : null,
    [level, scope, rows],
  );

  if (level === "center") {
    return (
      <CenterTargetsBoard
        rows={rows}
        selectedTeamId={selectedTeamId}
        onSelectTeam={onSelectTeam}
        isLoading={loading}
      />
    );
  }

  if (level === "activity" && activityBoard) {
    return (
      <ActivityTargetsBoard
        board={activityBoard}
        selectedTeamId={selectedTeamId}
        onSelectTeam={onSelectTeam}
        isLoading={loading}
        directLabel={SCOPE_DIRECT_ACTIVITY_GROUP_LABEL}
        unattachedLabel={SCOPE_UNATTACHED_GROUP_LABEL}
      />
    );
  }

  if (level === "executive" && executiveBoard) {
    return (
      <ExecutiveTargetsBoard
        board={executiveBoard}
        selectedTeamId={selectedTeamId}
        onSelectTeam={onSelectTeam}
        isLoading={loading}
        unattachedLabel={SCOPE_UNATTACHED_GROUP_LABEL}
        emptyMessage={EXECUTIVE_NO_ACTIVITIES_MESSAGE}
      />
    );
  }

  return null;
}

function TargetWorkspacePanel({ teamId, month, kpiProfile = DEFAULT_KPI_PROFILE }: { teamId: string; month: string; kpiProfile?: KpiProfile }) {
  // The team's own KPI language: a renewals team's target IS the assigned
  // monthly renewal book (מיועדות חודשיות) and its result is closed renewals
  // — same PR #39 definition the dashboards use; team_goals stays the source.
  const isRenewals = kpiProfile === "renewals";
  const metricLabels = SCOPE_METRIC_LABELS[kpiProfile];
  const qc = useQueryClient();
  const getWorkspace = useServerFn(getTargetWorkspace);
  const saveTeamGoal = useServerFn(setTeamGoal);
  const saveRepGoals = useServerFn(setRepresentativeGoals);

  const q = useQuery({
    queryKey: ["targets", "workspace", teamId, month],
    queryFn: () => getWorkspace({ data: { team_id: teamId, month } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["targets", "workspace", teamId, month] });

  // ---- Team target ----
  const [teamTargetInput, setTeamTargetInput] = useState("");
  useEffect(() => {
    setTeamTargetInput(q.data?.team_target != null ? String(q.data.team_target) : "");
  }, [q.data?.team_target]);
  const teamTargetDirty = q.data && teamTargetInput !== (q.data.team_target != null ? String(q.data.team_target) : "");

  const teamGoalMutation = useMutation({
    mutationFn: (value: number) => saveTeamGoal({ data: { team_id: teamId, month, target_value: value } }),
    onSuccess: async () => {
      await Promise.all([invalidate(), invalidateTeamGoalReaders(qc)]);
      toast.success("יעד הצוות נשמר");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Representative targets (batch edit) ----
  const [repInputs, setRepInputs] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const r of q.data?.representatives ?? []) {
      next[r.id] = r.target_value != null ? String(r.target_value) : "";
    }
    setRepInputs(next);
  }, [q.data?.representatives]);

  const dirtyRepIds = useMemo(() => {
    const dirty: string[] = [];
    for (const r of q.data?.representatives ?? []) {
      const original = r.target_value != null ? String(r.target_value) : "";
      if ((repInputs[r.id] ?? "") !== original) dirty.push(r.id);
    }
    return dirty;
  }, [q.data?.representatives, repInputs]);

  const repGoalsMutation = useMutation({
    mutationFn: (goals: { representative_id: string; target_value: number }[]) =>
      saveRepGoals({ data: { team_id: teamId, month, goals } }),
    onSuccess: async (res) => {
      await Promise.all([invalidate(), invalidateRepresentativeGoalReaders(qc)]);
      toast.success(`נשמרו יעדים: ${res.created + res.updated} נציגים`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveDirtyRepGoals = () => {
    const goals = dirtyRepIds
      .map((id) => {
        const raw = repInputs[id];
        if (raw === undefined || raw.trim() === "") return null;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return null;
        return { representative_id: id, target_value: n };
      })
      .filter((g): g is { representative_id: string; target_value: number } => g !== null);
    if (goals.length === 0) return toast.error("אין ערכי יעד תקינים לשמירה");
    repGoalsMutation.mutate(goals);
  };

  const [copyOpen, setCopyOpen] = useState(false);

  if (q.isLoading) {
    return (
      <Card><CardContent className="pt-5 space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </CardContent></Card>
    );
  }
  if (q.isError) {
    return (
      <Card><CardContent className="p-0">
        <EmptyState
          icon={AlertTriangle}
          title="שגיאה בטעינת נתוני היעדים"
          description={(q.error as Error)?.message ?? "לא הצלחנו לטעון את נתוני היעדים"}
          action={<Button size="sm" onClick={() => q.refetch()}>ניסיון חוזר</Button>}
          compact
        />
      </CardContent></Card>
    );
  }
  const data = q.data!;
  const diff = data.representative_target_sum - (data.team_target ?? 0);
  // A deactivated team keeps its target HISTORY readable (every month, past
  // and present) but must not silently accept new writes — enforced
  // server-side too (setTeamGoal/setRepresentativeGoals/
  // copyGoalsFromPreviousMonth's apply step), this is what explains the
  // disabled controls below rather than just hiding them.
  const readOnly = !data.team.active;

  return (
    <div className="space-y-4">
      {readOnly && (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          הצוות מושבת — היעדים ההיסטוריים מוצגים לצפייה בלבד. יש להפעיל את הצוות מחדש כדי לערוך יעדים.
        </div>
      )}

      {/* Team target — the primary surface of the workspace: the official
          figure, its allocation status, and the copy action that belongs to
          this team and month. */}
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex flex-wrap items-center gap-2">
              <Target className="h-4 w-4 text-primary" />יעד חודשי לצוות {data.team.name}
              <Badge
                variant="secondary"
                className={cn("shrink-0", KPI_PROFILE_BADGE_CLASS[kpiProfile])}
              >
                {KPI_PROFILE_LABEL[kpiProfile]}
              </Badge>
              {readOnly && <Badge variant="secondary">מושבת</Badge>}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)} disabled={readOnly}>
              <Copy className="ms-1 h-4 w-4" />העתקת יעדים מהחודש הקודם
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="team-target">{isRenewals ? metricLabels.target : "יעד צוות"}</Label>
              <Input
                id="team-target"
                type="number"
                min={0}
                inputMode="numeric"
                value={teamTargetInput}
                onChange={(e) => setTeamTargetInput(e.target.value)}
                className="w-40"
                placeholder="לא הוגדר"
                disabled={readOnly}
              />
            </div>
            <Button
              size="sm"
              disabled={readOnly || !teamTargetDirty || teamGoalMutation.isPending}
              onClick={() => {
                const n = Number(teamTargetInput);
                if (!Number.isFinite(n) || n < 0) return toast.error("יעד חייב להיות מספר לא שלילי");
                teamGoalMutation.mutate(n);
              }}
            >
              <Save className="ms-1 h-4 w-4" />שמירת יעד צוות
            </Button>
            {teamTargetDirty && <Badge variant="outline" className="text-primary border-primary/40">שינוי לא שמור</Badge>}
          </div>

          {data.team_target == null ? (
            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">לא הוגדר יעד חודשי · סך יעדי הנציגים: {formatNum(data.representative_target_sum)}</div>
          ) : (
            /* Allocation view — the official team target beside what has
               actually been allocated to representatives. Every figure comes
               from the workspace payload; nothing is recomputed here. */
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <MetricCard
                icon={Target}
                label={isRenewals ? metricLabels.target : "יעד צוות"}
                value={formatNum(data.team_target)}
                sub={monthLabel(month)}
                tone="primary"
              />
              <MetricCard
                icon={Users2}
                label="סך יעדי הנציגים"
                value={formatNum(data.representative_target_sum)}
                sub={`${data.representatives.length} נציגים בצוות`}
                tone="accent"
              />
              <MetricCard
                icon={Gauge}
                label={diff >= 0 ? "חריגה מהיעד הצוותי" : "טרם הוקצו"}
                value={formatNum(Math.abs(diff))}
                sub={diff === 0 ? "היעד הוקצה במלואו" : undefined}
                tone={diff === 0 ? "success" : diff > 0 ? "warning" : "primary"}
              />
              <MetricCard
                icon={AlertTriangle}
                label="נציגים ללא יעד אישי"
                value={String(data.active_representatives_without_target)}
                sub={
                  data.active_representatives_without_target === 0
                    ? "לכל הנציגים הפעילים יש יעד"
                    : undefined
                }
                tone={data.active_representatives_without_target > 0 ? "warning" : "success"}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Representative targets */}
      <RepresentativeTargetsTable
        representatives={data.representatives}
        inputs={repInputs}
        onChange={(id, v) => setRepInputs((prev) => ({ ...prev, [id]: v }))}
        dirtyRepIds={dirtyRepIds}
        onSave={saveDirtyRepGoals}
        saving={repGoalsMutation.isPending}
        readOnly={readOnly}
        kpiProfile={kpiProfile}
      />

      <CopyGoalsDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        teamId={teamId}
        month={month}
        onApplied={() => Promise.all([invalidate(), invalidateTeamGoalReaders(qc), invalidateRepresentativeGoalReaders(qc)])}
      />
    </div>
  );
}

function RepresentativeTargetsTable({
  representatives,
  inputs,
  onChange,
  dirtyRepIds,
  onSave,
  saving,
  readOnly,
  kpiProfile = DEFAULT_KPI_PROFILE,
}: {
  representatives: TargetWorkspaceRep[];
  inputs: Record<string, string>;
  onChange: (id: string, value: string) => void;
  dirtyRepIds: string[];
  onSave: () => void;
  saving: boolean;
  readOnly?: boolean;
  kpiProfile?: KpiProfile;
}) {
  // Renewals reps speak renewals: the personal target is the assigned book,
  // the result is closed renewals, the pct is אחוז חידוש. Generic teams keep
  // the exact previous wording.
  const isRenewals = kpiProfile === "renewals";
  const targetHeader = isRenewals ? SCOPE_METRIC_LABELS.renewals.target : "יעד אישי";
  const resultHeader = isRenewals ? SCOPE_METRIC_LABELS.renewals.result : "ביצוע נוכחי";
  const pctHeader = isRenewals ? SCOPE_METRIC_LABELS.renewals.rate : "עמידה ביעד";
  if (representatives.length === 0) {
    return (
      <Card><CardContent className="p-0">
        <EmptyState icon={Users2} title="אין עדיין נציגים בצוות זה" compact />
      </CardContent></Card>
    );
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" />יעדים אישיים</CardTitle>
        {dirtyRepIds.length > 0 && !readOnly && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-primary border-primary/40">{dirtyRepIds.length} שינויים לא שמורים</Badge>
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Save className="ms-1 h-4 w-4" />{saving ? "שומר..." : "שמירת שינויים"}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Desktop table */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>נציג</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead>{targetHeader}</TableHead>
                <TableHead>{resultHeader}</TableHead>
                <TableHead>{pctHeader}</TableHead>
                <TableHead>פער</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {representatives.map((r) => {
                const raw = inputs[r.id] ?? "";
                const n = raw.trim() === "" ? null : Number(raw);
                const pct = n !== null && Number.isFinite(n) ? calculateAchievement(r.current_result, n) : null;
                const gap = n !== null && Number.isFinite(n) ? r.current_result - n : null;
                return (
                  <TableRow key={r.id} className={dirtyRepIds.includes(r.id) ? "bg-primary/5" : undefined}>
                    <TableCell className="font-medium">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <InitialsAvatar name={r.name} className="h-8 w-8" />
                        <span className="min-w-0 truncate">{r.name}</span>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={r.active ? "default" : "secondary"}>{r.active ? "פעיל" : "מושבת"}</Badge></TableCell>
                    <TableCell>
                      <Input
                        type="number" min={0} inputMode="numeric" value={raw}
                        onChange={(e) => onChange(r.id, e.target.value)}
                        className="w-28 h-8" placeholder="לא הוגדר"
                        aria-label={`יעד אישי עבור ${r.name}`}
                        disabled={readOnly}
                      />
                    </TableCell>
                    <TableCell className="num font-semibold">{formatNum(r.current_result)}</TableCell>
                    <TableCell
                      className={cn(
                        "num font-bold",
                        pct !== null && pct >= 100 && "text-success-foreground",
                      )}
                    >
                      {pct !== null ? formatPct(pct) : "—"}
                    </TableCell>
                    <TableCell className="num">{gap !== null ? `${gap >= 0 ? "+" : ""}${formatNum(gap)}` : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards */}
        <div className="space-y-3 md:hidden">
          {representatives.map((r) => {
            const raw = inputs[r.id] ?? "";
            const n = raw.trim() === "" ? null : Number(raw);
            const pct = n !== null && Number.isFinite(n) ? calculateAchievement(r.current_result, n) : null;
            const gap = n !== null && Number.isFinite(n) ? r.current_result - n : null;
            return (
              <div
                key={r.id}
                className={cn(
                  "surface-tile space-y-3 p-3",
                  dirtyRepIds.includes(r.id) && "border-primary/40 bg-primary/5",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <InitialsAvatar name={r.name} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {resultHeader}: <span className="num font-medium">{formatNum(r.current_result)}</span>
                    </div>
                  </div>
                  <Badge variant={r.active ? "default" : "secondary"} className="shrink-0">
                    {r.active ? "פעיל" : "מושבת"}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{targetHeader}</Label>
                  <Input
                    type="number" min={0} inputMode="numeric" value={raw}
                    onChange={(e) => onChange(r.id, e.target.value)}
                    className="h-10" placeholder="לא הוגדר"
                    aria-label={`יעד אישי עבור ${r.name}`}
                    disabled={readOnly}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 border-t pt-2 text-center">
                  <div>
                    <div className="text-[10px] text-muted-foreground">{pctHeader}</div>
                    <div
                      className={cn(
                        "num text-sm font-bold",
                        pct !== null && pct >= 100 && "text-success-foreground",
                      )}
                    >
                      {pct !== null ? formatPct(pct) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">פער</div>
                    <div className="num text-sm font-bold">
                      {gap !== null ? `${gap >= 0 ? "+" : ""}${formatNum(gap)}` : "—"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function CopyGoalsDialog({ open, onOpenChange, teamId, month, onApplied }: {
  open: boolean; onOpenChange: (o: boolean) => void; teamId: string; month: string; onApplied: () => Promise<unknown> | void;
}) {
  const copyFn = useServerFn(copyGoalsFromPreviousMonth);
  const previewQ = useQuery({
    queryKey: ["targets", "copy-preview", teamId, month],
    queryFn: () => copyFn({ data: { team_id: teamId, month, dry_run: true } }),
    enabled: open,
  });

  const applyMutation = useMutation({
    mutationFn: () => copyFn({ data: { team_id: teamId, month, dry_run: false } }),
    onSuccess: async (res) => {
      await onApplied();
      toast.success(`הועתקו יעדים: ${res.representatives_to_copy.length} נציגים${res.team_target_will_copy != null ? " + יעד צוות" : ""}`);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = previewQ.data as (CopyGoalsPreview & { ok: true; applied: boolean }) | undefined;
  const nothingToCopy = preview && preview.team_target_will_copy == null && preview.representatives_to_copy.length === 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>העתקת יעדים מהחודש הקודם</AlertDialogTitle>
          <AlertDialogDescription>
            יעדים שכבר הוגדרו לחודש {monthLabel(month)} לא יימחקו ולא יוחלפו — ההעתקה תשלים רק יעדים חסרים.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {previewQ.isLoading ? (
          <div className="py-4 text-sm text-muted-foreground text-center">בודק נתונים מהחודש הקודם...</div>
        ) : previewQ.isError ? (
          <div className="text-sm text-destructive">{(previewQ.error as Error)?.message}</div>
        ) : preview && nothingToCopy ? (
          <div className="py-2 text-sm text-muted-foreground">
            {preview.team_target_skipped_reason === "no_previous" && preview.representatives_to_copy.length === 0
              ? "לא נמצאו יעדים בחודש הקודם להעתקה."
              : "כל היעדים לחודש זה כבר הוגדרו — אין מה להעתיק."}
          </div>
        ) : preview ? (
          <div className="space-y-2 text-sm">
            {preview.team_target_will_copy != null && (
              <div>יעד צוות שיועתק: <span className="font-semibold">{formatNum(preview.team_target_will_copy)}</span></div>
            )}
            {preview.representatives_to_copy.length > 0 && (
              <div>
                יעדים אישיים שיועתקו ({preview.representatives_to_copy.length}):
                <ul className="list-disc pe-5 mt-1 text-muted-foreground">
                  {preview.representatives_to_copy.slice(0, 8).map((r) => (
                    <li key={r.representative_id}>{r.name} — {formatNum(r.target_value)}</li>
                  ))}
                  {preview.representatives_to_copy.length > 8 && <li>ועוד {preview.representatives_to_copy.length - 8}...</li>}
                </ul>
              </div>
            )}
            {preview.representatives_skipped.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {preview.representatives_skipped.length} נציגים כבר בעלי יעד לחודש זה — לא ישונו.
              </div>
            )}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction
            disabled={!preview || nothingToCopy || applyMutation.isPending}
            onClick={(e) => { e.preventDefault(); applyMutation.mutate(); }}
          >
            {applyMutation.isPending ? "מעתיק..." : "אישור העתקה"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
