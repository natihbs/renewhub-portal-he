import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { InitialsAvatar, MetricCard, SectionHeading } from "@/components/dashboard/Surfaces";
import { summarizeTeams } from "@/lib/teams-overview";
import {
  UsersRound,
  Plus,
  Search,
  Pencil,
  Trash2,
  Power,
  UserPlus,
  UserMinus,
  AlertTriangle,
  Users2,
  Building2,
  ShieldCheck,
  Network,
  Link2,
  ChevronLeft,
} from "lucide-react";
import { requireRole } from "@/lib/require-role";
import { formatDateIL } from "@/lib/format";
import {
  listTeams, getTeamDetails, createTeam, updateTeam, deleteTeam, setTeamActive, setUserTeam,
  listTeamAssignmentCandidates, canManagerRemoveTarget,
} from "@/lib/team-admin.functions";
import { useWorkspace } from "@/lib/workspace-context";
import {
  listBusinessHierarchy,
  createBusinessUnit,
  updateBusinessUnit,
  deleteBusinessUnit,
  attachTeamToUnit,
  setUserBusinessScope,
  HIERARCHY_TABLES_MISSING_MESSAGE,
  UNIT_NAME_REQUIRED_MESSAGE,
} from "@/lib/business-scope.functions";
import { centerOptionLabel } from "@/lib/business-scope";
import { type KpiProfile, DEFAULT_KPI_PROFILE, KPI_PROFILE_LABEL, KPI_PROFILE_BADGE_CLASS } from "@/lib/performance-domain";

export const Route = createFileRoute("/_authenticated/teams")({
  beforeLoad: () => requireRole(["admin", "manager"]),
  head: () => ({
    meta: [
      { title: "ניהול צוותים · Pulse" },
      { name: "description", content: "ניהול צוותי מכירות, מנהלים ונציגים" },
      { property: "og:title", content: "ניהול צוותים · Pulse" },
      { property: "og:description", content: "ניהול צוותי מכירות, מנהלים ונציגים" },
    ],
  }),
  component: TeamsPage,
});

type TeamRow = {
  id: string;
  name: string;
  department: string | null;
  description: string | null;
  manager_id: string | null;
  active: boolean;
  kpi_profile: KpiProfile;
  created_at: string;
  member_count: number;
  rep_count: number;
  active_member_count: number;
};

type Person = {
  id: string;
  full_name: string | null;
  email: string | null;
  team_id: string | null;
  manager_id: string | null;
  representative_id: string | null;
  active: boolean;
  roles: string[];
};

// getTeamDetails resolves the linked representative to a business identifier
// server-side and never returns the raw representative_id uuid to the client.
type TeamMember = Omit<Person, "representative_id"> & { business_id: string | null };

type RepMember = {
  id: string;
  name: string;
  external_ref: string | null;
  user_id: string | null;
  active: boolean;
};

const NONE = "__none__";

/**
 * Every query key a team mutation (manager reassignment/removal, KPI profile,
 * active toggle, member add/remove) must invalidate. Exported and unit-tested
 * directly (see teams-cache.test.ts) — ["representatives"] is the query key
 * useCloudTeams() reads (see teams-hooks.ts), shared by WorkspaceProvider
 * (header scope line, WorkspaceSwitcher) and the home dashboard; omitting it
 * previously left those screens showing a team's pre-mutation manager.
 */
export function invalidateTeamAdminCaches(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["admin", "teams"] }),
    qc.invalidateQueries({ queryKey: ["admin", "users"] }),
    qc.invalidateQueries({ queryKey: ["admin", "audit"] }),
    qc.invalidateQueries({ queryKey: ["admin", "team-details"] }),
    // The /users details drawer caches per-user rows whose business_title and
    // health are derived from teams.manager_id + user_business_scopes — a
    // team-manager change or a hierarchy/scope mutation (the hierarchy card's
    // refresh() routes through this function) must stale them too, or the
    // drawer keeps a pre-mutation title until a hard refresh.
    qc.invalidateQueries({ queryKey: ["admin", "user-details"] }),
    qc.invalidateQueries({ queryKey: ["representatives"] }),
    // The caller's own resolved scope (header identity line, ManagerHome and
    // /targets overviews) also keys off teams.manager_id ownership.
    qc.invalidateQueries({ queryKey: ["business-scope"] }),
  ]);
}

function personName(p: { full_name: string | null; email: string | null } | undefined | null) {
  return p?.full_name || p?.email || "—";
}

/**
 * P2b: an admin may manage every team; a manager may manage only the team(s)
 * they personally manage (team.manager_id === their own id) — never every
 * team RLS happens to let them read, and never a team someone else manages.
 * Pure so the exact scoping rule is unit-tested directly; server-side
 * enforcement lives in assertCanManageTeam (team-admin.functions.ts) — this
 * only ever controls which UI affordances render, never a security boundary
 * by itself.
 */
export function canManageTeamRow(
  team: { manager_id: string | null },
  ctx: { isAdmin: boolean; isManager: boolean; currentUserId: string | null },
): boolean {
  if (ctx.isAdmin) return true;
  if (!ctx.isManager) return false;
  return !!ctx.currentUserId && team.manager_id === ctx.currentUserId;
}

function KpiProfileBadge({ profile }: { profile: KpiProfile }) {
  return <Badge variant="secondary" className={KPI_PROFILE_BADGE_CLASS[profile]}>{KPI_PROFILE_LABEL[profile]}</Badge>;
}

