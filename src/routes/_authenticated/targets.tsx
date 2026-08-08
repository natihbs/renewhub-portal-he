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
  buildScopeTeamRows,
  groupScopeRows,
  isScopedManagerKind,
  missingTargetsByTeam,
  SCOPE_METRIC_LABELS,
  type ScopedManagerKind,
  type ScopeHomeTeamInput,
  type ScopeTeamRow,
} from "@/lib/scope-home";
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
        <PageHeader title="היעד שלי" description="היעד האישי והצוותי שלך לחודש הנוכחי" />
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
      <PageHeader title="היעד שלי" description={`${monthLabel(currentGoalMonth())} · ${me.teamName}`} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-primary" />יעד אישי</CardTitle></CardHeader>
          <CardContent>
            {hasPersonal ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Stat label="יעד" value={formatNum(myGoal.targetValue as number)} />
                  <Stat label="ביצוע" value={formatNum(me.currentResult)} />
                  <Stat label="פער" value={`${(personalGap ?? 0) >= 0 ? "+" : ""}${formatNum(personalGap ?? 0)}`} />
                </div>
                <div className="pt-1 text-center text-2xl font-extrabold">{formatPct(personalPct ?? 0)}</div>
              </div>
            ) : (
              <EmptyState icon={Target} title="לא הוגדר יעד אישי" description="פנו למנהל/ת הצוות להגדרת יעד רשמי לחודש זה." compact />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users2 className="h-4 w-4 text-primary" />יעד הצוות</CardTitle></CardHeader>
          <CardContent>
            {hasTeam ? (
              <div className="text-center text-2xl font-extrabold">{formatNum(teamGoal.targetValue as number)}</div>
            ) : (
              <EmptyState icon={Users2} title="לא הוגדר יעד חודשי לצוות" compact />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
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

  return (
    <>
      <PageHeader
        title="ניהול יעדים"
        description={
          scopedManager
            ? "יעדים בהיקף — סטטוס היעדים של כל הצוותים בהיקף הניהול, ובחירת צוות לעריכה."
            : "יעד חודשי רשמי לצוות ולכל נציג — המקור היחיד לחישובי עמידה ביעד, קצב ותחזית."
        }
      />

      {scopedManager && scope && (
        <ScopeTargetsOverview
          scope={scope}
          month={month}
          profileByTeamId={profileByTeamId}
          selectedTeamId={selectedTeamId}
          onSelectTeam={setWorkspaceTeam}
        />
      )}

      {needsTeamPicker && (
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
              description={cloudTeams.length === 0 ? "יש להוסיף צוות ראשון בעמוד ניהול צוותים." : undefined}
              compact
            />
          </CardContent>
        </Card>
      ) : (
        <TargetWorkspacePanel
          teamId={selectedTeamId}
          month={month}
          onMonthChange={setMonth}
          kpiProfile={profileByTeamId.get(selectedTeamId) ?? DEFAULT_KPI_PROFILE}
        />
      )}
    </>
  );
}

/**
 * Scope-level target status for a business-scope manager, for the selected
 * month: every covered team, grouped by the manager's hierarchy level (center
 * → flat; activity → by center + "משויכים ישירות לפעילות" + "ללא שיוך
 * להיררכיה"; executive → activity → centers), each row labeled by its OWN
 * kpi_profile. Reuses the scope-home domain, so this page and ManagerHome
 * cannot disagree about who is missing targets.
 */
function ScopeTargetsOverview({
  scope,
  month,
  profileByTeamId,
  selectedTeamId,
  onSelectTeam,
}: {
  scope: NonNullable<ReturnType<typeof useBusinessScope>["scope"]>;
  month: string;
  profileByTeamId: Map<string, KpiProfile>;
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
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
  const groups = useMemo(
    () => groupScopeRows({ kind: scope.kind as ScopedManagerKind, rows, units: scope.units }),
    [scope, rows],
  );
  const missingByTeam = useMemo(() => new Map(missingTargetsByTeam(rows).map((m) => [m.teamId, m])), [rows]);
  const loading = teamGoals.isLoading || repGoals.isLoading || state.repsLoading;

  const rowView = (row: ScopeTeamRow) => {
    const labels = SCOPE_METRIC_LABELS[row.kpiProfile];
    const missing = missingByTeam.get(row.id);
    return (
      <div
        key={row.id}
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5",
          selectedTeamId === row.id && "border-primary/50 bg-primary/5",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{row.name}</span>
          <Badge
            variant="secondary"
            className={cn("shrink-0", KPI_PROFILE_BADGE_CLASS[row.kpiProfile])}
          >
            {KPI_PROFILE_LABEL[row.kpiProfile]}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {row.target != null
              ? `${labels.target}: ${formatNum(row.target)}`
              : `לא הוגדר ${labels.target}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={row.missingTargets > 0 ? "secondary" : "outline"}
            className={cn(row.missingTargets > 0 && "bg-primary/10 text-primary")}
          >
            {missing?.line ?? `${row.missingTargets} נציגים ללא יעד`}
          </Badge>
          <Button size="sm" variant="outline" className="h-7" onClick={() => onSelectTeam(row.id)}>
            ניהול יעדים
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          יעדים בהיקף · {monthLabel(month)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            אין צוותים משויכים להיקף הניהול. שיוך צוותים למוקד מתבצע בעמוד הצוותים.
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="space-y-2">
              {group.label && <div className="text-sm font-semibold">{group.label}</div>}
              {group.rows.map(rowView)}
              {(group.subgroups ?? []).map((sub) => (
                <div key={sub.key} className="space-y-2 ps-3">
                  <div className="text-sm font-medium text-muted-foreground">{sub.label}</div>
                  {sub.rows.map(rowView)}
                </div>
              ))}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function TargetWorkspacePanel({ teamId, month, onMonthChange, kpiProfile = DEFAULT_KPI_PROFILE }: { teamId: string; month: string; onMonthChange: (m: string) => void; kpiProfile?: KpiProfile }) {
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
      {/* Month navigation — the month is the most important fact on this
          page: every figure and every save below belongs to it and to it
          alone. It is therefore the page's largest heading, with an explicit
          badge saying whether this is execution (current), planning (future)
          or history (past), and a one-click way back to now. */}
      {(() => {
        const kind = goalMonthKind(month);
        return (
          <div className="rounded-xl border bg-card p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="חודש קודם"
                  onClick={() => onMonthChange(shiftMonth(month, -1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <div className="min-w-40 text-center px-2">
                  <div className="text-xl font-extrabold leading-tight">{monthLabel(month)}</div>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onMonthChange(currentGoalMonth())}
                  >
                    חזרה לחודש הנוכחי
                  </Button>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)} disabled={readOnly}>
                <Copy className="ms-1 h-4 w-4" />העתקת יעדים מהחודש הקודם
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              היעדים בעמוד זה נשמרים לחודש המוצג בלבד — כל חודש עומד בפני עצמו. חודש ללא יעדים יוצג ריק, ולא יירש ערכים מחודש אחר.
            </p>
          </div>
        );
      })()}

      {readOnly && (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          הצוות מושבת — היעדים ההיסטוריים מוצגים לצפייה בלבד. יש להפעיל את הצוות מחדש כדי לערוך יעדים.
        </div>
      )}

      {/* Team target + comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />יעד חודשי לצוות {data.team.name}
            <Badge
              variant="secondary"
              className={cn("shrink-0", KPI_PROFILE_BADGE_CLASS[kpiProfile])}
            >
              {KPI_PROFILE_LABEL[kpiProfile]}
            </Badge>
            {readOnly && <Badge variant="secondary">מושבת</Badge>}
          </CardTitle>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                label={isRenewals ? metricLabels.target : "יעד צוות"}
                value={formatNum(data.team_target)}
              />
              <Stat label="סך יעדי הנציגים" value={formatNum(data.representative_target_sum)} />
              <Stat
                label={diff >= 0 ? "חריגה מהיעד הצוותי" : "טרם הוקצו"}
                value={formatNum(Math.abs(diff))}
              />
              <Stat label="נציגים ללא יעד אישי" value={String(data.active_representatives_without_target)} />
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
                    <TableCell className="font-medium">{r.name}</TableCell>
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
                    <TableCell className="tabular-nums">{formatNum(r.current_result)}</TableCell>
                    <TableCell className="tabular-nums">{pct !== null ? formatPct(pct) : "—"}</TableCell>
                    <TableCell className="tabular-nums">{gap !== null ? `${gap >= 0 ? "+" : ""}${formatNum(gap)}` : "—"}</TableCell>
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
            return (
              <div key={r.id} className={cn("rounded-xl border p-3 space-y-2", dirtyRepIds.includes(r.id) && "border-primary/40 bg-primary/5")}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{r.name}</div>
                  <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "פעיל" : "מושבת"}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{targetHeader}</Label>
                    <Input
                      type="number" min={0} inputMode="numeric" value={raw}
                      onChange={(e) => onChange(r.id, e.target.value)}
                      className="h-9" placeholder="לא הוגדר"
                      aria-label={`יעד אישי עבור ${r.name}`}
                      disabled={readOnly}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground pt-5">
                    {resultHeader}: {formatNum(r.current_result)} · {pct !== null ? formatPct(pct) : "אין יעד"}
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
