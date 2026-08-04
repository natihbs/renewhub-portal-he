import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { formatNum, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { calculateAchievement } from "@/lib/performance-domain";
import { useApp } from "@/lib/store";
import { useWorkspace } from "@/lib/workspace-context";
import { useCloudTeams } from "@/lib/teams-hooks";
import { useResolvedRole } from "@/lib/use-resolved-role";
import { useTeamGoal, useRepresentativeGoal, currentGoalMonth } from "@/lib/goals-hooks";
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

function monthLabel(month: string): string {
  const d = new Date(`${month}T00:00:00`);
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d);
}

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
  const { teams: cloudTeams } = useCloudTeams();
  const [month, setMonth] = useState(currentGoalMonth());

  const selectedTeamId = workspace.type === "team" ? workspace.teamId : null;
  const needsTeamPicker = options.length > 1 || (options.length >= 1 && !selectedTeamId);

  return (
    <>
      <PageHeader
        title="ניהול יעדים"
        description="יעד חודשי רשמי לצוות ולכל נציג — המקור היחיד לחישובי עמידה ביעד, קצב ותחזית."
      />

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
        <TargetWorkspacePanel teamId={selectedTeamId} month={month} onMonthChange={setMonth} />
      )}
    </>
  );
}

function TargetWorkspacePanel({ teamId, month, onMonthChange }: { teamId: string; month: string; onMonthChange: (m: string) => void }) {
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
    onSuccess: () => { toast.success("יעד הצוות נשמר"); invalidate(); },
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
    onSuccess: (res) => {
      toast.success(`נשמרו יעדים: ${res.created + res.updated} נציגים`);
      invalidate();
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

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="חודש קודם" onClick={() => onMonthChange(shiftMonth(month, -1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="text-sm font-semibold min-w-28 text-center">{monthLabel(month)}</div>
          <Button variant="ghost" size="icon" aria-label="חודש הבא" onClick={() => onMonthChange(shiftMonth(month, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)}>
          <Copy className="ms-1 h-4 w-4" />העתקת יעדים מהחודש הקודם
        </Button>
      </div>

      {/* Team target + comparison */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-primary" />יעד חודשי לצוות {data.team.name}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="team-target">יעד צוות</Label>
              <Input
                id="team-target"
                type="number"
                min={0}
                inputMode="numeric"
                value={teamTargetInput}
                onChange={(e) => setTeamTargetInput(e.target.value)}
                className="w-40"
                placeholder="לא הוגדר"
              />
            </div>
            <Button
              size="sm"
              disabled={!teamTargetDirty || teamGoalMutation.isPending}
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
              <Stat label="יעד צוות" value={formatNum(data.team_target)} />
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
      />

      <CopyGoalsDialog open={copyOpen} onOpenChange={setCopyOpen} teamId={teamId} month={month} onApplied={invalidate} />
    </div>
  );
}

function RepresentativeTargetsTable({ representatives, inputs, onChange, dirtyRepIds, onSave, saving }: {
  representatives: TargetWorkspaceRep[];
  inputs: Record<string, string>;
  onChange: (id: string, value: string) => void;
  dirtyRepIds: string[];
  onSave: () => void;
  saving: boolean;
}) {
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
        {dirtyRepIds.length > 0 && (
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
                <TableHead>יעד אישי</TableHead>
                <TableHead>ביצוע נוכחי</TableHead>
                <TableHead>עמידה ביעד</TableHead>
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
                    <Label className="text-xs">יעד אישי</Label>
                    <Input
                      type="number" min={0} inputMode="numeric" value={raw}
                      onChange={(e) => onChange(r.id, e.target.value)}
                      className="h-9" placeholder="לא הוגדר"
                      aria-label={`יעד אישי עבור ${r.name}`}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground pt-5">
                    ביצוע: {formatNum(r.current_result)} · {pct !== null ? formatPct(pct) : "אין יעד"}
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
  open: boolean; onOpenChange: (o: boolean) => void; teamId: string; month: string; onApplied: () => void;
}) {
  const copyFn = useServerFn(copyGoalsFromPreviousMonth);
  const previewQ = useQuery({
    queryKey: ["targets", "copy-preview", teamId, month],
    queryFn: () => copyFn({ data: { team_id: teamId, month, dry_run: true } }),
    enabled: open,
  });

  const applyMutation = useMutation({
    mutationFn: () => copyFn({ data: { team_id: teamId, month, dry_run: false } }),
    onSuccess: (res) => {
      toast.success(`הועתקו יעדים: ${res.representatives_to_copy.length} נציגים${res.team_target_will_copy != null ? " + יעד צוות" : ""}`);
      onApplied();
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
