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
import { Users, Plus, Search, Pencil, Trash2, Power, Link2, Link2Off, ArrowLeftRight } from "lucide-react";
import { requireRole } from "@/lib/require-role";
import { useWorkspace, workspaceTeamId } from "@/lib/workspace-context";
import {
  listRepresentatives, createRepresentative, updateRepresentative, setRepresentativeActive,
  setRepresentativeTeam, linkRepresentativeUser, deleteRepresentative, getRepresentativeDeleteCheck,
} from "@/lib/rep-admin.functions";

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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["representatives"] });
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["users"] });
  };

  const reps = data?.reps ?? [];
  const teams = data?.teams ?? [];
  const people = data?.people ?? [];
  const isAdmin = !!data?.isAdmin;

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
        actions={isAdmin ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="ms-1 h-4 w-4" />נציג חדש
          </Button>
        ) : null}
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
              action={isAdmin && reps.length === 0 ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="ms-1 h-4 w-4" />נציג חדש</Button> : undefined}
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
                      <TableHead>יעד / תוצאה</TableHead>
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
                        <TableCell>{r.current_result} / {r.monthly_target}</TableCell>
                        <TableCell className="text-sm">{r.linked_user ? (r.linked_user.email ?? r.linked_user.full_name) : <span className="text-muted-foreground">לא מקושר</span>}</TableCell>
                        <TableCell>
                          <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "פעיל" : "מושבת"}</Badge>
                        </TableCell>
                        <TableCell className="text-end">
                          <RowActions
                            rep={r} isAdmin={isAdmin}
                            onEdit={() => setEditing(r)}
                            onToggle={() => setDeactivateTarget(r)}
                            onTransfer={() => setTransferTarget(r)}
                            onLink={() => setLinkTarget(r)}
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
                      {r.team_name ?? "ללא צוות"} · {r.current_result}/{r.monthly_target}
                    </div>
                    <div className="text-xs">{r.linked_user ? r.linked_user.email : "ללא חשבון משתמש"}</div>
                    <RowActions
                      rep={r} isAdmin={isAdmin}
                      onEdit={() => setEditing(r)}
                      onToggle={() => setDeactivateTarget(r)}
                      onTransfer={() => setTransferTarget(r)}
                      onLink={() => setLinkTarget(r)}
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
        <LinkUserDialog rep={linkTarget} people={people} onClose={() => setLinkTarget(null)} onDone={invalidate} />
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

function RowActions({ rep, isAdmin, onEdit, onToggle, onTransfer, onLink, onDelete }: {
  rep: RepRow; isAdmin: boolean;
  onEdit: () => void; onToggle: () => void; onTransfer: () => void; onLink: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button size="icon" variant="ghost" aria-label={`עריכת הנציג ${rep.name}`} onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" aria-label={rep.active ? `השבתת הנציג ${rep.name}` : `הפעלת הנציג ${rep.name}`} onClick={onToggle}><Power className="h-4 w-4" /></Button>
      {isAdmin && <Button size="icon" variant="ghost" aria-label={`העברת ${rep.name} לצוות אחר`} onClick={onTransfer}><ArrowLeftRight className="h-4 w-4" /></Button>}
      {isAdmin && (
        <Button size="icon" variant="ghost" aria-label={rep.linked_user ? `ניתוק חשבון המשתמש של ${rep.name}` : `קישור חשבון משתמש ל${rep.name}`} onClick={onLink}>
          {rep.linked_user ? <Link2Off className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
        </Button>
      )}
      {isAdmin && <Button size="icon" variant="ghost" aria-label={`מחיקה לצמיתות של ${rep.name}`} onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
    </div>
  );
}

function RepDialog({ rep, teams, people, isAdmin, onClose, onDone }: {
  rep: RepRow | null;
  teams: { id: string; name: string }[];
  people: any[];
  isAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const create = useServerFn(createRepresentative);
  const update = useServerFn(updateRepresentative);
  const [name, setName] = useState(rep?.name ?? "");
  const [teamId, setTeamId] = useState(rep?.team_id ?? NONE);
  const [target, setTarget] = useState(String(rep?.monthly_target ?? 0));
  const [result, setResult] = useState(String(rep?.current_result ?? 0));
  const [externalRef, setExternalRef] = useState(rep?.external_ref ?? "");
  const [userId, setUserId] = useState(rep?.user_id ?? NONE);
  const [active, setActive] = useState(rep?.active ?? true);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        team_id: teamId === NONE ? null : teamId,
        monthly_target: Number(target) || 0,
        current_result: Number(result) || 0,
        external_ref: externalRef || null,
        user_id: userId === NONE ? null : userId,
        active,
      };
      if (rep) return update({ data: { ...payload, rep_id: rep.id } });
      return create({ data: payload });
    },
    onSuccess: () => { toast.success(rep ? "פרטי הנציג עודכנו" : "הנציג נוסף בהצלחה"); onDone(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{rep ? "עריכת נציג" : "נציג חדש"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>שם מלא</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>צוות</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>ללא צוות</SelectItem>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>יעד חודשי</Label><Input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
            <div className="space-y-1"><Label>תוצאה נוכחית</Label><Input inputMode="numeric" value={result} onChange={(e) => setResult(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>מזהה נציג (לייבוא נתונים)</Label><Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} /></div>
          {isAdmin && (
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
          <div className="flex items-center justify-between rounded-xl border p-3">
            <Label htmlFor="rep-active">נציג פעיל</Label>
            <Switch id="rep-active" checked={active} onCheckedChange={setActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>{rep ? "שמירה" : "הוספה"}</Button>
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

function LinkUserDialog({ rep, people, onClose, onDone }: { rep: RepRow; people: any[]; onClose: () => void; onDone: () => void }) {
  const link = useServerFn(linkRepresentativeUser);
  const [userId, setUserId] = useState(rep.user_id ?? NONE);
  const mutation = useMutation({
    mutationFn: () => link({ data: { rep_id: rep.id, user_id: userId === NONE ? null : userId } }),
    onSuccess: () => { toast.success(userId === NONE ? "חשבון המשתמש נותק מהנציג" : "חשבון המשתמש קושר לנציג"); onDone(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>חשבון משתמש — {rep.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ניתן לקשר, לנתק או להעביר את החשבון לנציג אחר. חשבון ההזדהות עצמו לעולם אינו נמחק בפעולה זו.
          </p>
          <div className="space-y-1">
            <Label>חשבון מקושר</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>ללא חשבון (ניתוק)</SelectItem>
                {people.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>שמירה</Button>
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
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-center justify-between gap-3">
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
