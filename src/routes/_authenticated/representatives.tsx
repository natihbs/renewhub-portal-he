import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Users, Plus, Search, Pencil, Trash2, Power, Link2, Link2Off, ArrowLeftRight, Target, Send } from "lucide-react";
import { requireRole } from "@/lib/require-role";
import { useWorkspace, workspaceTeamId } from "@/lib/workspace-context";
import {
  listRepresentatives, createRepresentative, createRepresentativeWithInvite, inviteRepresentativeLogin, updateRepresentative, setRepresentativeActive,
  setRepresentativeTeam, linkRepresentativeUser, findEligibleLinkAccount, deleteRepresentative, getRepresentativeDeleteCheck,
} from "@/lib/rep-admin.functions";
import { useRepresentativeGoals, currentGoalMonth } from "@/lib/goals-hooks";

export const Route = createFileRoute("/_authenticated/representatives")({
  beforeLoad: () => requireRole(["admin", "manager"]),
  head: () => ({
    meta: [
      { title: "ניהול נציגים · Pulse" },
      { name: "description", content: "ניהול מחזור החיים של נציגים: יצירה, עריכה, השבתה, העברת צוות ומחיקה" },
      { property: "og:title", content: "ניהול נציגים · Pulse" },
      { property: "og:description", content: "ניהול מחזור החיים של נציגים ב-Pulse" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RepresentativesPage,
});

type RepRow = Awaited<ReturnType<typeof listRepresentatives>>["reps"][number];

const NONE = "__none__";

function RepresentativesPage() {
  const qc = useQueryClient();
  const load = useServerFn(listRepresentatives);
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["representatives"], queryFn: () => load() });

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  // Team scope comes from the shared Workspace Context (header switcher)
  // instead of a page-local filter — see src/lib/workspace-context.tsx. A
  // single-team manager never needs to pick a team here at all; an admin's
  // "🌍 כלל הארגון" workspace shows every representative, same as the old "all".
  const { workspace } = useWorkspace();
  const teamFilter = workspaceTeamId(workspace);
  const [managerFilter, setManagerFilter] = useState<string>("all");

  const [editing, setEditing] = useState<RepRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RepRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<RepRow | null>(null);
  const [transferTarget, setTransferTarget] = useState<RepRow | null>(null);
  const [linkTarget, setLinkTarget] = useState<RepRow | null>(null);
  const [inviteTarget, setInviteTarget] = useState<RepRow | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["representatives"] });
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["users"] });
  };

  const reps = data?.reps ?? [];
  const teams = data?.teams ?? [];
  const people = data?.people ?? [];
  const isAdmin = !!data?.isAdmin;
  const isManager = !!data?.isManager;
  const canCreate = isAdmin || isManager;

  // Official monthly targets replace the legacy monthly_target column
  // everywhere this list surfaces a rep's target (§19) — a rep absent from
  // the map has no official target for the current month, shown honestly
  // rather than falling back to the legacy field or to zero.
  const repIds = useMemo(() => reps.map((r) => r.id), [reps]);
  const { goalsByRepId } = useRepresentativeGoals(repIds, currentGoalMonth());

  const managers = useMemo(() => {
    const ids = new Set(teams.map((t) => t.manager_id).filter(Boolean) as string[]);
    return people.filter((p: any) => ids.has(p.id));
  }, [teams, people]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return reps.filter((r) => {
      if (term && !`${r.name} ${r.external_ref ?? ""} ${r.linked_user?.email ?? ""}`.toLowerCase().includes(term)) return false;
      if (status === "active" && !r.active) return false;
      if (status === "inactive" && r.active) return false;
      if (teamFilter !== "all" && (r.team_id ?? NONE) !== teamFilter) return false;
      if (managerFilter !== "all" && (r.manager_id ?? NONE) !== managerFilter) return false;
      return true;
    });
  }, [reps, q, status, teamFilter, managerFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ניהול נציגים"
        description="יצירה, עריכה, השבתה, העברת צוות ומחיקה של נציגים"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/targets"><Target className="ms-1 h-4 w-4" />ניהול יעדים</Link>
            </Button>
            {canCreate && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="ms-1 h-4 w-4" />נציג חדש
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
              <Input className="ps-9" placeholder="חיפוש נציג, מזהה או מייל" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש נציגים" />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger aria-label="סינון לפי סטטוס"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסטטוסים</SelectItem>
                <SelectItem value="active">פעילים</SelectItem>
                <SelectItem value="inactive">מושבתים</SelectItem>
              </SelectContent>
            </Select>
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger aria-label="סינון לפי מנהל"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל המנהלים</SelectItem>
                <SelectItem value={NONE}>ללא מנהל</SelectItem>
                {managers.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.full_name || m.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : isError ? (
            <EmptyState icon={Users} title="שגיאה בטעינת הנציגים" description={(error as Error)?.message ?? "נסו לרענן את העמוד"} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title={reps.length === 0 ? "אין נציגים במערכת" : "לא נמצאו נציגים תואמים"}
              description={reps.length === 0 ? "הוסיפו נציג חדש כדי להתחיל לנהל יעדים וביצועים." : "נסו לשנות את החיפוש או הסינון."}
              action={canCreate && reps.length === 0 ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="ms-1 h-4 w-4" />נציג חדש</Button> : undefined}
              compact
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block scroll-x-touch">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>שם</TableHead>
                      <TableHead>צוות</TableHead>
                      <TableHead>תוצאה / יעד אישי</TableHead>
                      <TableHead>חשבון משתמש</TableHead>
                      <TableHead>סטטוס</TableHead>
                      <TableHead className="text-end">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-semibold">
                          {r.name}
                          {r.external_ref ? <div className="text-xs text-muted-foreground">מזהה: {r.external_ref}</div> : null}
                        </TableCell>
                        <TableCell>{r.team_name ?? "ללא צוות"}</TableCell>
                        <TableCell>
                          {r.current_result} / {goalsByRepId.has(r.id) ? goalsByRepId.get(r.id) : <span className="text-xs text-muted-foreground">לא הוגדר יעד אישי</span>}
                        </TableCell>
                        <TableCell className="text-sm">{r.linked_user ? (r.linked_user.email ?? r.linked_user.full_name) : <span className="text-muted-foreground">לא מקושר</span>}</TableCell>
                        <TableCell>
                          <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "פעיל" : "מושבת"}</Badge>
                        </TableCell>
                        <TableCell className="text-end">
                          <RowActions
                            rep={r} isAdmin={isAdmin} isManager={isManager}
                            onEdit={() => setEditing(r)}
                            onToggle={() => setDeactivateTarget(r)}
                            onTransfer={() => setTransferTarget(r)}
                            onLink={() => setLinkTarget(r)}
                            onInvite={() => setInviteTarget(r)}
                            onDelete={() => setDeleteTarget(r)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {filtered.map((r) => (
                  <div key={r.id} className="rounded-xl border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold break-words">{r.name}</div>
                      <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "פעיל" : "מושבת"}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.team_name ?? "ללא צוות"} · {r.current_result}/{goalsByRepId.has(r.id) ? goalsByRepId.get(r.id) : "לא הוגדר יעד אישי"}
                    </div>
                    <div className="text-xs">{r.linked_user ? r.linked_user.email : "ללא חשבון משתמש"}</div>
                    <RowActions
                      rep={r} isAdmin={isAdmin} isManager={isManager}
                      onEdit={() => setEditing(r)}
                      onToggle={() => setDeactivateTarget(r)}
                      onTransfer={() => setTransferTarget(r)}
                      onLink={() => setLinkTarget(r)}
                      onInvite={() => setInviteTarget(r)}
                      onDelete={() => setDeleteTarget(r)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <RepDialog
          rep={editing}
          teams={teams}
          people={people}
          isAdmin={isAdmin}
          isManager={isManager}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={invalidate}
        />
      )}
      {deactivateTarget && (
        <DeactivateDialog rep={deactivateTarget} isAdmin={isAdmin} onClose={() => setDeactivateTarget(null)} onDone={invalidate} />
      )}
      {transferTarget && (
        <TransferDialog rep={transferTarget} teams={teams} onClose={() => setTransferTarget(null)} onDone={invalidate} />
      )}
      {linkTarget && (
        <LinkUserDialog rep={linkTarget} onClose={() => setLinkTarget(null)} onDone={invalidate} />
      )}
      {inviteTarget && (
        <InviteExistingRepDialog rep={inviteTarget} onClose={() => setInviteTarget(null)} onDone={invalidate} />
      )}
      {deleteTarget && (
        <DeleteDialog
          rep={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={invalidate}
          onPreferDisable={() => { setDeleteTarget(null); setDeactivateTarget(deleteTarget); }}
        />
      )}
    </div>
  );
}

function RowActions({ rep, isAdmin, isManager, onEdit, onToggle, onTransfer, onLink, onInvite, onDelete }: {
  rep: RepRow; isAdmin: boolean; isManager: boolean;
  onEdit: () => void; onToggle: () => void; onTransfer: () => void; onLink: () => void; onInvite: () => void; onDelete: () => void;
}) {
  // Login linking/inviting is available to admins and to managers
  // (scoped/role-checked server-side in linkRepresentativeUser /
  // inviteRepresentativeLogin — §21/§25); team transfer and permanent
  // delete stay admin-only this sprint (§23).
  const canLink = isAdmin || isManager;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button size="icon" variant="ghost" aria-label={`עריכת הנציג ${rep.name}`} onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" aria-label={rep.active ? `השבתת הנציג ${rep.name}` : `הפעלת הנציג ${rep.name}`} onClick={onToggle}><Power className="h-4 w-4" /></Button>
      {isAdmin && <Button size="icon" variant="ghost" aria-label={`העברת ${rep.name} לצוות אחר`} onClick={onTransfer}><ArrowLeftRight className="h-4 w-4" /></Button>}
      {canLink && !rep.linked_user && (
        <Button size="icon" variant="ghost" aria-label={`הזמנת ${rep.name} למערכת`} title="הזמנה למערכת" onClick={onInvite}><Send className="h-4 w-4" /></Button>
      )}
      {canLink && (
        <Button size="icon" variant="ghost" aria-label={rep.linked_user ? `ניתוק חשבון המשתמש של ${rep.name}` : `קישור חשבון משתמש קיים ל${rep.name}`} onClick={onLink}>
          {rep.linked_user ? <Link2Off className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
        </Button>
      )}
      {isAdmin && <Button size="icon" variant="ghost" aria-label={`מחיקה לצמיתות של ${rep.name}`} onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
    </div>
  );
}

function RepDialog({ rep, teams, people, isAdmin, isManager, onClose, onDone }: {
  rep: RepRow | null;
  teams: { id: string; name: string }[];
  people: any[];
  isAdmin: boolean;
  isManager: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const create = useServerFn(createRepresentative);
  const update = useServerFn(updateRepresentative);
  const createWithInvite = useServerFn(createRepresentativeWithInvite);
  const [name, setName] = useState(rep?.name ?? "");
  const [teamId, setTeamId] = useState(rep?.team_id ?? NONE);
  const [result, setResult] = useState(String(rep?.current_result ?? 0));
  const [externalRef, setExternalRef] = useState(rep?.external_ref ?? "");
  const [userId, setUserId] = useState(rep?.user_id ?? NONE);
  const [active, setActive] = useState(rep?.active ?? true);
  // Creation-only: mode 2 of §22 — create the representative AND invite them
  // to sign in, in one step. Mode 3 (link to an existing account) happens
  // afterward via the dedicated "קישור חשבון" row action, and mode 1 (no
  // login) is simply leaving this toggle off — never mandatory.
  const [inviteMode, setInviteMode] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFullName, setInviteFullName] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!rep && inviteMode) {
        return createWithInvite({
          data: {
            name,
            team_id: teamId === NONE ? null : teamId,
            external_ref: externalRef || null,
            email: inviteEmail,
            full_name: inviteFullName || name,
            redirect_to: `${window.location.origin}/reset-password`,
          },
        });
      }
      const payload = {
        name,
        team_id: teamId === NONE ? null : teamId,
        current_result: Number(result) || 0,
        external_ref: externalRef || null,
        user_id: userId === NONE ? null : userId,
        active,
      };
      if (rep) return update({ data: { ...payload, rep_id: rep.id } });
      return create({ data: payload });
    },
    onSuccess: () => {
      toast.success(rep ? "פרטי הנציג עודכנו" : inviteMode ? "הנציג נוצר וההזמנה להתחברות נשלחה" : "הנציג נוסף בהצלחה");
      onDone(); onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const teamLocked = !!rep && !isAdmin; // team reassignment is admin-only (§23)
  const canSubmit = name.trim().length > 0 && (rep || isAdmin || teamId !== NONE) && (!inviteMode || inviteEmail.trim().length > 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{rep ? "עריכת נציג" : "נציג חדש"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>שם מלא</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>צוות</Label>
              {teamLocked ? (
                <div className="text-sm rounded-md border px-3 py-2 text-muted-foreground">
                  {teams.find((t) => t.id === teamId)?.name ?? "ללא צוות"} — העברת צוות באחריות מנהל מערכת בלבד
                </div>
              ) : (
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {isAdmin && <SelectItem value={NONE}>ללא צוות</SelectItem>}
                    {!isAdmin && teams.length === 0 && <SelectItem value={NONE} disabled>אין צוותים בניהולך</SelectItem>}
                    {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            {rep && <div className="space-y-1"><Label>תוצאה נוכחית</Label><Input inputMode="numeric" value={result} onChange={(e) => setResult(e.target.value)} /></div>}
          </div>
          <div className="space-y-1"><Label>מזהה נציג (לייבוא נתונים)</Label><Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} /></div>
          {isAdmin && !inviteMode && (
            <div className="space-y-1">
              <Label>חשבון משתמש מקושר</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>ללא חשבון</SelectItem>
                  {people.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {!rep && (isAdmin || isManager) && userId === NONE && (
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div>
                <Label htmlFor="invite-toggle">הזמנה להתחברות למערכת</Label>
                <p className="text-xs text-muted-foreground mt-0.5">יצירת חשבון כניסה עבור הנציג ושליחת הזמנה במייל. ניתן לדלג וליצור נציג ללא גישת התחברות, ולהזמין או לקשר חשבון בהמשך מרשימת הנציגים.</p>
              </div>
              <Switch id="invite-toggle" checked={inviteMode} onCheckedChange={setInviteMode} />
            </div>
          )}
          {!rep && inviteMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label>כתובת מייל להזמנה</Label><Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} /></div>
              <div className="space-y-1"><Label>שם מלא לחשבון (אופציונלי)</Label><Input value={inviteFullName} onChange={(e) => setInviteFullName(e.target.value)} placeholder={name} /></div>
            </div>
          )}
          {rep && (
            <div className="flex items-center justify-between rounded-xl border p-3">
              <Label htmlFor="rep-active">נציג פעיל</Label>
              <Switch id="rep-active" checked={active} onCheckedChange={setActive} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !canSubmit}>
            {rep ? "שמירה" : inviteMode ? "יצירה ושליחת הזמנה" : "הוספה"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({ rep, isAdmin, onClose, onDone }: { rep: RepRow; isAdmin: boolean; onClose: () => void; onDone: () => void }) {
  const setActive = useServerFn(setRepresentativeActive);
  const [alsoUser, setAlsoUser] = useState(false);
  const mutation = useMutation({
    mutationFn: () => setActive({ data: { rep_id: rep.id, active: !rep.active, deactivate_user: alsoUser } }),
    onSuccess: () => { toast.success(rep.active ? "הנציג הושבת" : "הנציג הופעל מחדש"); onDone(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{rep.active ? `השבתת נציג — ${rep.name}` : `הפעלת נציג — ${rep.name}`}</AlertDialogTitle>
          <AlertDialogDescription>
            {rep.active
              ? "כל ההיסטוריה נשמרת: ביצועים, האזנות, משובים, הערות מנהל, תחרויות ורישומי ביקורת. הנציג יוסר מרשימות פעילות ומהקצאות עתידיות, וניתן יהיה להפעילו מחדש בכל עת."
              : "הנציג יחזור לרשימות הפעילות ולהקצאות עתידיות."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {rep.linked_user && isAdmin && (
          <div className="flex items-center justify-between rounded-xl border p-3">
            <Label htmlFor="also-user" className="text-sm">
              {rep.active ? "להשבית גם את חשבון המשתמש" : "להפעיל גם את חשבון המשתמש"} ({rep.linked_user.email})
            </Label>
            <Switch id="also-user" checked={alsoUser} onCheckedChange={setAlsoUser} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); mutation.mutate(); }} disabled={mutation.isPending}>
            {rep.active ? "השבתת נציג" : "הפעלת נציג"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TransferDialog({ rep, teams, onClose, onDone }: { rep: RepRow; teams: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const transfer = useServerFn(setRepresentativeTeam);
  const [teamId, setTeamId] = useState(rep.team_id ?? NONE);
  const mutation = useMutation({
    mutationFn: () => transfer({ data: { rep_id: rep.id, team_id: teamId === NONE ? null : teamId } }),
    onSuccess: () => { toast.success("הנציג הועבר לצוות החדש"); onDone(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>העברת נציג לצוות אחר — {rep.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">הרשומות ההיסטוריות יישארו משויכות לנציג. הצוות, סינוני הביצועים והרשאות המנהל יתעדכנו מיידית.</p>
          <div className="space-y-1">
            <Label>צוות יעד</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>ללא צוות</SelectItem>
                {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>העברה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * §5 hardening: no global org user list is ever sent to the browser here —
 * eligibility for an exact email is resolved server-side
 * (findEligibleLinkAccount) one lookup at a time, for admin and manager
 * alike. The actual link write is re-validated independently server-side
 * (assertCanLinkUser + assertUserFree) regardless of what this dialog shows.
 */
function LinkUserDialog({ rep, onClose, onDone }: { rep: RepRow; onClose: () => void; onDone: () => void }) {
  const link = useServerFn(linkRepresentativeUser);
  const find = useServerFn(findEligibleLinkAccount);
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<{ id: string; full_name: string | null; email: string | null } | null>(null);

  const searchM = useMutation({
    mutationFn: () => find({ data: { email } }),
    onSuccess: (acc) => setFound(acc),
    onError: (e: Error) => { setFound(null); toast.error(e.message); },
  });

  const linkM = useMutation({
    mutationFn: (userId: string | null) => link({ data: { rep_id: rep.id, user_id: userId } }),
    onSuccess: (_d, userId) => { toast.success(userId ? "חשבון המשתמש קושר לנציג" : "חשבון המשתמש נותק מהנציג"); onDone(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>חשבון משתמש — {rep.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {rep.linked_user ? (
            <>
              <p className="text-sm">
                מקושר כעת ל־<b>{rep.linked_user.email ?? rep.linked_user.full_name}</b>.
              </p>
              <p className="text-xs text-muted-foreground">ניתוק מסיר את השיוך בלבד — חשבון ההזדהות עצמו לעולם אינו נמחק.</p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                חיפוש חשבון קיים לפי כתובת מייל מדויקת. לא מוצגת רשימת משתמשים כללית — כל חשבון נבדק לזכאות בנפרד
                (תפקיד נציג בלבד, ללא שיוך קיים לנציג אחר).
              </p>
              <div className="flex gap-2">
                <Input
                  type="email" placeholder="כתובת מייל" value={email}
                  onChange={(e) => { setEmail(e.target.value); setFound(null); }}
                />
                <Button variant="outline" onClick={() => searchM.mutate()} disabled={!email.trim() || searchM.isPending}>חיפוש</Button>
              </div>
              {found && (
                <div className="rounded-lg border p-3 text-sm">
                  <div className="font-medium">{found.full_name || found.email}</div>
                  {found.full_name && <div className="text-xs text-muted-foreground">{found.email}</div>}
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          {rep.linked_user ? (
            <Button variant="destructive" onClick={() => linkM.mutate(null)} disabled={linkM.isPending}>ניתוק חשבון</Button>
          ) : (
            <Button onClick={() => linkM.mutate(found!.id)} disabled={!found || linkM.isPending}>קישור חשבון</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteExistingRepDialog({ rep, onClose, onDone }: { rep: RepRow; onClose: () => void; onDone: () => void }) {
  const invite = useServerFn(inviteRepresentativeLogin);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState(rep.name);

  const mutation = useMutation({
    mutationFn: () => invite({
      data: { rep_id: rep.id, email, full_name: fullName, redirect_to: `${window.location.origin}/reset-password` },
    }),
    onSuccess: () => { toast.success(`ההזמנה נשלחה ל${rep.name}`); onDone(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>הזמנה למערכת — {rep.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            תישלח הזמנה במייל ליצירת חשבון כניסה בתפקיד נציג בלבד, המקושר אוטומטית לרשומת הנציג ולצוות{" "}
            {rep.team_name ?? "ללא צוות"} (הצוות הרשמי של הנציג).
          </p>
          <div className="space-y-1"><Label>כתובת מייל להזמנה</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1"><Label>שם מלא לחשבון</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !email.trim()}>שליחת הזמנה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  rep, onClose, onDone, onPreferDisable,
}: { rep: RepRow; onClose: () => void; onDone: () => void; onPreferDisable: () => void }) {
  const checkFn = useServerFn(getRepresentativeDeleteCheck);
  const del = useServerFn(deleteRepresentative);
  const [confirmName, setConfirmName] = useState("");

  // Single source of truth: the same server-side check deleteRepresentative
  // re-runs itself before the actual delete (never a client-only computation
  // that can drift from what the database really has linked to this rep).
  const q = useQuery({
    queryKey: ["admin", "rep-delete-check", rep.id],
    queryFn: () => checkFn({ data: { rep_id: rep.id } }),
  });
  const blockers = q.data?.blockers ?? [];

  const mutation = useMutation({
    mutationFn: () => del({ data: { rep_id: rep.id, confirm_name: confirmName } }),
    onSuccess: () => { toast.success("הנציג נמחק לצמיתות"); onDone(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>מחיקה לצמיתות — {rep.name}</DialogTitle></DialogHeader>
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground p-4 text-center">בודק תלויות...</div>
        ) : q.isError ? (
          <div className="text-sm text-destructive">{(q.error as Error).message}</div>
        ) : blockers.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm">
              לא ניתן למחוק את הנציג משום שקיימים נתונים היסטוריים מקושרים. ניתן להשבית את הנציג או להעביר את הרשומות.
            </p>
            <ul className="text-sm list-disc pe-5 space-y-1">
              {blockers.map((b) => <li key={b.label}>{b.label} — {b.count}</li>)}
            </ul>
            <div className="rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 p-3 text-sm text-warning-foreground flex items-center justify-between gap-3">
              <div>מומלץ להשבית את הנציג במקום למחוק אותו לצמיתות — השבתה הפיכה ושומרת את כל ההיסטוריה.</div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={onPreferDisable}>השבתה במקום</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              פעולה זו אינה הפיכה. לא נמצאו נתונים היסטוריים מקושרים. להשלמת המחיקה יש להקליד את שם הנציג במדויק.
            </p>
            <div className="space-y-1">
              <Label>שם הנציג</Label>
              <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={rep.name} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>סגירה</Button>
          {blockers.length === 0 && !q.isLoading && !q.isError && (
            <Button
              variant="destructive"
              disabled={confirmName.trim() !== rep.name.trim() || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              מחיקה לצמיתות
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
