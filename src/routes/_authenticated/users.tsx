import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Users2, Plus, Search, KeyRound, Pencil, UserCheck, UserX, Copy, Mail, ShieldAlert } from "lucide-react";
import { requireRole } from "@/lib/require-role";
import { formatDateIL } from "@/lib/format";
import { useApp } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import {
  listUsers,
  listAuditLog,
  createUser,
  updateUser,
  resetPassword,
  sendPasswordResetEmail,
} from "@/lib/user-admin.functions";

export const Route = createFileRoute("/_authenticated/users")({
  beforeLoad: () => requireRole(["admin"]),
  head: () => ({
    meta: [
      { title: "ניהול משתמשים · RenewHub" },
      { name: "description", content: "ניהול חשבונות משתמשים, תפקידים וצוותים" },
      { property: "og:title", content: "ניהול משתמשים · RenewHub" },
      { property: "og:description", content: "ניהול חשבונות משתמשים, תפקידים וצוותים" },
    ],
  }),
  component: UsersPage,
});

type AppRole = "admin" | "manager" | "representative";

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  representative_id: string | null;
  manager_id: string | null;
  team_id: string | null;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
  must_change_password: boolean;
  roles: AppRole[];
  auth_last_sign_in_at: string | null;
};

type Team = { id: string; name: string; manager_id: string | null };

const roleLabel: Record<AppRole, string> = {
  admin: "מנהל מערכת",
  manager: "מנהל",
  representative: "נציג",
};