function TeamsPage() {
  const list = useServerFn(listTeams);
  const qc = useQueryClient();
  const teamsQ = useQuery({ queryKey: ["admin", "teams"], queryFn: () => list() });

  // Memoized so the `?? []` fallback doesn't produce a new array identity on
  // every render and re-run every downstream useMemo (filtering, the overview
  // summary, the people index).
  const teams = useMemo(() => (teamsQ.data?.teams ?? []) as TeamRow[], [teamsQ.data?.teams]);
  const people = useMemo(() => (teamsQ.data?.people ?? []) as Person[], [teamsQ.data?.people]);
  // canManage: organization-wide capabilities only (create team, full edit
  // dialog, activate/deactivate, delete) — always admin-only. A manager's
  // scoped capability for their own team (description, KPI profile, members)
  // is computed per-row via canManageTeamRow and enforced server-side.
  const canManage = !!teamsQ.data?.canManage;
  const isAdmin = !!teamsQ.data?.isAdmin;
  const isManager = !!teamsQ.data?.isManager;
  const currentUserId = (teamsQ.data?.currentUserId as string | undefined) ?? null;

  const managers = people.filter((p) => p.roles.includes("manager") || p.roles.includes("admin"));
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState<"all" | KpiProfile>("all");
  const [sortBy, setSortBy] = useState<"name" | "created" | "members">("name");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState<TeamRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // A single-team manager's Workspace is locked to exactly one option — RLS
  // already limits this whole page to that one row for them, so open its
  // detail sheet directly instead of making them click their own only row.
  // Fires once (a ref, not a state guard) so closing the sheet afterwards
  // never re-triggers it.
  const { options: workspaceOptions } = useWorkspace();
  const autoOpenedWorkspaceTeam = useRef(false);
  useEffect(() => {
    if (autoOpenedWorkspaceTeam.current) return;
    if (workspaceOptions.length === 1 && workspaceOptions[0].type === "team") {
      autoOpenedWorkspaceTeam.current = true;
      setOpenTeamId(workspaceOptions[0].teamId);
    }
  }, [workspaceOptions]);

  // Returns the settle promise so callers can await a mutation's full refresh
  // (not just its own request) before reporting success to the user.
  const invalidate = () => invalidateTeamAdminCaches(qc);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = teams.filter((t) => {
      if (q) {
        const mgr = t.manager_id ? personName(peopleById.get(t.manager_id)) : "";
        const hay = `${t.name} ${t.department ?? ""} ${t.description ?? ""} ${mgr}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter === "active" && !t.active) return false;
      if (statusFilter === "inactive" && t.active) return false;
      if (managerFilter === NONE && t.manager_id) return false;
      if (managerFilter !== "all" && managerFilter !== NONE && t.manager_id !== managerFilter)
        return false;
      if (profileFilter !== "all" && (t.kpi_profile ?? DEFAULT_KPI_PROFILE) !== profileFilter)
        return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortBy === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (sortBy === "members") return b.member_count - a.member_count;
      return a.name.localeCompare(b.name, "he");
    });
    return rows;
  }, [teams, search, statusFilter, managerFilter, profileFilter, sortBy, peopleById]);

  // Organization summary over ALL loaded teams (not the filtered view) — the
  // band describes the organization, the command bar's counter describes the
  // current filter. Pure and unit-tested in teams-overview.ts.
  const summary = useMemo(() => summarizeTeams(teams), [teams]);

  const del = useServerFn(deleteTeam);
  const toggleActive = useServerFn(setTeamActive);

  const delM = useMutation({
    mutationFn: (team_id: string) => del({ data: { team_id } }),
    // Await the full invalidation/refetch before the success toast — the
    // deleted team must actually be gone from the table by the time "הצוות
    // נמחק" appears, matching every other Teams mutation's pattern (P3b).
    onSuccess: async () => {
      await invalidate();
      toast.success("הצוות נמחק");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const activeM = useMutation({
    mutationFn: (v: { team_id: string; active: boolean }) => toggleActive({ data: v }),
    onSuccess: async (_d, v) => {
      await invalidate();
      toast.success(v.active ? "הצוות הופעל" : "הצוות הושבת");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="ניהול צוותים"
        icon={UsersRound}
        description="יצירה, עריכה והשבתה של צוותים, שיוך מנהלים ונציגים"
      />

      {/* Organization summary band — counts only, all of them derived from the
          already-loaded team rows (see teams-overview.ts). /teams carries no
          targets or results, so there is deliberately no performance metric
          here to invent. */}
      {!teamsQ.isLoading && !teamsQ.isError && teams.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <MetricCard
            icon={UsersRound}
            label="צוותים"
            value={String(summary.total)}
            sub={`${summary.active} פעילים · ${summary.inactive} מושבתים`}
            tone="primary"
          />
          <MetricCard
            icon={Users2}
            label="נציגים"
            value={String(summary.representatives)}
            sub={`${summary.members} חשבונות משתמש בצוותים`}
            tone="accent"
          />
          <MetricCard
            icon={AlertTriangle}
            label="צוותים ללא מנהל"
            value={String(summary.withoutManager)}
            sub={
              summary.withoutManagerStaffed > 0
                ? `${summary.withoutManagerStaffed} מהם מאוישים`
                : summary.withoutManager > 0
                  ? "כולם ללא חברים"
                  : "לכל הצוותים יש מנהל"
            }
            tone={summary.withoutManagerStaffed > 0 ? "warning" : "success"}
          />
          <MetricCard
            icon={ShieldCheck}
            label="פרופילי KPI"
            value={String(summary.byProfile.renewals)}
            sub={`${KPI_PROFILE_LABEL.renewals} · ${summary.byProfile.generic_sales} ${KPI_PROFILE_LABEL.generic_sales}`}
            tone="primary"
          />
        </div>
      )}

      {/* Command bar — search, filters, sorting, the live result count and the
          admin-only create action on ONE surface, instead of floating inside
          the list card. Same state and handlers as before. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש צוות, מחלקה או מנהל"
            aria-label="חיפוש צוותים"
            className="h-9 pe-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-full sm:w-36" aria-label="סינון לפי סטטוס">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            <SelectItem value="active">פעיל</SelectItem>
            <SelectItem value="inactive">מושבת</SelectItem>
          </SelectContent>
        </Select>
        <Select value={managerFilter} onValueChange={setManagerFilter}>
          <SelectTrigger className="h-9 w-full sm:w-44" aria-label="סינון לפי מנהל">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל המנהלים</SelectItem>
            <SelectItem value={NONE}>ללא מנהל</SelectItem>
            {managers.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {personName(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={profileFilter}
          onValueChange={(v) => setProfileFilter(v as "all" | KpiProfile)}
        >
          <SelectTrigger className="h-9 w-full sm:w-40" aria-label="סינון לפי פרופיל KPI">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הפרופילים</SelectItem>
            <SelectItem value="generic_sales">{KPI_PROFILE_LABEL.generic_sales}</SelectItem>
            <SelectItem value="renewals">{KPI_PROFILE_LABEL.renewals}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="h-9 w-full sm:w-48" aria-label="מיון">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">מיון לפי שם</SelectItem>
            <SelectItem value="created">מיון לפי תאריך יצירה</SelectItem>
            <SelectItem value="members">מיון לפי מספר חברים</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          מציג {filtered.length} מתוך {teams.length}
        </span>
        {canManage && (
          <>
            <span aria-hidden className="hidden h-6 w-px bg-border/70 sm:block" />
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="ms-1 h-4 w-4" />
              הוספת צוות
            </Button>
          </>
        )}
      </div>

      <Card>
        <CardContent className="pt-5 space-y-4">
          {teamsQ.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : teamsQ.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="שגיאה בטעינת הצוותים"
              description={(teamsQ.error as Error)?.message ?? "לא הצלחנו לטעון את רשימת הצוותים"}
              action={
                <Button size="sm" onClick={() => teamsQ.refetch()}>
                  ניסיון חוזר
                </Button>
              }
              compact
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={teams.length === 0 ? "עדיין לא הוגדרו צוותים" : "לא נמצאו צוותים תואמים"}
              description={
                teams.length === 0
                  ? "הוסיפו צוות ראשון כדי לשייך אליו מנהל ונציגים."
                  : "נסו לשנות את החיפוש או הסינון."
              }
              action={
                canManage && teams.length === 0 ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="ms-1 h-4 w-4" />
                    הוספת צוות
                  </Button>
                ) : undefined
              }
              compact
            />
          ) : (
            /* Team surfaces — one management card per team at every width,
               replacing the desktop table. Same click target (the details
               sheet), same RowActions, same permission gates. */
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {filtered.map((t) => (
                <TeamCardSurface
                  key={t.id}
                  team={t}
                  managerName={t.manager_id ? personName(peopleById.get(t.manager_id)) : null}
                  onOpen={() => setOpenTeamId(t.id)}
                  actions={
                    <RowActions
                      team={t}
                      canManage={canManage}
                      canManageThisTeam={canManageTeamRow(t, { isAdmin, isManager, currentUserId })}
                      onEdit={() => setEditTeam(t)}
                      onToggle={() => activeM.mutate({ team_id: t.id, active: !t.active })}
                      onDelete={() => delM.mutate(t.id)}
                    />
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && <BusinessHierarchyCard onChanged={invalidate} />}

      {canManage && (
        <TeamDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          managers={managers}
          onSaved={invalidate}
        />
      )}
      {canManage && editTeam && (
        <TeamDialog
          open
          onOpenChange={(o) => {
            if (!o) setEditTeam(null);
          }}
          managers={managers}
          team={editTeam}
          onSaved={invalidate}
        />
      )}

      <TeamDetailsSheet
        teamId={openTeamId}
        onOpenChange={(o) => {
          if (!o) setOpenTeamId(null);
        }}
        people={people}
        managers={managers}
        teams={teams}
        isAdmin={isAdmin}
        isManager={isManager}
        currentUserId={currentUserId}
        onChanged={invalidate}
      />
    </div>
  );
}

/**
 * One team as a management surface. Everything shown is a value already on
 * the team row — no performance figure exists on this page to invent. The
 * whole card opens the existing details sheet; the actions cluster stops
 * propagation exactly as the old table cell did.
 */
function TeamCardSurface({
  team,
  managerName,
  onOpen,
  actions,
}: {
  team: TeamRow;
  managerName: string | null;
  onOpen: () => void;
  actions: React.ReactNode;
}) {
  const unmanagedStaffed = !team.manager_id && team.member_count > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "surface-tile relative cursor-pointer overflow-hidden p-4",
        "before:absolute before:inset-y-4 before:start-0 before:w-1 before:rounded-e-full",
        !team.active
          ? "before:bg-muted-foreground/40"
          : unmanagedStaffed
            ? "before:bg-[color:var(--warning)]"
            : "before:bg-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-base font-bold">{team.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {team.department || "ללא שיוך מחלקה"}
          </div>
        </div>
        <Badge variant={team.active ? "default" : "secondary"} className="shrink-0">
          {team.active ? "פעיל" : "מושבת"}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <KpiProfileBadge profile={team.kpi_profile ?? DEFAULT_KPI_PROFILE} />
        <Badge variant="outline" className="gap-1">
          <Users2 className="h-3 w-3" />
          {team.rep_count} נציגים
        </Badge>
        <Badge variant="outline">{team.member_count} חשבונות</Badge>
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-2 border-t pt-3">
        {managerName ? (
          <>
            <InitialsAvatar name={managerName} className="h-8 w-8" />
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground">מנהל הצוות</div>
              <div className="min-w-0 truncate text-sm font-medium">{managerName}</div>
            </div>
          </>
        ) : (
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">מנהל הצוות</div>
            {unmanagedStaffed ? (
              <Badge
                variant="outline"
                className="mt-0.5 border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 text-warning-foreground"
              >
                <AlertTriangle className="ms-1 h-3 w-3" />
                ללא מנהל צוות
              </Badge>
            ) : (
              <div className="text-sm text-muted-foreground">—</div>
            )}
          </div>
        )}
        <div className="ms-auto flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        נוצר {formatDateIL(team.created_at)}
      </div>
    </div>
  );
}

function RowActions({ team, canManage, canManageThisTeam, onEdit, onToggle, onDelete }: {
  team: TeamRow; canManage: boolean; canManageThisTeam: boolean; onEdit: () => void; onToggle: () => void; onDelete: () => void;
}) {
  if (!canManage) {
    // A manager of this specific team gets full editing inside the details
    // sheet (description, KPI profile, members) — clicking the row opens it
    // regardless of these row-level icons, which stay admin-only (create,
    // rename, reassign manager, activate/deactivate, delete). "צפייה בלבד" is
    // only accurate when the viewer can't manage this team at all.
    return (
      <span className="text-xs text-muted-foreground">
        {canManageThisTeam ? "לחצו על הצוות לניהול" : "צפייה בלבד"}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Button size="icon" variant="ghost" aria-label={`עריכת הצוות ${team.name}`} onClick={onEdit}>
        <Pencil className="h-4 w-4" />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={team.active ? `השבתת הצוות ${team.name}` : `הפעלת הצוות ${team.name}`}>
            <Power className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>{team.active ? "השבתת צוות" : "הפעלת צוות"}</AlertDialogTitle>
            <AlertDialogDescription>
              {team.active
                ? "הצוות יסומן כמושבת ולא יוצע לשיוך חדש. הנתונים והשיוכים הקיימים יישמרו."
                : "הצוות יחזור להיות פעיל וזמין לשיוך."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={onToggle}>{team.active ? "השבתת צוות" : "הפעלה"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={`מחיקת הצוות ${team.name}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת הצוות "{team.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              מחיקה אפשרית רק כשלצוות אין שום נתון היסטורי משויך — לא משתמשים, לא נציגים, לא יעדים ולא רשומות ביצועים. אם קיימים נתונים כאלה, תוצג הודעה עם הפירוט המלא; מומלץ להשבית את הצוות במקום זאת כדי לשמר את ההיסטוריה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>מחיקה</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TeamDialog({ open, onOpenChange, managers, team, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  managers: Person[];
  team?: TeamRow;
  onSaved: () => Promise<unknown> | void;
}) {
  const create = useServerFn(createTeam);
  const update = useServerFn(updateTeam);
  const [name, setName] = useState(team?.name ?? "");
  const [department, setDepartment] = useState(team?.department ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [managerId, setManagerId] = useState(team?.manager_id ?? NONE);
  const [active, setActive] = useState(team?.active ?? true);
  const [kpiProfile, setKpiProfile] = useState<KpiProfile>(team?.kpi_profile ?? DEFAULT_KPI_PROFILE);

  const m = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        department: department || null,
        description: description || null,
        manager_id: managerId === NONE ? null : managerId,
        active,
        kpi_profile: kpiProfile,
      };
      if (team) return update({ data: { ...payload, team_id: team.id } });
      return create({ data: payload });
    },
    onSuccess: async () => {
      await onSaved();
      toast.success(team ? "הצוות עודכן" : "הצוות נוצר");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{team ? "עריכת צוות" : "הוספת צוות"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="team-name">שם הצוות</Label>
            <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: צוות רכב" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="team-dep">מחלקה / פעילות</Label>
            <Input id="team-dep" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="לדוגמה: מכירות רכב" />
          </div>
          <div className="space-y-1">
            <Label>מנהל הצוות</Label>
            <Select value={managerId} onValueChange={setManagerId}>
              <SelectTrigger aria-label="בחירת מנהל"><SelectValue placeholder="בחרו מנהל" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>ללא מנהל</SelectItem>
                {managers.map((mm) => (
                  <SelectItem key={mm.id} value={mm.id}>{personName(mm)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              קובע מי מנהל את הצוות בפועל — הרשאות ניהול, יעדים, האזנות ומשוב נגזרות מהגדרה זו, לא
              משיוך הצוות בפרופיל המשתמש.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="team-desc">תיאור</Label>
            <Textarea id="team-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>פרופיל KPI</Label>
            <Select value={kpiProfile} onValueChange={(v) => setKpiProfile(v as KpiProfile)}>
              <SelectTrigger aria-label="בחירת פרופיל KPI"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="generic_sales">{KPI_PROFILE_LABEL.generic_sales}</SelectItem>
                <SelectItem value="renewals">{KPI_PROFILE_LABEL.renewals}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {kpiProfile === "renewals"
                ? "הצוות יציג גם מיועדות חודשיות, חידושים שנסגרו ואחוז חידוש בנוסף למדדים הכלליים."
                : "הצוות יציג יעד, ביצוע ואחוז עמידה ביעד בלבד."}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <div className="text-sm font-medium">צוות פעיל</div>
              <div className="text-xs text-muted-foreground">צוות מושבת לא יוצע לשיוך חדש</div>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label="סטטוס פעיל" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>{team ? "שמירה" : "הוספה"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamDetailsSheet({ teamId, onOpenChange, people, managers, teams, isAdmin, isManager, currentUserId, onChanged }: {
  teamId: string | null;
  onOpenChange: (o: boolean) => void;
  people: Person[];
  managers: Person[];
  teams: TeamRow[];
  isAdmin: boolean;
  isManager: boolean;
  currentUserId: string | null;
  onChanged: () => Promise<unknown> | void;
}) {
  const details = useServerFn(getTeamDetails);
  const assign = useServerFn(setUserTeam);
  const update = useServerFn(updateTeam);
  const listCandidates = useServerFn(listTeamAssignmentCandidates);
  const [addUserId, setAddUserId] = useState(NONE);
  const [description, setDescription] = useState("");
  // Pending confirmation for a transfer (the selected candidate already
  // belongs to another team) — P3a requires an explicit warning before an
  // "add" silently becomes a "remove from X, add to Y".
  const [pendingTransfer, setPendingTransfer] = useState<{ userId: string; userName: string; fromTeamName: string } | null>(null);

  const q = useQuery({
    queryKey: ["admin", "team-details", teamId],
    queryFn: () => details({ data: { team_id: teamId as string } }),
    enabled: !!teamId,
  });

  const team = q.data?.team as (TeamRow & { description: string | null }) | undefined;
  const members = (q.data?.members ?? []) as TeamMember[];
  // Representatives are sourced independently from representatives.team_id — a
  // representative has no `profiles` row (and so is never in `members`) unless a
  // login account is linked to it. Do not derive this list from `members`.
  const reps = (q.data?.representatives ?? []) as RepMember[];

  // Admin manages every team; a manager only their own — mirrors
  // canManageTeamRow but recomputed here since `team` only exists once loaded
  // (server-side enforcement is the real boundary; this only gates the UI).
  const canManageThisTeam = !!team && (isAdmin || (isManager && !!currentUserId && team.manager_id === currentUserId));
  // An inactive team is unavailable for new assignments (setUserTeam rejects
  // this server-side regardless of who asks) — the add/transfer controls
  // below only ever render when the team can actually accept one.
  const canAssignToThisTeam = canManageThisTeam && !!team?.active;

  // Correction (post-review): candidates now come from a dedicated,
  // permission-checked server function — never derived from the `people`
  // prop, which (for a manager) either omitted unassigned users entirely
  // (under the original RLS policy) or, briefly, exposed every unassigned
  // profile organization-wide (the reverted over-broad fix). See
  // listTeamAssignmentCandidates in team-admin.functions.ts for the exact
  // eligibility rule.
  const candidatesQ = useQuery({
    queryKey: ["admin", "team-assignment-candidates", teamId],
    queryFn: () => listCandidates({ data: { team_id: teamId as string } }),
    enabled: !!teamId && canAssignToThisTeam,
  });
  const candidates = candidatesQ.data ?? [];
  const teamNameById = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  useEffect(() => {
    setDescription(team?.description ?? "");
  }, [team?.id, team?.description]);

  const assignM = useMutation({
    mutationFn: (v: { user_id: string; team_id: string | null }) => assign({ data: v }),
    // Await the refresh before reporting success — the mutation's own request
    // already resolved, but the UI must not show a "done" toast while the
    // visible data (team-details sheet, admin teams table, header workspace
    // scope) is still the pre-mutation snapshot.
    onSuccess: async (_d, v) => {
      await Promise.all([q.refetch(), candidatesQ.refetch(), onChanged()]);
      toast.success(v.team_id ? "המשתמש שויך לצוות" : "המשתמש הוסר מהצוות");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const managerM = useMutation({
    mutationFn: (managerId: string | null) => update({
      data: {
        team_id: team!.id,
        name: team!.name,
        department: team!.department,
        description: team!.description,
        manager_id: managerId,
        active: team!.active,
        kpi_profile: team!.kpi_profile,
      },
    }),
    onSuccess: async () => {
      await Promise.all([q.refetch(), onChanged()]);
      toast.success("המנהל עודכן");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const profileM = useMutation({
    mutationFn: (kpiProfile: KpiProfile) => update({
      data: {
        team_id: team!.id,
        name: team!.name,
        department: team!.department,
        description: team!.description,
        manager_id: team!.manager_id,
        active: team!.active,
        kpi_profile: kpiProfile,
      },
    }),
    onSuccess: async () => {
      await Promise.all([q.refetch(), onChanged()]);
      toast.success("פרופיל ה-KPI עודכן");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Description is the one field a manager may edit for their own team
  // (P2b) — kept as its own mutation (not reused from managerM/profileM) so
  // saving it can never accidentally resubmit a manager_id/active value the
  // caller isn't allowed to change.
  const descriptionM = useMutation({
    mutationFn: (value: string) => update({
      data: {
        team_id: team!.id,
        name: team!.name,
        department: team!.department,
        description: value || null,
        manager_id: team!.manager_id,
        active: team!.active,
        kpi_profile: team!.kpi_profile,
      },
    }),
    onSuccess: async () => {
      await Promise.all([q.refetch(), onChanged()]);
      toast.success("התיאור עודכן");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleAddOrTransferClick() {
    if (addUserId === NONE) return toast.error("יש לבחור משתמש");
    const candidate = candidates.find((p) => p.id === addUserId);
    if (candidate?.team_id) {
      setPendingTransfer({
        userId: addUserId,
        userName: personName(candidate),
        fromTeamName: candidate.team_name ?? teamNameById.get(candidate.team_id) ?? "צוות אחר",
      });
      return;
    }
    assignM.mutate({ user_id: addUserId, team_id: team!.id });
    setAddUserId(NONE);
  }

  function confirmTransfer() {
    if (!pendingTransfer || !team) return;
    assignM.mutate({ user_id: pendingTransfer.userId, team_id: team.id });
    setAddUserId(NONE);
    setPendingTransfer(null);
  }

  const selectedCandidate = candidates.find((p) => p.id === addUserId);
  const isTransferSelection = !!selectedCandidate?.team_id;

  return (
    <Sheet open={!!teamId} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{team?.name ?? "פרטי צוות"}</SheetTitle>
        </SheetHeader>

        {q.isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="p-4 text-sm text-destructive">{(q.error as Error)?.message}</div>
        ) : team ? (
          <div className="space-y-5 p-4">
            {/* Identity band — name, status and KPI profile as one header
                surface instead of four equal stat boxes. */}
            <div className="surface-page-header rounded-2xl p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-display text-lg font-extrabold">{team.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {team.department || "ללא שיוך מחלקה"}
                  </div>
                </div>
                <Badge variant={team.active ? "default" : "secondary"} className="shrink-0">
                  {team.active ? "פעיל" : "מושבת"}
                </Badge>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <KpiProfileBadge profile={team.kpi_profile ?? DEFAULT_KPI_PROFILE} />
                <Badge variant="outline" className="gap-1">
                  <Users2 className="h-3 w-3" />
                  {reps.length} נציגים
                </Badge>
                <Badge variant="outline">{members.length} חשבונות</Badge>
                <Badge variant="outline">{members.filter((m) => m.active).length} פעילים</Badge>
              </div>
            </div>
            {!team.active && (
              <p className="text-xs text-muted-foreground">
                הצוות מושבת ואינו זמין לשיוך חדש — הנתונים וההיסטוריה שלו (חברים, נציגים, יעדים,
                ביצועים) נותרים זמינים לצפייה במלואם.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="team-description">תיאור</Label>
              {canManageThisTeam ? (
                <div className="space-y-2">
                  <Textarea
                    id="team-description"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="תיאור הצוות"
                  />
                  {description !== (team.description ?? "") && (
                    <Button
                      size="sm"
                      onClick={() => descriptionM.mutate(description)}
                      disabled={descriptionM.isPending}
                    >
                      שמירת תיאור
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{team.description || "—"}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>מנהל הצוות</Label>
              {isAdmin ? (
                <Select
                  value={team.manager_id ?? NONE}
                  onValueChange={(v) => managerM.mutate(v === NONE ? null : v)}
                >
                  <SelectTrigger aria-label="שיוך מנהל לצוות">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>ללא מנהל</SelectItem>
                    {managers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {personName(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-sm">
                  {team.manager_id ? personName(people.find((p) => p.id === team.manager_id)) : "—"}
                  {canManageThisTeam && (
                    <span className="ms-1 text-xs text-muted-foreground">
                      (שינוי מנהל מיועד למנהלי מערכת בלבד)
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>פרופיל KPI</Label>
              {canManageThisTeam ? (
                <Select
                  value={team.kpi_profile ?? DEFAULT_KPI_PROFILE}
                  onValueChange={(v) => profileM.mutate(v as KpiProfile)}
                >
                  <SelectTrigger aria-label="שינוי פרופיל KPI">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generic_sales">{KPI_PROFILE_LABEL.generic_sales}</SelectItem>
                    <SelectItem value="renewals">{KPI_PROFILE_LABEL.renewals}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <KpiProfileBadge profile={team.kpi_profile ?? DEFAULT_KPI_PROFILE} />
              )}
            </div>

            <div className="space-y-2">
              <Label>חברי הצוות</Label>
              <p className="text-xs text-muted-foreground">
                משתמשים עם חשבון התחברות המשויכים לצוות — מנהלים, מנהלי מערכת ונציגים בעלי חשבון.
                נציג ללא חשבון מופיע רק תחת "נציגים בצוות" למטה.
              </p>
              {members.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                  אין עדיין משתמשים משויכים לצוות
                </div>
              ) : (
                <div className="space-y-2">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2.5 rounded-xl border p-2.5">
                      <InitialsAvatar name={personName(m)} className="h-8 w-8" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{personName(m)}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {m.roles.includes("representative")
                            ? "נציג"
                            : m.roles.includes("manager")
                              ? "מנהל צוות"
                              : m.roles.includes("admin")
                                ? "מנהל מערכת"
                                : "ללא תפקיד"}
                          {m.business_id ? ` · ${m.business_id}` : ""}
                        </div>
                      </div>
                      {/* Requirement 6 (post-review): a manager may remove only an
                          eligible representative member — never every row — since
                          setUserTeam itself now rejects removing an admin/manager/
                          non-representative account for a manager actor. Admin keeps
                          the existing organization-wide capability. */}
                      {canManageThisTeam &&
                        (isAdmin || canManagerRemoveTarget({ roles: m.roles })) && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`הסרת ${personName(m)} מהצוות`}
                              >
                                <UserMinus className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent dir="rtl">
                              <AlertDialogHeader>
                                <AlertDialogTitle>הסרת משתמש מהצוות?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  השיוך לצוות יוסר. חשבון המשתמש והנתונים שלו יישמרו.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>ביטול</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => assignM.mutate({ user_id: m.id, team_id: null })}
                                >
                                  הסרה
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>נציגים בצוות</Label>
              <p className="text-xs text-muted-foreground">
                כלל הנציגים המשויכים לצוות, כולל נציגים ללא חשבון התחברות. נציג עם חשבון מופיע גם
                ברשימת "חברי הצוות" למעלה.
              </p>
              {reps.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                  אין עדיין נציגים משויכים לצוות
                </div>
              ) : (
                <div className="space-y-2">
                  {reps.map((r) => (
                    <div key={r.id} className="flex items-center gap-2.5 rounded-xl border p-2.5">
                      <InitialsAvatar name={r.name} className="h-8 w-8" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.user_id ? "מקושר לחשבון משתמש" : "ללא חשבון משתמש"}
                          {r.external_ref ? ` · ${r.external_ref}` : ""}
                        </div>
                      </div>
                      {!r.active && <Badge variant="secondary">מושבת</Badge>}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                שיוך נציגים לצוות מנוהל מעמוד <span className="font-medium">ניהול נציגים</span>, לא
                מכאן.
              </p>
            </div>

            {canManageThisTeam && !team.active && (
              <p className="text-xs text-muted-foreground">
                לא ניתן להוסיף או להעביר משתמשים לצוות מושבת. יש להפעיל את הצוות מחדש כדי לשייך אליו
                משתמשים.
              </p>
            )}

            {canAssignToThisTeam && (
              <div className="space-y-2">
                <Label>{isTransferSelection ? "העברת משתמש לצוות" : "הוספת משתמש לצוות"}</Label>
                <p className="text-xs text-muted-foreground">
                  הרשימה כוללת רק חשבונות נציג פעילים — משתמשים ללא שיוך, וכאלה המשויכים כבר לצוות
                  אחר שבניהולכם. בחירה במשויך לצוות אחר מעבירה אותו לכאן, ולא רק "מוסיפה".
                </p>
                <div className="flex gap-2">
                  <Select value={addUserId} onValueChange={setAddUserId}>
                    <SelectTrigger aria-label="בחירת משתמש להוספה או העברה">
                      <SelectValue placeholder="בחרו משתמש" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>בחרו משתמש</SelectItem>
                      {candidates.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {personName(p)} —{" "}
                          {p.team_id
                            ? `משויך כרגע לצוות ${p.team_name ?? "אחר"}`
                            : "לא משויך לצוות"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleAddOrTransferClick}
                    aria-label={isTransferSelection ? "העברת משתמש לצוות" : "הוספת משתמש לצוות"}
                  >
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </div>

                <AlertDialog
                  open={!!pendingTransfer}
                  onOpenChange={(o) => {
                    if (!o) setPendingTransfer(null);
                  }}
                >
                  <AlertDialogContent dir="rtl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>העברת משתמש לצוות אחר?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {pendingTransfer &&
                          `המשתמש ${pendingTransfer.userName} יוסר מצוות ${pendingTransfer.fromTeamName} ויועבר לצוות ${team.name}.`}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>ביטול</AlertDialogCancel>
                      <AlertDialogAction onClick={confirmTransfer}>העברה</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Admin-only business hierarchy configuration (§business hierarchy
 * foundation): פעילות ← מוקד ← צוות, plus per-manager business scopes
 * (מנהל מוקד / מנהל פעילות / סמנכ"ל-מנהל ממ"ט). Deliberately minimal — this
 * configures scope METADATA only. It never touches teams.manager_id (the
 * authoritative team-manager ownership), never changes the technical role
 * enum, and the admin stays "מנהל מערכת" rather than a business executive.
 */
type HierarchyUnit = {
  id: string;
  name: string;
  unitType: "activity" | "center";
  parentId: string | null;
};

/** Admin-only edit/delete actions on a hierarchy row (עריכה / מחיקה). */
function UnitRowActions({
  unit,
  onEdit,
  onDelete,
}: {
  unit: HierarchyUnit;
  onEdit: (u: HierarchyUnit) => void;
  onDelete: (u: HierarchyUnit) => void;
}) {
  return (
    <span className="ms-auto flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        aria-label="עריכה"
        title="עריכה"
        onClick={() => onEdit(unit)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive"
        aria-label="מחיקה"
        title="מחיקה"
        onClick={() => onDelete(unit)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </span>
  );
}

function BusinessHierarchyCard({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const listFn = useServerFn(listBusinessHierarchy);
  const createUnitFn = useServerFn(createBusinessUnit);
  const updateUnitFn = useServerFn(updateBusinessUnit);
  const deleteUnitFn = useServerFn(deleteBusinessUnit);
  const attachFn = useServerFn(attachTeamToUnit);
  const setScopeFn = useServerFn(setUserBusinessScope);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["admin", "business-hierarchy"],
    queryFn: () => listFn(),
  });
  const view = q.data;

  const [unitName, setUnitName] = useState("");
  const [unitType, setUnitType] = useState<"activity" | "center">("activity");
  const [unitParent, setUnitParent] = useState<string>("");
  const [attachTeam, setAttachTeam] = useState<string>("");
  const [attachUnit, setAttachUnit] = useState<string>(NONE);
  const [scopeUser, setScopeUser] = useState<string>("");
  const [scopeType, setScopeType] = useState<"none" | "center" | "activity" | "executive">("none");
  const [scopeUnit, setScopeUnit] = useState<string>("");
  // Edit / delete a unit (admin-only, guarded server-side).
  const [editUnit, setEditUnit] = useState<HierarchyUnit | null>(null);
  const [editName, setEditName] = useState("");
  const [editParent, setEditParent] = useState<string>("");
  const [deleteUnit, setDeleteUnit] = useState<HierarchyUnit | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin", "business-hierarchy"] });
    await onChanged();
    // The caller's own resolved scope may have changed too.
    await qc.invalidateQueries({ queryKey: ["business-scope"] });
  };

  const createUnitM = useMutation({
    mutationFn: () =>
      createUnitFn({
        data: {
          name: unitName,
          unitType,
          parentId: unitType === "center" ? unitParent || null : null,
        },
      }),
    onSuccess: async () => {
      await refresh();
      setUnitName("");
      toast.success("היחידה העסקית נוצרה");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const attachM = useMutation({
    mutationFn: () =>
      attachFn({
        data: {
          teamId: attachTeam,
          unitId: attachUnit === NONE ? null : attachUnit,
        },
      }),
    onSuccess: async () => {
      await refresh();
      toast.success("שיוך הצוות עודכן");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateUnitM = useMutation({
    mutationFn: () =>
      updateUnitFn({
        data: {
          unitId: editUnit?.id ?? "",
          name: editName,
          // Only a center may move to a different parent activity; the type
          // itself is immutable and is not sent at all.
          ...(editUnit?.unitType === "center" ? { parentId: editParent || null } : {}),
        },
      }),
    onSuccess: async () => {
      await refresh();
      setEditUnit(null);
      toast.success("היחידה עודכנה");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteUnitM = useMutation({
    mutationFn: () => deleteUnitFn({ data: { unitId: deleteUnit?.id ?? "" } }),
    onSuccess: async () => {
      await refresh();
      setDeleteUnit(null);
      toast.success("היחידה נמחקה");
    },
    onError: (e: Error) => {
      setDeleteUnit(null);
      toast.error(e.message);
    },
  });
  const openEdit = (u: HierarchyUnit) => {
    setEditUnit(u);
    setEditName(u.name);
    setEditParent(u.parentId ?? "");
  };
  const setScopeM = useMutation({
    mutationFn: () =>
      setScopeFn({
        data: {
          userId: scopeUser,
          scopeType,
          unitId: scopeType === "center" || scopeType === "activity" ? scopeUnit || null : null,
        },
      }),
    onSuccess: async () => {
      await refresh();
      toast.success("היקף הניהול עודכן");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activities = (view?.units ?? []).filter((u) => u.unitType === "activity");
  const centers = (view?.units ?? []).filter((u) => u.unitType === "center");
  const teamsByUnit = new Map<string, string[]>();
  for (const t of view?.teams ?? []) {
    if (!t.businessUnitId) continue;
    teamsByUnit.set(t.businessUnitId, [...(teamsByUnit.get(t.businessUnitId) ?? []), t.name]);
  }
  const scopeUnitOptions = scopeType === "activity" ? activities : centers;
  // Teams attached directly to an activity predate the centers-only rule and
  // are surfaced for a manual admin fix (they keep working for scope until then).
  const activityAttachedTeams = (view?.teams ?? []).filter(
    (t) => t.businessUnitId !== null && activities.some((a) => a.id === t.businessUnitId),
  );

  return (
    <div className="space-y-4">
      <SectionHeading
        title="היררכיה עסקית"
        hint={`סמנכ"ל / מנהל ממ"ט ← מנהל פעילות ← מנהל מוקד ← מנהל צוות ← נציג. ההיקפים העסקיים נוספים מעל הבעלות הישירה על צוות (teams.manager_id) ואינם משנים אותה; מנהל מערכת נשאר מנהל מערכת בלבד.`}
      />

      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">טעינת ההיררכיה העסקית נכשלה.</p>
      ) : !view?.ready ? (
        <p className="text-sm text-muted-foreground">{HIERARCHY_TABLES_MISSING_MESSAGE}</p>
      ) : (
        <>
          {/* ---- Current structure: activity → centers → attached teams ---- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="h-4 w-4 text-primary" />
                המבנה הנוכחי
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activities.length === 0 && centers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  טרם הוגדרו פעילויות או מוקדים. צרו פעילות ראשונה כדי להתחיל.
                </p>
              ) : (
                <div className="space-y-3">
                  {activities.map((a) => {
                    const activityTeams = teamsByUnit.get(a.id) ?? [];
                    const childCenters = centers.filter((c) => c.parentId === a.id);
                    return (
                      <div key={a.id} className="rounded-xl border">
                        <div className="flex flex-wrap items-center gap-2 border-b bg-surface-subtle p-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                            <Building2 className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 truncate font-display font-bold">{a.name}</span>
                          <Badge variant="secondary">פעילות</Badge>
                          <Badge variant="outline">{childCenters.length} מוקדים</Badge>
                          <div className="ms-auto">
                            <UnitRowActions unit={a} onEdit={openEdit} onDelete={setDeleteUnit} />
                          </div>
                        </div>
                        <div className="space-y-2 p-3">
                          {childCenters.length === 0 && activityTeams.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              אין מוקדים משויכים לפעילות זו.
                            </p>
                          )}
                          {childCenters.map((c) => {
                            const centerTeams = teamsByUnit.get(c.id) ?? [];
                            return (
                              <div key={c.id} className="rounded-lg border p-2.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline">מוקד</Badge>
                                  <span className="min-w-0 truncate text-sm font-medium">
                                    {c.name}
                                  </span>
                                  <Badge variant="outline" className="text-muted-foreground">
                                    {centerTeams.length} צוותים
                                  </Badge>
                                  <div className="ms-auto">
                                    <UnitRowActions
                                      unit={c}
                                      onEdit={openEdit}
                                      onDelete={setDeleteUnit}
                                    />
                                  </div>
                                </div>
                                {/* An empty center stays visible and honest — it is
                                  a real structural fact, not a rendering gap. */}
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {centerTeams.length === 0 ? (
                                    <span className="text-xs text-muted-foreground">
                                      ללא צוותים משויכים
                                    </span>
                                  ) : (
                                    centerTeams.map((name) => (
                                      <Badge key={name} variant="secondary" className="font-normal">
                                        <ChevronLeft className="h-3 w-3 opacity-60" />
                                        {name}
                                      </Badge>
                                    ))
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {/* Legacy: teams hanging directly off the activity. */}
                          {activityTeams.length > 0 && (
                            <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 p-2.5">
                              <div className="text-xs font-semibold text-warning-foreground">
                                צוותים המשויכים ישירות לפעילות
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {activityTeams.map((name) => (
                                  <Badge key={name} variant="outline" className="font-normal">
                                    {name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {centers
                    .filter((c) => !c.parentId)
                    .map((c) => (
                      <div
                        key={c.id}
                        className="rounded-xl border p-3 flex flex-wrap items-center gap-2"
                      >
                        <Badge variant="outline">מוקד</Badge>
                        <span className="text-sm">{c.name}</span>
                        <span className="text-xs text-muted-foreground">ללא פעילות אב</span>
                        <div className="ms-auto">
                          <UnitRowActions unit={c} onEdit={openEdit} onDelete={setDeleteUnit} />
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {/* Legacy rows from before the centers-only rule: never rewritten
                automatically — the admin moves each team to a center manually. */}
              {activityAttachedTeams.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 p-2.5 text-xs text-warning-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    צוות ניתן לשייך למוקד בלבד — הפעילות נקבעת דרך המוקד. הצוותים הבאים משויכים
                    ישירות לפעילות ויש להעבירם למוקד:{" "}
                    {activityAttachedTeams.map((t) => t.name).join(", ")}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---- Management actions, one purpose per surface ---- */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plus className="h-4 w-4 text-primary" />
                  יחידה עסקית חדשה
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Create unit */}
                <div className="grid grid-cols-1 gap-3 items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="bh-unit-name">שם יחידה חדשה</Label>
                    <Input
                      id="bh-unit-name"
                      value={unitName}
                      onChange={(e) => setUnitName(e.target.value)}
                      placeholder="למשל: פעילות חידושים"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>סוג</Label>
                    <Select
                      value={unitType}
                      onValueChange={(v) => setUnitType(v as "activity" | "center")}
                    >
                      <SelectTrigger aria-label="סוג יחידה">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="activity">פעילות</SelectItem>
                        <SelectItem value="center">מוקד</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {unitType === "center" && (
                    <div className="space-y-1.5">
                      <Label>פעילות אב</Label>
                      <Select value={unitParent} onValueChange={setUnitParent}>
                        <SelectTrigger aria-label="פעילות אב">
                          <SelectValue placeholder="בחרו פעילות" />
                        </SelectTrigger>
                        <SelectContent>
                          {activities.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      !unitName.trim() ||
                      (unitType === "center" && !unitParent) ||
                      createUnitM.isPending
                    }
                    onClick={() => createUnitM.mutate()}
                  >
                    <Plus className="ms-1 h-4 w-4" />
                    הוספת יחידה
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="h-4 w-4 text-primary" />
                  שיוך צוות למוקד
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Attach team */}
                <div className="grid grid-cols-1 gap-3 items-end">
                  <div className="space-y-1.5">
                    <Label>שיוך צוות ליחידה</Label>
                    <Select value={attachTeam} onValueChange={setAttachTeam}>
                      <SelectTrigger aria-label="בחירת צוות לשיוך">
                        <SelectValue placeholder="בחרו צוות" />
                      </SelectTrigger>
                      <SelectContent>
                        {(view.teams ?? []).map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    {/* Teams attach to CENTERS only — the activity is inherited
                    through the center, so activities are not offered here. */}
                    <Label>מוקד</Label>
                    <Select value={attachUnit} onValueChange={setAttachUnit}>
                      <SelectTrigger aria-label="בחירת מוקד">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>ללא שיוך</SelectItem>
                        {centers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {centerOptionLabel(c, view.units ?? [])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!attachTeam || attachM.isPending}
                    onClick={() => attachM.mutate()}
                  >
                    עדכון שיוך
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  היקף ניהול למנהל
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Assign manager scope */}
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-3 items-end">
                    <div className="space-y-1.5">
                      <Label>היקף ניהול למנהל</Label>
                      <Select value={scopeUser} onValueChange={setScopeUser}>
                        <SelectTrigger aria-label="בחירת מנהל">
                          <SelectValue placeholder="בחרו מנהל" />
                        </SelectTrigger>
                        <SelectContent>
                          {(view.managers ?? []).map((m) => (
                            <SelectItem key={m.userId} value={m.userId}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>סוג היקף</Label>
                      <Select
                        value={scopeType}
                        onValueChange={(v) => {
                          setScopeType(v as typeof scopeType);
                          setScopeUnit("");
                        }}
                      >
                        <SelectTrigger aria-label="סוג היקף">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">ללא היקף נוסף (מנהל צוות)</SelectItem>
                          <SelectItem value="center">מנהל מוקד</SelectItem>
                          <SelectItem value="activity">מנהל פעילות</SelectItem>
                          <SelectItem value="executive">סמנכ"ל / מנהל ממ"ט</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {(scopeType === "center" || scopeType === "activity") && (
                      <div className="space-y-1.5">
                        <Label>{scopeType === "activity" ? "פעילות" : "מוקד"}</Label>
                        <Select value={scopeUnit} onValueChange={setScopeUnit}>
                          <SelectTrigger aria-label="בחירת יחידה להיקף">
                            <SelectValue placeholder="בחרו יחידה" />
                          </SelectTrigger>
                          <SelectContent>
                            {scopeUnitOptions.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        !scopeUser ||
                        ((scopeType === "center" || scopeType === "activity") && !scopeUnit) ||
                        setScopeM.isPending
                      }
                      onClick={() => setScopeM.mutate()}
                    >
                      עדכון היקף
                    </Button>
                  </div>
                  {(view.grants ?? []).length > 0 && (
                    <div className="space-y-1 border-t pt-2">
                      <div className="text-xs font-semibold text-muted-foreground">
                        היקפים מוגדרים
                      </div>
                      {view.grants.map((g) => (
                        <div
                          key={`${g.userId}-${g.scopeType}-${g.businessUnitId ?? "all"}`}
                          className="flex min-w-0 items-center gap-2 rounded-lg border p-2"
                        >
                          <InitialsAvatar name={g.userName} className="h-7 w-7 text-[10px]" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{g.userName}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {g.scopeType === "executive"
                                ? 'סמנכ"ל / מנהל ממ"ט (כלל הפעילות העסקית)'
                                : `${g.scopeType === "activity" ? "מנהל פעילות" : "מנהל מוקד"}${g.unitName ? ` · ${g.unitName}` : ""}`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Edit unit — the name (and, for a center, the parent activity).
            The unit TYPE is immutable and has no control here. */}
      <Dialog open={!!editUnit} onOpenChange={(o) => !o && setEditUnit(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editUnit?.unitType === "activity" ? "עריכת פעילות" : "עריכת מוקד"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bh-edit-name">שם היחידה</Label>
              <Input
                id="bh-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            {editUnit?.unitType === "center" && (
              <div className="space-y-1.5">
                <Label>פעילות אב</Label>
                <Select value={editParent} onValueChange={setEditParent}>
                  <SelectTrigger aria-label="פעילות אב">
                    <SelectValue placeholder="בחרו פעילות" />
                  </SelectTrigger>
                  <SelectContent>
                    {activities.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditUnit(null)}>
              ביטול
            </Button>
            <Button
              size="sm"
              disabled={updateUnitM.isPending}
              onClick={() => {
                if (!editName.trim()) {
                  toast.error(UNIT_NAME_REQUIRED_MESSAGE);
                  return;
                }
                updateUnitM.mutate();
              }}
            >
              שמירת שינויים
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete unit — explicit confirmation; the server refuses any unit
            that still has centers, teams or active scope grants. */}
      <AlertDialog open={!!deleteUnit} onOpenChange={(o) => !o && setDeleteUnit(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteUnit?.unitType === "activity" ? "מחיקת פעילות" : "מחיקת מוקד"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              הפעולה תמחק את היחידה מההיררכיה העסקית. לא ניתן לבטל פעולה זו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteUnitM.isPending}
              onClick={() => deleteUnitM.mutate()}
            >
              מחיקה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
