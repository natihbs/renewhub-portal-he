import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { UsersRound, Plus, Search, Pencil, Trash2, Power, UserPlus, UserMinus, AlertTriangle } from "lucide-react";
import { requireRole } from "@/lib/require-role";
import { formatDateIL } from "@/lib/format";
import {
  listTeams, getTeamDetails, createTeam, updateTeam, deleteTeam, setTeamActive, setUserTeam,
} from "@/lib/team-admin.functions";
import { useWorkspace } from "@/lib/workspace-context";
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
    qc.invalidateQueries({ queryKey: ["representatives"] }),
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

  const teams = (teamsQ.data?.teams ?? []) as TeamRow[];
  const people = (teamsQ.data?.people ?? []) as Person[];
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
      if (managerFilter !== "all" && managerFilter !== NONE && t.manager_id !== managerFilter) return false;
      if (profileFilter !== "all" && (t.kpi_profile ?? DEFAULT_KPI_PROFILE) !== profileFilter) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortBy === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (sortBy === "members") return b.member_count - a.member_count;
      return a.name.localeCompare(b.name, "he");
    });
    return rows;
  }, [teams, search, statusFilter, managerFilter, profileFilter, sortBy, peopleById]);

  const del = useServerFn(deleteTeam);
  const toggleActive = useServerFn(setTeamActive);

  const delM = useMutation({
    mutationFn: (team_id: string) => del({ data: { team_id } }),
    // Await the full invalidation/refetch before the success toast — the
    // deleted team must actually be gone from the table by the time "הצוות
    // נמחק" appears, matching every other Teams mutation's pattern (P3b).
    onSuccess: async () => { await invalidate(); toast.success("הצוות נמחק"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const activeM = useMutation({
    mutationFn: (v: { team_id: string; active: boolean }) => toggleActive({ data: v }),
    onSuccess: async (_d, v) => { await invalidate(); toast.success(v.active ? "הצוות הופעל" : "הצוות הושבת"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="ניהול צוותים"
        description="יצירה, עריכה והשבתה של צוותים, שיוך מנהלים ונציגים"
        actions={canManage ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="ms-1 h-4 w-4" />הוספת צוות</Button> : undefined}
      />

      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative">
              <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש צוות, מחלקה או מנהל"
                aria-label="חיפוש צוותים"
                className="pe-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="סינון לפי סטטוס"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסטטוסים</SelectItem>
                <SelectItem value="active">פעיל</SelectItem>
                <SelectItem value="inactive">מושבת</SelectItem>
              </SelectContent>
            </Select>
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger aria-label="סינון לפי מנהל"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל המנהלים</SelectItem>
                <SelectItem value={NONE}>ללא מנהל</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{personName(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={profileFilter} onValueChange={(v) => setProfileFilter(v as "all" | KpiProfile)}>
              <SelectTrigger aria-label="סינון לפי פרופיל KPI"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הפרופילים</SelectItem>
                <SelectItem value="generic_sales">{KPI_PROFILE_LABEL.generic_sales}</SelectItem>
                <SelectItem value="renewals">{KPI_PROFILE_LABEL.renewals}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger aria-label="מיון"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">מיון לפי שם</SelectItem>
                <SelectItem value="created">מיון לפי תאריך יצירה</SelectItem>
                <SelectItem value="members">מיון לפי מספר חברים</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {teamsQ.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : teamsQ.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="שגיאה בטעינת הצוותים"
              description={(teamsQ.error as Error)?.message ?? "לא הצלחנו לטעון את רשימת הצוותים"}
              action={<Button size="sm" onClick={() => teamsQ.refetch()}>ניסיון חוזר</Button>}
              compact
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={teams.length === 0 ? "עדיין לא הוגדרו צוותים" : "לא נמצאו צוותים תואמים"}
              description={teams.length === 0 ? "הוסיפו צוות ראשון כדי לשייך אליו מנהל ונציגים." : "נסו לשנות את החיפוש או הסינון."}
              action={canManage && teams.length === 0 ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="ms-1 h-4 w-4" />הוספת צוות</Button> : undefined}
              compact
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>שם הצוות</TableHead>
                      <TableHead>מחלקה / פעילות</TableHead>
                      <TableHead>פרופיל KPI</TableHead>
                      <TableHead>מנהל משויך</TableHead>
                      <TableHead>נציגים</TableHead>
                      <TableHead>סטטוס</TableHead>
                      <TableHead>נוצר בתאריך</TableHead>
                      <TableHead>פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((t) => (
                      <TableRow key={t.id} className="cursor-pointer" onClick={() => setOpenTeamId(t.id)}>
                        <TableCell className="font-semibold">{t.name}</TableCell>
                        <TableCell className="text-muted-foreground">{t.department || "—"}</TableCell>
                        <TableCell><KpiProfileBadge profile={t.kpi_profile ?? DEFAULT_KPI_PROFILE} /></TableCell>
                        <TableCell>{t.manager_id ? personName(peopleById.get(t.manager_id)) : "—"}</TableCell>
                        <TableCell>{t.rep_count} / {t.member_count}</TableCell>
                        <TableCell>
                          <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "פעיל" : "מושבת"}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDateIL(t.created_at)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <RowActions
                            team={t}
                            canManage={canManage}
                            canManageThisTeam={canManageTeamRow(t, { isAdmin, isManager, currentUserId })}
                            onEdit={() => setEditTeam(t)}
                            onToggle={() => activeM.mutate({ team_id: t.id, active: !t.active })}
                            onDelete={() => delM.mutate(t.id)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {filtered.map((t) => (
                  <div key={t.id} className="card-interactive cursor-pointer rounded-xl border p-3" onClick={() => setOpenTeamId(t.id)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.department || "ללא מחלקה"}</div>
                      </div>
                      <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "פעיל" : "מושבת"}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                      <div>מנהל: {t.manager_id ? personName(peopleById.get(t.manager_id)) : "—"}</div>
                      <div>נציגים: {t.rep_count} / {t.member_count}</div>
                      <div>נוצר: {formatDateIL(t.created_at)}</div>
                      <div><KpiProfileBadge profile={t.kpi_profile ?? DEFAULT_KPI_PROFILE} /></div>
                    </div>
                    <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        team={t}
                        canManage={canManage}
                        canManageThisTeam={canManageTeamRow(t, { isAdmin, isManager, currentUserId })}
                        onEdit={() => setEditTeam(t)}
                        onToggle={() => activeM.mutate({ team_id: t.id, active: !t.active })}
                        onDelete={() => delM.mutate(t.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
          onOpenChange={(o) => { if (!o) setEditTeam(null); }}
          managers={managers}
          team={editTeam}
          onSaved={invalidate}
        />
      )}

      <TeamDetailsSheet
        teamId={openTeamId}
        onOpenChange={(o) => { if (!o) setOpenTeamId(null); }}
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
            <Label>מנהל משויך</Label>
            <Select value={managerId} onValueChange={setManagerId}>
              <SelectTrigger aria-label="בחירת מנהל"><SelectValue placeholder="בחרו מנהל" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>ללא מנהל</SelectItem>
                {managers.map((mm) => (
                  <SelectItem key={mm.id} value={mm.id}>{personName(mm)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                ? "הצוות יציג גם הזדמנויות חידוש, חידושים שבוצעו ואחוז חידוש בנוסף למדדים הכלליים."
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
  // Every candidate the picker below can select — unassigned users AND users
  // already on another team (P3a: shown and clearly labeled, never hidden, so
  // picking one is an informed transfer rather than a silent surprise).
  const candidates = people.filter((p) => p.team_id !== teamId);
  const teamNameById = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  // Admin manages every team; a manager only their own — mirrors
  // canManageTeamRow but recomputed here since `team` only exists once loaded
  // (server-side enforcement is the real boundary; this only gates the UI).
  const canManageThisTeam = !!team && (isAdmin || (isManager && !!currentUserId && team.manager_id === currentUserId));

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
      await Promise.all([q.refetch(), onChanged()]);
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
    const candidate = people.find((p) => p.id === addUserId);
    if (candidate?.team_id) {
      setPendingTransfer({
        userId: addUserId,
        userName: personName(candidate),
        fromTeamName: teamNameById.get(candidate.team_id) ?? "צוות אחר",
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

  const selectedCandidate = people.find((p) => p.id === addUserId);
  const isTransferSelection = !!selectedCandidate?.team_id;

  return (
    <Sheet open={!!teamId} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{team?.name ?? "פרטי צוות"}</SheetTitle>
        </SheetHeader>

        {q.isLoading ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : q.isError ? (
          <div className="p-4 text-sm text-destructive">{(q.error as Error)?.message}</div>
        ) : team ? (
          <div className="space-y-5 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="חברי צוות" value={String(members.length)} />
              <Stat label="נציגים" value={String(reps.length)} />
              <Stat label="משתמשים פעילים" value={String(members.filter((m) => m.active).length)} />
              <Stat label="סטטוס" value={team.active ? "פעיל" : "מושבת"} />
            </div>
            {!team.active && (
              <p className="text-xs text-muted-foreground">
                הצוות מושבת ואינו זמין לשיוך חדש — הנתונים וההיסטוריה שלו (חברים, נציגים, יעדים, ביצועים) נותרים זמינים לצפייה במלואם.
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
                    <Button size="sm" onClick={() => descriptionM.mutate(description)} disabled={descriptionM.isPending}>
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
                  <SelectTrigger aria-label="שיוך מנהל לצוות"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>ללא מנהל</SelectItem>
                    {managers.map((m) => <SelectItem key={m.id} value={m.id}>{personName(m)}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-sm">
                  {team.manager_id ? personName(people.find((p) => p.id === team.manager_id)) : "—"}
                  {canManageThisTeam && <span className="ms-1 text-xs text-muted-foreground">(שינוי מנהל מיועד למנהלי מערכת בלבד)</span>}
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
                  <SelectTrigger aria-label="שינוי פרופיל KPI"><SelectValue /></SelectTrigger>
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
                    <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl border p-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{personName(m)}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {m.roles.includes("representative") ? "נציג" : m.roles.includes("manager") ? "מנהל" : m.roles.includes("admin") ? "מנהל מערכת" : "ללא תפקיד"}
                          {m.business_id ? ` · ${m.business_id}` : ""}
                        </div>
                      </div>
                      {canManageThisTeam && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label={`הסרת ${personName(m)} מהצוות`}>
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
                              <AlertDialogAction onClick={() => assignM.mutate({ user_id: m.id, team_id: null })}>הסרה</AlertDialogAction>
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
                כלל הנציגים המשויכים לצוות, כולל נציגים ללא חשבון התחברות. נציג עם חשבון
                מופיע גם ברשימת "חברי הצוות" למעלה.
              </p>
              {reps.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                  אין עדיין נציגים משויכים לצוות
                </div>
              ) : (
                <div className="space-y-2">
                  {reps.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border p-2.5">
                      <div className="min-w-0">
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
                שיוך נציגים לצוות מנוהל מעמוד <span className="font-medium">ניהול נציגים</span>, לא מכאן.
              </p>
            </div>

            {canManageThisTeam && (
              <div className="space-y-2">
                <Label>{isTransferSelection ? "העברת משתמש לצוות" : "הוספת משתמש לצוות"}</Label>
                <p className="text-xs text-muted-foreground">
                  הרשימה כוללת גם משתמשים המשויכים כבר לצוות אחר — בחירה בהם מעבירה אותם לכאן, ולא רק "מוסיפה".
                </p>
                <div className="flex gap-2">
                  <Select value={addUserId} onValueChange={setAddUserId}>
                    <SelectTrigger aria-label="בחירת משתמש להוספה או העברה"><SelectValue placeholder="בחרו משתמש" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>בחרו משתמש</SelectItem>
                      {candidates.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {personName(p)} — {p.team_id ? `משויך כרגע לצוות ${teamNameById.get(p.team_id) ?? "אחר"}` : "לא משויך לצוות"}
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

                <AlertDialog open={!!pendingTransfer} onOpenChange={(o) => { if (!o) setPendingTransfer(null); }}>
                  <AlertDialogContent dir="rtl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>העברת משתמש לצוות אחר?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {pendingTransfer && `המשתמש ${pendingTransfer.userName} יוסר מצוות ${pendingTransfer.fromTeamName} ויועבר לצוות ${team.name}.`}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