function UsersPage() {
  const list = useServerFn(listUsers);
  const audit = useServerFn(listAuditLog);
  const qc = useQueryClient();

  const usersQ = useQuery({ queryKey: ["admin", "users"], queryFn: () => list() });
  const auditQ = useQuery({ queryKey: ["admin", "audit"], queryFn: () => audit() });

  const users = (usersQ.data?.users ?? []) as UserRow[];
  const teams = (usersQ.data?.teams ?? []) as Team[];
  const managers = users.filter((u) => u.roles.includes("manager") || u.roles.includes("admin"));

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "email" | "created" | "last_login">("name");

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t) => m.set(t.id, t.name));
    return m;
  }, [teams]);
  const managerNameById = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.full_name || u.email || u.id));
    return m;
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = users.filter((u) => {
      if (q) {
        const teamName = u.team_id ? teamNameById.get(u.team_id) ?? "" : "";
        const managerName = u.manager_id ? managerNameById.get(u.manager_id) ?? "" : "";
        const hay = `${u.full_name ?? ""} ${u.email ?? ""} ${teamName} ${managerName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (roleFilter !== "all" && !u.roles.includes(roleFilter as AppRole)) return false;
      if (teamFilter !== "all" && u.team_id !== teamFilter) return false;
      if (statusFilter === "active" && !u.active) return false;
      if (statusFilter === "inactive" && u.active) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortBy === "email") return (a.email ?? "").localeCompare(b.email ?? "");
      if (sortBy === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (sortBy === "last_login") {
        const av = a.last_login_at ?? a.auth_last_sign_in_at ?? "";
        const bv = b.last_login_at ?? b.auth_last_sign_in_at ?? "";
        return bv.localeCompare(av);
      }
      return (a.full_name ?? "").localeCompare(b.full_name ?? "");
    });
    return rows;
  }, [users, search, roleFilter, teamFilter, statusFilter, sortBy, teamNameById, managerNameById]);

  const activeAdmins = users.filter((u) => u.active && u.roles.includes("admin"));

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="ניהול משתמשים"
        description="ניהול חשבונות משתמשים, שיוך צוותים ותפקידים"
        actions={<CreateUserDialog teams={teams} managers={managers} onDone={() => qc.invalidateQueries({ queryKey: ["admin"] })} />}
      />

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">משתמשים</TabsTrigger>
          <TabsTrigger value="audit">יומן פעולות</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users2 className="h-4 w-4 text-primary" /> משתמשים ({filtered.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                <div className="relative md:col-span-2">
                  <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם, מייל, צוות או מנהל" className="pe-3 ps-9" />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger><SelectValue placeholder="תפקיד" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל התפקידים</SelectItem>
                    <SelectItem value="admin">מנהל מערכת</SelectItem>
                    <SelectItem value="manager">מנהל</SelectItem>
                    <SelectItem value="representative">נציג</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={teamFilter} onValueChange={setTeamFilter}>
                  <SelectTrigger><SelectValue placeholder="צוות" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הצוותים</SelectItem>
                    {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue placeholder="סטטוס" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">הכל</SelectItem>
                    <SelectItem value="active">פעיל</SelectItem>
                    <SelectItem value="inactive">מושבת</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {usersQ.isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">טוען משתמשים...</div>
              ) : usersQ.isError ? (
                <div className="p-8 text-center text-sm text-destructive">שגיאה בטעינת משתמשים: {(usersQ.error as Error).message}</div>
              ) : filtered.length === 0 ? (
                <EmptyState icon={Users2} title="אין משתמשים תואמים" description="נסה לשנות את הסינון" compact />
              ) : (
                <div className="rounded-xl border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right cursor-pointer" onClick={() => setSortBy("name")}>שם מלא</TableHead>
                        <TableHead className="text-right cursor-pointer" onClick={() => setSortBy("email")}>אימייל</TableHead>
                        <TableHead className="text-right">תפקיד</TableHead>
                        <TableHead className="text-right">צוות</TableHead>
                        <TableHead className="text-right">מנהל</TableHead>
                        <TableHead className="text-right">סטטוס</TableHead>
                        <TableHead className="text-right cursor-pointer" onClick={() => setSortBy("last_login")}>כניסה אחרונה</TableHead>
                        <TableHead className="text-right cursor-pointer" onClick={() => setSortBy("created")}>נוצר</TableHead>
                        <TableHead className="text-right">פעולות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((u) => (
                        <UserTableRow
                          key={u.id}
                          user={u}
                          teams={teams}
                          managers={managers}
                          teamName={u.team_id ? teamNameById.get(u.team_id) ?? "—" : "—"}
                          managerName={u.manager_id ? managerNameById.get(u.manager_id) ?? "—" : "—"}
                          activeAdminsCount={activeAdmins.length}
                          onDone={() => qc.invalidateQueries({ queryKey: ["admin"] })}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">יומן פעולות אדמין</CardTitle>
            </CardHeader>
            <CardContent>
              {auditQ.isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">טוען...</div>
              ) : (auditQ.data ?? []).length === 0 ? (
                <EmptyState icon={ShieldAlert} title="אין רישומים" description="פעולות ניהול יופיעו כאן" compact />
              ) : (
                <div className="rounded-xl border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">תאריך</TableHead>
                        <TableHead className="text-right">מנהל</TableHead>
                        <TableHead className="text-right">פעולה</TableHead>
                        <TableHead className="text-right">משתמש מושפע</TableHead>
                        <TableHead className="text-right">פרטים</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(auditQ.data ?? []).map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap">{formatDateIL(r.created_at)}</TableCell>
                          <TableCell>{r.actor_email ?? "—"}</TableCell>
                          <TableCell><Badge variant="secondary">{r.action}</Badge></TableCell>
                          <TableCell>{r.target_email ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-xs truncate" title={JSON.stringify(r.details)}>
                            {r.details ? JSON.stringify(r.details) : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UserTableRow({
  user, teams, managers, teamName, managerName, activeAdminsCount, onDone,
}: {
  user: UserRow; teams: Team[]; managers: UserRow[]; teamName: string; managerName: string; activeAdminsCount: number; onDone: () => void;
}) {
  const { user: me } = useAuth();
  const isSelf = me?.id === user.id;
  const isLastActiveAdmin = user.active && user.roles.includes("admin") && activeAdminsCount <= 1;
  const lastLogin = user.last_login_at ?? user.auth_last_sign_in_at;

  const updateFn = useServerFn(updateUser);
  const toggleActive = useMutation({
    mutationFn: (active: boolean) => updateFn({ data: { user_id: user.id, active } }),
    onSuccess: (_d, active) => { toast.success(active ? "המשתמש הופעל" : "המשתמש הושבת"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <TableRow>
      <TableCell className="font-medium">{user.full_name || "—"}</TableCell>
      <TableCell dir="ltr" className="text-right">{user.email}</TableCell>
      <TableCell>
        <div className="flex gap-1 flex-wrap">
          {user.roles.length === 0 ? <Badge variant="outline">ללא</Badge> :
            user.roles.map((r) => <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>{roleLabel[r]}</Badge>)}
        </div>
      </TableCell>
      <TableCell>{teamName}</TableCell>
      <TableCell>{managerName}</TableCell>
      <TableCell>
        {user.active ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">פעיל</Badge> : <Badge variant="outline">מושבת</Badge>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">{lastLogin ? formatDateIL(lastLogin) : <span className="text-muted-foreground">טרם התחבר</span>}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">{formatDateIL(user.created_at)}</TableCell>
      <TableCell>
        <div className="flex gap-1">
          <EditUserDialog user={user} teams={teams} managers={managers} isSelf={isSelf} isLastActiveAdmin={isLastActiveAdmin} onDone={onDone} />
          <ResetPasswordDialog user={user} onDone={onDone} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" title={user.active ? "השבתה" : "הפעלה"} disabled={isSelf || (user.active && isLastActiveAdmin)}>
                {user.active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{user.active ? "להשבית את המשתמש?" : "להפעיל את המשתמש?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {user.active ? "המשתמש לא יוכל להתחבר עד להפעלה מחדש." : "המשתמש יוכל להתחבר מחדש למערכת."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>ביטול</AlertDialogCancel>
                <AlertDialogAction onClick={() => toggleActive.mutate(!user.active)}>אישור</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreateUserDialog({ teams, managers, onDone }: { teams: Team[]; managers: UserRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generateTempPassword());
  const [role, setRole] = useState<AppRole>("representative");
  const [teamId, setTeamId] = useState<string>("none");
  const [managerId, setManagerId] = useState<string>("none");
  const [repId, setRepId] = useState<string>("");
  const [mustChange, setMustChange] = useState(true);
  const [createdInfo, setCreatedInfo] = useState<{ email: string; password: string; url: string } | null>(null);
  const { state } = useApp();

  const availableReps = state.reps ?? [];
  const linkedRepIds = new Set<string>(); // could be extended by fetching profiles; UI only warns

  const createFn = useServerFn(createUser);
  const mut = useMutation({
    mutationFn: createFn,
    onSuccess: () => {
      const url = typeof window !== "undefined" ? `${window.location.origin}/auth` : "/auth";
      setCreatedInfo({ email, password, url });
      toast.success("המשתמש נוצר בהצלחה");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (role === "representative" && !repId.trim()) {
      toast.error("יש לבחור נציג מהמערכת");
      return;
    }
    mut.mutate({
      data: {
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        role,
        team_id: teamId === "none" ? null : teamId,
        manager_id: managerId === "none" ? null : managerId,
        representative_id: role === "representative" ? repId.trim() : null,
        must_change_password: mustChange,
      },
    });
  }

  function reset() {
    setFullName(""); setEmail(""); setPassword(generateTempPassword());
    setRole("representative"); setTeamId("none"); setManagerId("none"); setRepId("");
    setMustChange(true); setCreatedInfo(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild><Button size="sm"><Plus className="ms-1 h-4 w-4" />משתמש חדש</Button></DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>יצירת משתמש חדש</DialogTitle></DialogHeader>
        {createdInfo ? (
          <CreatedUserPanel info={createdInfo} onClose={() => { setOpen(false); reset(); }} />
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2"><Label>שם מלא *</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div>
              <div className="space-y-1 col-span-2"><Label>אימייל *</Label><Input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <div className="space-y-1 col-span-2">
                <Label>סיסמה זמנית *</Label>
                <div className="flex gap-2">
                  <Input dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
                  <Button type="button" variant="outline" onClick={() => setPassword(generateTempPassword())}>יצירה</Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label>תפקיד *</Label>
                <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">מנהל מערכת</SelectItem>
                    <SelectItem value="manager">מנהל</SelectItem>
                    <SelectItem value="representative">נציג</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>צוות</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">ללא</SelectItem>
                    {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {role !== "admin" && (
                <div className="space-y-1 col-span-2">
                  <Label>מנהל אחראי</Label>
                  <Select value={managerId} onValueChange={setManagerId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">ללא</SelectItem>
                      {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name || m.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {role === "representative" && (
                <div className="space-y-1 col-span-2">
                  <Label>שיוך לפרופיל נציג *</Label>
                  {availableReps.length === 0 ? (
                    <div className="text-sm text-destructive">לא קיימים פרופילי נציג במערכת. יש ליצור נציגים תחילה.</div>
                  ) : (
                    <Select value={repId} onValueChange={setRepId}>
                      <SelectTrigger><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                      <SelectContent>
                        {availableReps.map((r: any) => (
                          <SelectItem key={r.id} value={r.id} disabled={linkedRepIds.has(r.id)}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              <div className="col-span-2 flex items-center gap-2 pt-2">
                <Switch id="must-change" checked={mustChange} onCheckedChange={setMustChange} />
                <Label htmlFor="must-change" className="text-sm">חייב להחליף סיסמה בכניסה הבאה</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
              <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "יוצר..." : "יצירה"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreatedUserPanel({ info, onClose }: { info: { email: string; password: string; url: string }; onClose: () => void }) {
  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} הועתק`));
  }
  const combined = `כתובת: ${info.url}\nאימייל: ${info.email}\nסיסמה זמנית: ${info.password}`;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-accent/50 p-3 text-sm space-y-1">
        <div><span className="text-muted-foreground">כתובת התחברות: </span><span dir="ltr">{info.url}</span></div>
        <div><span className="text-muted-foreground">אימייל: </span><span dir="ltr">{info.email}</span></div>
        <div><span className="text-muted-foreground">סיסמה זמנית: </span><span dir="ltr">{info.password}</span></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => copy(combined, "פרטי ההתחברות")}><Copy className="ms-1 h-4 w-4" />העתקת פרטים</Button>
        <Button size="sm" variant="outline" onClick={() => copy(info.url, "כתובת ההתחברות")}><Copy className="ms-1 h-4 w-4" />העתקת קישור</Button>
        <Button size="sm" variant="outline" disabled title="בקרוב"><Mail className="ms-1 h-4 w-4" />שליחת הזמנה במייל</Button>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>סגירה</Button>
      </DialogFooter>
    </div>
  );
}

