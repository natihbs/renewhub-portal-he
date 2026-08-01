import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export const Route = createFileRoute("/_authenticated/teams")({
  beforeLoad: () => requireRole(["admin", "manager"]),
  head: () => ({
    meta: [
      { title: "ניהול צוותים · Pulse" },
      { name: "description", content: "ניהול צוותי חידושים, מנהלים ונציגים" },
      { property: "og:title", content: "ניהול צוותים · Pulse" },
      { property: "og:description", content: "ניהול צוותי חידושים, מנהלים ונציגים" },
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

function personName(p: { full_name: string | null; email: string | null } | undefined | null) {
  return p?.full_name || p?.email || "—";
}

function TeamsPage() {
  const list = useServerFn(listTeams);
  const qc = useQueryClient();
  const teamsQ = useQuery({ queryKey: ["admin", "teams"], queryFn: () => list() });

  const teams = (teamsQ.data?.teams ?? []) as TeamRow[];
  const people = (teamsQ.data?.people ?? []) as Person[];
  const canManage = !!teamsQ.data?.canManage;

  const managers = people.filter((p) => p.roles.includes("manager") || p.roles.includes("admin"));
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "created" | "members">("name");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState<TeamRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "teams"] });
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    qc.invalidateQueries({ queryKey: ["admin", "team-details"] });
  };

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
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortBy === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (sortBy === "members") return b.member_count - a.member_count;
      return a.name.localeCompare(b.name, "he");
    });
    return rows;
  }, [teams, search, statusFilter, managerFilter, sortBy, peopleById]);

  const del = useServerFn(deleteTeam);
  const toggleActive = useServerFn(setTeamActive);

  const delM = useMutation({
    mutationFn: (team_id: string) => del({ data: { team_id } }),
    onSuccess: () => { toast.success("הצוות נמחק"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const activeM = useMutation({
    mutationFn: (v: { team_id: string; active: boolean }) => toggleActive({ data: v }),
    onSuccess: (_d, v) => { toast.success(v.active ? "הצוות הופעל" : "הצוות הושבת"); invalidate(); },
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  <div key={t.id} className="rounded-xl border p-3" onClick={() => setOpenTeamId(t.id)}>
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
                    </div>
                    <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        team={t}
                        canManage={canManage}
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
        canManage={canManage}
        onChanged={invalidate}
      />
    </div>
  );
}

function RowActions({ team, canManage, onEdit, onToggle, onDelete }: {
  team: TeamRow; canManage: boolean; onEdit: () => void; onToggle: () => void; onDelete: () => void;
}) {
  if (!canManage) return <span className="text-xs text-muted-foreground">צפייה בלבד</span>;
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
              מחיקה אפשרית רק כאשר אין משתמשים או נציגים המשויכים לצוות. אם קיימים שיוכים, תוצג הודעה עם הפרטים שיש לשייך מחדש.
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
  onSaved: () => void;
}) {
  const create = useServerFn(createTeam);
  const update = useServerFn(updateTeam);
  const [name, setName] = useState(team?.name ?? "");
  const [department, setDepartment] = useState(team?.department ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [managerId, setManagerId] = useState(team?.manager_id ?? NONE);
  const [active, setActive] = useState(team?.active ?? true);

  const m = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        department: department || null,
        description: description || null,
        manager_id: managerId === NONE ? null : managerId,
        active,
      };
      if (team) return update({ data: { ...payload, team_id: team.id } });
      return create({ data: payload });
    },
    onSuccess: () => {
      toast.success(team ? "הצוות עודכן" : "הצוות נוצר");
      onSaved();
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
            <Input id="team-dep" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="לדוגמה: חידושי רכב" />
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

function TeamDetailsSheet({ teamId, onOpenChange, people, managers, canManage, onChanged }: {
  teamId: string | null;
  onOpenChange: (o: boolean) => void;
  people: Person[];
  managers: Person[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const details = useServerFn(getTeamDetails);
  const assign = useServerFn(setUserTeam);
  const update = useServerFn(updateTeam);
  const [addUserId, setAddUserId] = useState(NONE);

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
  const unassigned = people.filter((p) => p.team_id !== teamId);

  const assignM = useMutation({
    mutationFn: (v: { user_id: string; team_id: string | null }) => assign({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(v.team_id ? "המשתמש שויך לצוות" : "המשתמש הוסר מהצוות");
      q.refetch();
      onChanged();
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
      },
    }),
    onSuccess: () => { toast.success("המנהל עודכן"); q.refetch(); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

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

            {team.description && <p className="text-sm text-muted-foreground">{team.description}</p>}

            <div className="space-y-2">
              <Label>מנהל הצוות</Label>
              {canManage ? (
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
                <div className="text-sm">{team.manager_id ? personName(people.find((p) => p.id === team.manager_id)) : "—"}</div>
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
                      {canManage && (
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

            {canManage && (
              <div className="space-y-2">
                <Label>הוספת משתמש לצוות</Label>
                <div className="flex gap-2">
                  <Select value={addUserId} onValueChange={setAddUserId}>
                    <SelectTrigger aria-label="בחירת משתמש להוספה"><SelectValue placeholder="בחרו משתמש" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>בחרו משתמש</SelectItem>
                      {unassigned.map((p) => <SelectItem key={p.id} value={p.id}>{personName(p)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => {
                      if (addUserId === NONE) return toast.error("יש לבחור משתמש");
                      assignM.mutate({ user_id: addUserId, team_id: team.id });
                      setAddUserId(NONE);
                    }}
                    aria-label="הוספת משתמש לצוות"
                  >
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </div>
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