function EditUserDialog({
  user, teams, managers, isSelf, isLastActiveAdmin, onDone,
}: { user: UserRow; teams: Team[]; managers: UserRow[]; isSelf: boolean; isLastActiveAdmin: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [role, setRole] = useState<AppRole>(user.roles[0] ?? "representative");
  const [teamId, setTeamId] = useState<string>(user.team_id ?? "none");
  const [managerId, setManagerId] = useState<string>(user.manager_id ?? "none");
  const [repId, setRepId] = useState<string>(user.representative_id ?? "");
  const [mustChange, setMustChange] = useState(user.must_change_password);
  const { state } = useApp();
  const updateFn = useServerFn(updateUser);

  const mut = useMutation({
    mutationFn: updateFn,
    onSuccess: () => { toast.success("המשתמש עודכן"); setOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (role === "representative" && !repId.trim()) return toast.error("יש לשייך נציג");
    const roleChanged = role !== (user.roles[0] ?? null);
    mut.mutate({
      data: {
        user_id: user.id,
        full_name: fullName,
        team_id: teamId === "none" ? null : teamId,
        manager_id: managerId === "none" ? null : managerId,
        representative_id: role === "representative" ? repId.trim() : null,
        must_change_password: mustChange,
        ...(roleChanged ? { role } : {}),
      },
    });
  }

  const roleLocked = isSelf && user.roles.includes("admin"); // can't change own admin role
  const showLastAdminWarning = isLastActiveAdmin && role !== "admin";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="icon" variant="ghost" title="עריכה"><Pencil className="h-4 w-4" /></Button></DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>עריכת משתמש</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2"><Label>שם מלא</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
            <div className="space-y-1 col-span-2"><Label>אימייל</Label><Input dir="ltr" value={user.email ?? ""} disabled /></div>
            <div className="space-y-1">
              <Label>תפקיד</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)} disabled={roleLocked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">מנהל מערכת</SelectItem>
                  <SelectItem value="manager">מנהל</SelectItem>
                  <SelectItem value="representative">נציג</SelectItem>
                </SelectContent>
              </Select>
              {roleLocked && <p className="text-xs text-muted-foreground">לא ניתן לשנות את התפקיד של החשבון שלך.</p>}
              {showLastAdminWarning && <p className="text-xs text-destructive">לא ניתן להסיר את התפקיד מהמנהל הפעיל האחרון.</p>}
            </div>
            <div className="space-y-1">
              <Label>צוות</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">ללא</SelectItem>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {role !== "admin" && (
              <div className="space-y-1 col-span-2">
                <Label>מנהל אחראי</Label>
                <Select value={managerId} onValueChange={setManagerId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">ללא</SelectItem>
                    {managers.filter((m) => m.id !== user.id).map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name || m.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {role === "representative" && (
              <div className="space-y-1 col-span-2">
                <Label>שיוך לפרופיל נציג</Label>
                {(state.reps ?? []).length === 0 ? (
                  <div className="text-sm text-destructive">לא קיימים פרופילי נציג במערכת.</div>
                ) : (
                  <Select value={repId} onValueChange={setRepId}>
                    <SelectTrigger><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                    <SelectContent>
                      {(state.reps ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div className="col-span-2 flex items-center gap-2 pt-2">
              <Switch id="must-change-edit" checked={mustChange} onCheckedChange={setMustChange} />
              <Label htmlFor="must-change-edit" className="text-sm">חייב להחליף סיסמה בכניסה הבאה</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
            <Button type="submit" disabled={mut.isPending || showLastAdminWarning}>שמירה</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState(() => generateTempPassword());
  const [mustChange, setMustChange] = useState(true);
  const resetFn = useServerFn(resetPassword);
  const emailFn = useServerFn(sendPasswordResetEmail);

  const resetMut = useMutation({
    mutationFn: resetFn,
    onSuccess: () => { toast.success("הסיסמה אופסה"); setOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const emailMut = useMutation({
    mutationFn: emailFn,
    onSuccess: () => { toast.success("נשלח מייל איפוס סיסמה"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="icon" variant="ghost" title="איפוס סיסמה"><KeyRound className="h-4 w-4" /></Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>איפוס סיסמה</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">משתמש: <span dir="ltr" className="text-foreground">{user.email}</span></div>
          <div className="space-y-1">
            <Label>סיסמה זמנית חדשה</Label>
            <div className="flex gap-2">
              <Input dir="ltr" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} />
              <Button type="button" variant="outline" onClick={() => setNewPassword(generateTempPassword())}>יצירה</Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="rp-must" checked={mustChange} onCheckedChange={setMustChange} />
            <Label htmlFor="rp-must" className="text-sm">חייב להחליף סיסמה בכניסה הבאה</Label>
          </div>
          <div className="pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              disabled={!user.email || emailMut.isPending}
              onClick={() => user.email && emailMut.mutate({ data: { email: user.email, redirect_to: `${window.location.origin}/reset-password` } })}
            >
              <Mail className="ms-1 h-4 w-4" />שליחת מייל איפוס למשתמש
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
          <Button
            onClick={() => resetMut.mutate({ data: { user_id: user.id, new_password: newPassword, must_change: mustChange } })}
            disabled={resetMut.isPending || newPassword.length < 8}
          >
            אישור איפוס
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const special = "!@#$%&*";
  let p = "";
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  p += special[Math.floor(Math.random() * special.length)];
  return p;
}
