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
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Users2, Plus, Search, KeyRound, Pencil, UserCheck, UserX, Copy, Mail, ShieldAlert,
  MoreHorizontal, Eye, UsersRound, Link2, Unlink, Trash2, ChevronLeft, ChevronRight,
} from "lucide-react";
import { requireRole } from "@/lib/require-role";
import { formatDateIL } from "@/lib/format";
import { useApp } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { UserHealth } from "@/lib/user-health";
import {
  listUsers,
  listAuditLog,
  createUser,
  updateUser,
  resetPassword,
  sendPasswordResetEmail,
  getUserDetails,
  getUserDeleteCheck,
  deleteUser,
} from "@/lib/user-admin.functions";
import { setUserTeam } from "@/lib/team-admin.functions";
import { linkRepresentativeUser, listRepresentatives } from "@/lib/rep-admin.functions";
import { useWorkspace, workspaceTeamId } from "@/lib/workspace-context";
import { isNetworkFailure } from "@/lib/network-error";

export const Route = createFileRoute("/_authenticated/users")({
  beforeLoad: () => requireRole(["admin"]),
  head: () => ({
    meta: [
      { title: "ניהול משתמשים · Pulse" },
      { name: "description", content: "ניהול חשבונות משתמשים, תפקידים וצוותים" },
      { property: "og:title", content: "ניהול משתמשים · Pulse" },
      { property: "og:description", content: "ניהול חשבונות משתמשים, תפקידים וצוותים" },
    ],
  }),
  component: UsersPage,
});

type AppRole = "admin" | "manager" | "representative";

type RepLink = { id: string; name: string } | null;

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
  representative_link: RepLink;
  health: UserHealth;
};

type Team = { id: string; name: string; manager_id: string | null };

type ActionType = "edit" | "changeTeam" | "link" | "unlink" | "resetPassword" | "toggleActive" | "delete";
type PendingAction = { type: ActionType; user: UserRow } | null;

const roleLabel: Record<AppRole, string> = {
  admin: "מנהל מערכת",
  manager: "מנהל",
  representative: "נציג",
};

const ownedRecordLabel: Record<string, string> = {
  announcements: "הודעות",
  articles: "מאמרים",
  competitions: "תחרויות",
  manager_calls: "שיחות מנהל",
};

const PAGE_SIZE = 25;

// Fixed display order for role sorting — admins first, matching how the role
// badges themselves are prioritized (admin uses the "default"/primary badge).
const ROLE_SORT_RANK: Record<string, number> = { admin: 0, manager: 1, representative: 2 };
// Health sort surfaces the most severe state first — that's what an admin
// scanning the table for problems wants to see at the top.
const HEALTH_SORT_RANK: Record<UserHealth["status"], number> = { issue: 0, attention: 1, healthy: 2 };

function UsersPage() {
  const list = useServerFn(listUsers);
  const audit = useServerFn(listAuditLog);
  const qc = useQueryClient();
  const { user: me } = useAuth();

  const usersQ = useQuery({ queryKey: ["admin", "users"], queryFn: () => list() });
  const auditQ = useQuery({ queryKey: ["admin", "audit"], queryFn: () => audit() });

  const users = (usersQ.data?.users ?? []) as UserRow[];
  const teams = (usersQ.data?.teams ?? []) as Team[];
  const managers = users.filter((u) => u.roles.includes("manager") || u.roles.includes("admin"));

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  // Team scope comes from the shared Workspace Context (header switcher)
  // instead of a page-local filter — see src/lib/workspace-context.tsx. This
  // page is admin-only, so workspace is always either "🌍 כלל הארגון" (every
  // user, same as the old "all") or one specific team.
  const { workspace } = useWorkspace();
  const teamFilter = workspaceTeamId(workspace);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [healthFilter, setHealthFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "email" | "role" | "team" | "status" | "health" | "created" | "last_login">("name");
  const [page, setPage] = useState(1);

  const [detailsUserId, setDetailsUserId] = useState<string | null>(null);
  const [action, setAction] = useState<PendingAction>(null);

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
      if (healthFilter !== "all" && u.health.status !== healthFilter) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortBy === "email") return (a.email ?? "").localeCompare(b.email ?? "");
      if (sortBy === "role") return (ROLE_SORT_RANK[a.roles[0] ?? ""] ?? 99) - (ROLE_SORT_RANK[b.roles[0] ?? ""] ?? 99);
      if (sortBy === "team") {
        const an = a.team_id ? teamNameById.get(a.team_id) ?? "" : "";
        const bn = b.team_id ? teamNameById.get(b.team_id) ?? "" : "";
        return an.localeCompare(bn);
      }
      if (sortBy === "status") return (b.active ? 1 : 0) - (a.active ? 1 : 0);
      if (sortBy === "health") return HEALTH_SORT_RANK[a.health.status] - HEALTH_SORT_RANK[b.health.status];
      if (sortBy === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (sortBy === "last_login") {
        const av = a.last_login_at ?? a.auth_last_sign_in_at ?? "";
        const bv = b.last_login_at ?? b.auth_last_sign_in_at ?? "";
        return bv.localeCompare(av);
      }
      return (a.full_name ?? "").localeCompare(b.full_name ?? "");
    });
    return rows;
  }, [users, search, roleFilter, teamFilter, statusFilter, healthFilter, sortBy, teamNameById, managerNameById]);

  useEffect(() => { setPage(1); }, [search, roleFilter, teamFilter, statusFilter, healthFilter, sortBy]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeAdmins = users.filter((u) => u.active && u.roles.includes("admin"));

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["admin"] });
  }
  function closeAction() {
    setAction(null);
  }
  function onActionDone() {
    closeAction();
    invalidateAll();
  }

  const detailsUser = users.find((u) => u.id === detailsUserId);

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="ניהול משתמשים"
        description="מרכז ניהול משתמשים, תפקידים, צוותים וקישורי נציגים"
        actions={<CreateUserDialog teams={teams} managers={managers} onDone={invalidateAll} />}
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
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue placeholder="סטטוס" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">הכל</SelectItem>
                    <SelectItem value="active">פעיל</SelectItem>
                    <SelectItem value="inactive">מושבת</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={healthFilter} onValueChange={setHealthFilter}>
                  <SelectTrigger><SelectValue placeholder="בריאות" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל רמות הבריאות</SelectItem>
                    <SelectItem value="healthy">🟢 תקין</SelectItem>
                    <SelectItem value="attention">🟠 דורש תשומת לב</SelectItem>
                    <SelectItem value="issue">🔴 בעיית הגדרה</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {usersQ.isLoading ? (
                <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : usersQ.isError ? (
                <div className="p-8 text-center text-sm text-destructive">שגיאה בטעינת משתמשים: {(usersQ.error as Error).message}</div>
              ) : filtered.length === 0 ? (
                <EmptyState icon={Users2} title="אין משתמשים תואמים" description="נסה לשנות את הסינון" compact />
              ) : (
                <>
                  <div className="rounded-xl border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right cursor-pointer" onClick={() => setSortBy("name")}>שם מלא</TableHead>
                          <TableHead className="text-right cursor-pointer" onClick={() => setSortBy("email")}>אימייל</TableHead>
                          <TableHead className="text-right cursor-pointer" onClick={() => setSortBy("health")}>בריאות</TableHead>
                          <TableHead className="text-right cursor-pointer" onClick={() => setSortBy("role")}>תפקיד</TableHead>
                          <TableHead className="text-right hidden md:table-cell cursor-pointer" onClick={() => setSortBy("team")}>צוות</TableHead>
                          <TableHead className="text-right hidden lg:table-cell">מנהל</TableHead>
                          <TableHead className="text-right cursor-pointer" onClick={() => setSortBy("status")}>סטטוס</TableHead>
                          <TableHead className="text-right hidden sm:table-cell cursor-pointer" onClick={() => setSortBy("last_login")}>כניסה אחרונה</TableHead>
                          <TableHead className="text-right hidden lg:table-cell cursor-pointer" onClick={() => setSortBy("created")}>נוצר</TableHead>
                          <TableHead className="text-right">פעולות</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paged.map((u) => (
                          <UserTableRow
                            key={u.id}
                            user={u}
                            teamName={u.team_id ? teamNameById.get(u.team_id) ?? "—" : "—"}
                            managerName={u.manager_id ? managerNameById.get(u.manager_id) ?? "—" : "—"}
                            activeAdminsCount={activeAdmins.length}
                            isSelf={me?.id === u.id}
                            onOpenDetails={() => setDetailsUserId(u.id)}
                            onAction={(type, user) => setAction({ type, user })}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {filtered.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        מציג {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} מתוך {filtered.length}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="עמוד קודם">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <div className="text-sm px-2 tabular-nums">{page} / {totalPages}</div>
                        <Button size="icon" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="עמוד הבא">
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
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

      <UserDetailsDrawer
        userId={detailsUserId}
        onOpenChange={(o) => !o && setDetailsUserId(null)}
        fallbackUser={detailsUser}
        onAction={(type, user) => setAction({ type, user })}
      />

      {action?.type === "edit" && (
        <EditUserDialog
          user={action.user}
          teams={teams}
          managers={managers}
          isSelf={me?.id === action.user.id}
          isLastActiveAdmin={action.user.active && action.user.roles.includes("admin") && activeAdmins.length <= 1}
          open
          onOpenChange={(o) => !o && closeAction()}
          onDone={onActionDone}
        />
      )}
      {action?.type === "resetPassword" && (
        <ResetPasswordDialog user={action.user} open onOpenChange={(o) => !o && closeAction()} onDone={onActionDone} />
      )}
      {action?.type === "changeTeam" && (
        <ChangeTeamDialog user={action.user} teams={teams} open onOpenChange={(o) => !o && closeAction()} onDone={onActionDone} />
      )}
      {action?.type === "link" && (
        <LinkRepresentativeDialog user={action.user} open onOpenChange={(o) => !o && closeAction()} onDone={onActionDone} />
      )}
      {action?.type === "unlink" && action.user.representative_link && (
        <UnlinkRepresentativeDialog user={action.user} open onOpenChange={(o) => !o && closeAction()} onDone={onActionDone} />
      )}
      {action?.type === "toggleActive" && (
        <ToggleActiveDialog user={action.user} open onOpenChange={(o) => !o && closeAction()} onDone={onActionDone} />
      )}
      {action?.type === "delete" && (
        <DeleteUserDialog
          user={action.user}
          open
          onOpenChange={(o) => !o && closeAction()}
          onDone={onActionDone}
          onPreferDisable={() => setAction({ type: "toggleActive", user: action.user })}
        />
      )}
    </div>
  );
}

function HealthBadge({ health }: { health: UserHealth }) {
  const cls = health.status === "healthy"
    ? "bg-[color:var(--success)]/15 text-[color:var(--success)] hover:bg-[color:var(--success)]/15"
    : health.status === "attention"
    ? "bg-[color:var(--warning)]/15 text-[color:var(--warning)] hover:bg-[color:var(--warning)]/15"
    : "bg-destructive/15 text-destructive hover:bg-destructive/15";
  const badge = (
    <Badge className={cn("gap-1 font-normal", health.reasons.length > 0 && "cursor-help", cls)} tabIndex={health.reasons.length > 0 ? 0 : undefined}>
      <span aria-hidden>{health.emoji}</span>
      <span className="hidden sm:inline">{health.label}</span>
    </Badge>
  );
  // Healthy users have no reasons to explain — skip the tooltip machinery entirely.
  if (health.reasons.length === 0) return badge;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-64" dir="rtl">
          <ul className="list-disc pr-4 space-y-0.5">
            {health.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function UserTableRow({
  user, teamName, managerName, activeAdminsCount, isSelf, onOpenDetails, onAction,
}: {
  user: UserRow; teamName: string; managerName: string; activeAdminsCount: number; isSelf: boolean;
  onOpenDetails: () => void; onAction: (type: ActionType, user: UserRow) => void;
}) {
  const isLastActiveAdmin = user.active && user.roles.includes("admin") && activeAdminsCount <= 1;
  const lastLogin = user.last_login_at ?? user.auth_last_sign_in_at;

  return (
    <TableRow
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={onOpenDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpenDetails(); }}
    >
      <TableCell className="font-medium">{user.full_name || "—"}</TableCell>
      <TableCell dir="ltr" className="text-right">{user.email}</TableCell>
      <TableCell><HealthBadge health={user.health} /></TableCell>
      <TableCell>
        <div className="flex gap-1 flex-wrap">
          {user.roles.length === 0 ? <Badge variant="outline">ללא</Badge> :
            user.roles.map((r) => <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>{roleLabel[r]}</Badge>)}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">{teamName}</TableCell>
      <TableCell className="hidden lg:table-cell">{managerName}</TableCell>
      <TableCell>
        {user.active ? <Badge className="bg-[color:var(--success)]/15 text-[color:var(--success)] hover:bg-[color:var(--success)]/15">פעיל</Badge> : <Badge variant="outline">מושבת</Badge>}
      </TableCell>
      <TableCell className="hidden sm:table-cell whitespace-nowrap text-xs">{lastLogin ? formatDateIL(lastLogin) : <span className="text-muted-foreground">טרם התחבר</span>}</TableCell>
      <TableCell className="hidden lg:table-cell whitespace-nowrap text-xs">{formatDateIL(user.created_at)}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <UserActionsMenu user={user} isSelf={isSelf} isLastActiveAdmin={isLastActiveAdmin} onOpenDetails={onOpenDetails} onAction={onAction} />
      </TableCell>
    </TableRow>
  );
}

function UserActionsMenu({
  user, isSelf, isLastActiveAdmin, onOpenDetails, onAction,
}: {
  user: UserRow; isSelf: boolean; isLastActiveAdmin: boolean;
  onOpenDetails: () => void; onAction: (type: ActionType, user: UserRow) => void;
}) {
  const isRepresentative = user.roles.includes("representative");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`פעולות עבור ${user.full_name || user.email}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={onOpenDetails}><Eye className="ms-2 h-4 w-4" />פרטי משתמש</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("edit", user)}><Pencil className="ms-2 h-4 w-4" />עריכת משתמש / שינוי תפקיד</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("changeTeam", user)}><UsersRound className="ms-2 h-4 w-4" />שינוי צוות</DropdownMenuItem>
        {isRepresentative && !user.representative_link && (
          <DropdownMenuItem onSelect={() => onAction("link", user)}><Link2 className="ms-2 h-4 w-4" />קישור לנציג</DropdownMenuItem>
        )}
        {user.representative_link && (
          <DropdownMenuItem onSelect={() => onAction("unlink", user)}><Unlink className="ms-2 h-4 w-4" />ניתוק נציג</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onAction("resetPassword", user)}><KeyRound className="ms-2 h-4 w-4" />איפוס סיסמה</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isSelf || (user.active && isLastActiveAdmin)}
          onSelect={() => onAction("toggleActive", user)}
        >
          {user.active ? <UserX className="ms-2 h-4 w-4" /> : <UserCheck className="ms-2 h-4 w-4" />}
          {user.active ? "השבתת משתמש" : "הפעלת משתמש"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isSelf}
          onSelect={() => onAction("delete", user)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="ms-2 h-4 w-4" />מחיקת משתמש
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

function UserDetailsDrawer({
  userId, onOpenChange, fallbackUser, onAction,
}: {
  userId: string | null;
  onOpenChange: (o: boolean) => void;
  fallbackUser: UserRow | undefined;
  onAction: (type: ActionType, user: UserRow) => void;
}) {
  const detailsFn = useServerFn(getUserDetails);
  const { user: me } = useAuth();
  const isSelf = !!userId && me?.id === userId;

  // Heavy per-user data (representative link detail, managed teams, owned-record
  // counts) is only fetched when the drawer actually opens — the users table itself
  // only carries the lightweight fields needed to render rows and the health badge.
  const q = useQuery({
    queryKey: ["admin", "user-details", userId],
    queryFn: () => detailsFn({ data: { user_id: userId as string } }),
    enabled: !!userId,
  });

  const d = q.data;

  return (
    <Sheet open={!!userId} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{d?.user.full_name || fallbackUser?.full_name || "פרטי משתמש"}</SheetTitle>
          <SheetDescription dir="ltr" className="text-right">{d?.user.email ?? fallbackUser?.email ?? ""}</SheetDescription>
        </SheetHeader>

        {q.isLoading ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : q.isError ? (
          <div className="p-4 text-sm text-destructive">{(q.error as Error).message}</div>
        ) : d ? (
          <div className="space-y-5 p-4">
            <div className="space-y-1.5">
              <HealthBadge health={d.health} />
              {d.health.reasons.length > 0 && (
                <ul className="list-disc pr-4 text-xs text-muted-foreground space-y-0.5">
                  {d.health.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Stat label="תפקיד" value={d.user.roles.length ? d.user.roles.map((r: AppRole) => roleLabel[r]).join(", ") : "ללא"} />
              <Stat label="סטטוס חשבון" value={d.user.active ? "פעיל" : "מושבת"} />
              <Stat label="צוות" value={d.user.team_name ?? "—"} />
              <Stat label="נוצר בתאריך" value={formatDateIL(d.user.created_at)} />
            </div>

            <div>
              <Label>כניסה אחרונה</Label>
              <div className="text-sm mt-1">
                {(d.user.last_login_at ?? d.user.auth_last_sign_in_at)
                  ? formatDateIL(d.user.last_login_at ?? d.user.auth_last_sign_in_at)
                  : "טרם התחבר"}
              </div>
            </div>

            <div className="space-y-2">
              <Label>נציג מקושר</Label>
              {d.representative_link ? (
                <div className="rounded-xl border p-2.5 text-sm flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.representative_link.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {d.representative_link.team_name ?? "ללא צוות"}{!d.representative_link.active ? " · מושבת" : ""}
                    </div>
                  </div>
                  {fallbackUser && (
                    <Button size="sm" variant="outline" onClick={() => onAction("unlink", fallbackUser)}>ניתוק</Button>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground space-y-2">
                  <div>לא מקושר לנציג</div>
                  {fallbackUser && (
                    <Button size="sm" variant="outline" onClick={() => onAction("link", fallbackUser)}>
                      <Link2 className="ms-1 h-4 w-4" />קישור לנציג
                    </Button>
                  )}
                </div>
              )}
            </div>

            {d.manages_teams.length > 0 && (
              <div className="space-y-2">
                <Label>מנהל את הצוותים</Label>
                <div className="text-sm">{d.manages_teams.map((t: { name: string }) => t.name).join(", ")}</div>
              </div>
            )}

            <div className="space-y-2">
              <Label>רשומות בבעלות המשתמש</Label>
              <div className="text-xs text-muted-foreground">
                {Object.entries(d.owned_records as Record<string, number>).filter(([, c]) => c > 0).map(([k, c]) => `${ownedRecordLabel[k] ?? k}: ${c}`).join(" · ") || "אין רשומות"}
              </div>
            </div>

            {fallbackUser && (
              <div className="flex flex-wrap gap-2 pt-3 border-t">
                <Button size="sm" variant="outline" onClick={() => onAction("edit", fallbackUser)}><Pencil className="ms-1 h-4 w-4" />עריכה</Button>
                <Button size="sm" variant="outline" onClick={() => onAction("changeTeam", fallbackUser)}><UsersRound className="ms-1 h-4 w-4" />שינוי צוות</Button>
                <Button size="sm" variant="outline" onClick={() => onAction("resetPassword", fallbackUser)}><KeyRound className="ms-1 h-4 w-4" />איפוס סיסמה</Button>
                <Button size="sm" variant="outline" disabled={isSelf} onClick={() => onAction("toggleActive", fallbackUser)}>
                  {fallbackUser.active ? <UserX className="ms-1 h-4 w-4" /> : <UserCheck className="ms-1 h-4 w-4" />}
                  {fallbackUser.active ? "השבתה" : "הפעלה"}
                </Button>
                <Button size="sm" variant="outline" disabled={isSelf} className="text-destructive hover:text-destructive" onClick={() => onAction("delete", fallbackUser)}>
                  <Trash2 className="ms-1 h-4 w-4" />מחיקה
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ChangeTeamDialog({
  user, teams, open, onOpenChange, onDone,
}: { user: UserRow; teams: Team[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [teamId, setTeamId] = useState<string>(user.team_id ?? "none");
  const assignFn = useServerFn(setUserTeam);
  const mut = useMutation({
    mutationFn: () => assignFn({ data: { user_id: user.id, team_id: teamId === "none" ? null : teamId } }),
    onSuccess: () => { toast.success("הצוות עודכן"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>שינוי צוות</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">משתמש: <span className="text-foreground font-medium">{user.full_name || user.email}</span></div>
          <div className="space-y-1">
            <Label>צוות</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">ללא צוות</SelectItem>
                {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>שמירה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkRepresentativeDialog({
  user, open, onOpenChange, onDone,
}: { user: UserRow; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const listFn = useServerFn(listRepresentatives);
  const linkFn = useServerFn(linkRepresentativeUser);
  const [repId, setRepId] = useState("");

  const q = useQuery({ queryKey: ["admin", "representatives-for-link"], queryFn: () => listFn(), enabled: open });
  const available = ((q.data ?? []) as any[]).filter((r) => !r.linked_user && r.active);

  const mut = useMutation({
    mutationFn: () => linkFn({ data: { rep_id: repId, user_id: user.id } }),
    onSuccess: () => { toast.success("הנציג קושר למשתמש"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>קישור לפרופיל נציג</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">משתמש: <span className="text-foreground font-medium">{user.full_name || user.email}</span></div>
          {q.isLoading ? (
            <div className="text-sm text-muted-foreground">טוען נציגים זמינים...</div>
          ) : available.length === 0 ? (
            <div className="text-sm text-destructive">אין פרופילי נציג פעילים הזמינים לקישור.</div>
          ) : (
            <div className="space-y-1">
              <Label>נציג</Label>
              <Select value={repId} onValueChange={setRepId}>
                <SelectTrigger><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                <SelectContent>
                  {available.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={() => mut.mutate()} disabled={!repId || mut.isPending}>קישור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnlinkRepresentativeDialog({
  user, open, onOpenChange, onDone,
}: { user: UserRow; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const linkFn = useServerFn(linkRepresentativeUser);
  const mut = useMutation({
    mutationFn: () => linkFn({ data: { rep_id: user.representative_link!.id, user_id: null } }),
    onSuccess: () => { toast.success("הנציג נותק מהמשתמש"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>ניתוק נציג?</AlertDialogTitle>
          <AlertDialogDescription>
            הקישור בין המשתמש לנציג "{user.representative_link?.name}" יוסר. נתוני הנציג עצמו יישארו במערכת ללא שינוי.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction onClick={() => mut.mutate()}>ניתוק</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ToggleActiveDialog({
  user, open, onOpenChange, onDone,
}: { user: UserRow; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const updateFn = useServerFn(updateUser);
  const mut = useMutation({
    mutationFn: () => updateFn({ data: { user_id: user.id, active: !user.active } }),
    onSuccess: () => { toast.success(!user.active ? "המשתמש הופעל" : "המשתמש הושבת"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{user.active ? "להשבית את המשתמש?" : "להפעיל את המשתמש?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {user.active
              ? "המשתמש לא יוכל להתחבר עד להפעלה מחדש. היסטוריית הפעילות והרישום ביומן הפעולות יישמרו במלואם."
              : "המשתמש יוכל להתחבר מחדש למערכת."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction onClick={() => mut.mutate()} disabled={mut.isPending}>אישור</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteUserDialog({
  user, open, onOpenChange, onDone, onPreferDisable,
}: { user: UserRow; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void; onPreferDisable: () => void }) {
  const checkFn = useServerFn(getUserDeleteCheck);
  const deleteFn = useServerFn(deleteUser);
  const [confirmEmail, setConfirmEmail] = useState("");

  const q = useQuery({
    queryKey: ["admin", "user-delete-check", user.id],
    queryFn: () => checkFn({ data: { user_id: user.id } }),
    enabled: open,
  });

  const mut = useMutation({
    mutationFn: () => deleteFn({ data: { user_id: user.id, confirm_email: confirmEmail } }),
    onSuccess: (r) => {
      toast.success(r.representative_unlinked ? `המשתמש נמחק. הנציג "${r.representative_unlinked}" נשאר במערכת ללא קישור.` : "המשתמש נמחק");
      onDone();
    },
    onError: (e: Error) => {
      // fetch() only ever rejects for a network-layer failure (dropped
      // connection, proxy timeout) — a real error our server returned still
      // resolves the request and reaches us as a proper thrown message. A
      // network failure here does NOT mean the deletion failed: the server
      // may have completed it before the response was lost in transit. We
      // must not assert failure we can't verify — close the dialog and
      // resync the list from the server so the real state speaks for itself.
      if (isNetworkFailure(e)) {
        toast.error("החיבור נכשל בעת קבלת התשובה מהשרת. בודקים מול הרשימה אם המחיקה בכל זאת בוצעה...");
        onDone();
        return;
      }
      toast.error(e.message);
    },
  });

  const check = q.data;
  const emailMatches = !!check?.user.email && confirmEmail.trim().toLowerCase() === check.user.email.toLowerCase();
  const canDelete = !!check && check.blockers.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setConfirmEmail(""); }}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>מחיקת משתמש</DialogTitle></DialogHeader>
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground p-4 text-center">בודק תלויות...</div>
        ) : q.isError ? (
          <div className="text-sm text-destructive">{(q.error as Error).message}</div>
        ) : check ? (
          <div className="space-y-3">
            <div className="text-sm">משתמש: <span className="font-medium">{check.user.full_name || check.user.email}</span></div>

            {check.blockers.length > 0 ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive space-y-1">
                {check.blockers.map((b: { label: string }, i: number) => <div key={i}>{b.label}</div>)}
              </div>
            ) : (
              <>
                {/* Delete is a last resort — disabling is reversible, keeps every
                    history/audit trail intact, and covers "this person shouldn't have
                    access anymore" for the vast majority of real cases. */}
                {user.active && (
                  <div className="rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 p-3 text-sm text-[color:var(--warning)] flex items-center justify-between gap-3">
                    <div>מומלץ להשבית את המשתמש במקום למחוק אותו לצמיתות — השבתה הפיכה ושומרת את כל ההיסטוריה.</div>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={onPreferDisable}>השבתה במקום</Button>
                  </div>
                )}

                <div className="rounded-lg border p-3 text-sm space-y-2">
                  <div>
                    <div className="font-medium">מה יימחק:</div>
                    <ul className="list-disc pr-4 text-muted-foreground space-y-0.5 mt-1">
                      <li>חשבון ההתחברות <span dir="ltr">({check.user.email})</span> וסיסמתו</li>
                      <li>שיוך התפקיד, הצוות והמנהל האחראי של המשתמש</li>
                    </ul>
                  </div>
                  <div>
                    <div className="font-medium">מה יישאר במערכת:</div>
                    <ul className="list-disc pr-4 text-muted-foreground space-y-0.5 mt-1">
                      <li>יומן הפעולות (audit log) — כולל רישום פעולת המחיקה עצמה</li>
                      {check.representative_link && (
                        <li>נתוני הנציג המקושר "{check.representative_link.name}" — יישארו במלואם, ללא קישור לחשבון</li>
                      )}
                      {check.owned_records_total > 0 && (
                        <li>רשומות שנוצרו על ידי המשתמש ({check.owned_records_total}) — יישארו ללא שיוך למשתמש</li>
                      )}
                    </ul>
                  </div>
                </div>

                <div className="space-y-1 pt-1">
                  <Label>הקלידו את כתובת המייל של המשתמש לאישור המחיקה: <span dir="ltr" className="font-mono">{check.user.email}</span></Label>
                  <Input dir="ltr" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
                </div>
              </>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          {canDelete && (
            <Button variant="destructive" disabled={!emailMatches || mut.isPending} onClick={() => mut.mutate()}>
              מחיקה סופית
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
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
  user, teams, managers, isSelf, isLastActiveAdmin, open, onOpenChange, onDone,
}: {
  user: UserRow; teams: Team[]; managers: UserRow[]; isSelf: boolean; isLastActiveAdmin: boolean;
  open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [role, setRole] = useState<AppRole>(user.roles[0] ?? "representative");
  const [teamId, setTeamId] = useState<string>(user.team_id ?? "none");
  const [managerId, setManagerId] = useState<string>(user.manager_id ?? "none");
  const [repId, setRepId] = useState<string>(user.representative_link?.id ?? user.representative_id ?? "");
  const [mustChange, setMustChange] = useState(user.must_change_password);
  const { state } = useApp();
  const updateFn = useServerFn(updateUser);

  const mut = useMutation({
    mutationFn: updateFn,
    onSuccess: () => { toast.success("המשתמש עודכן"); onDone(); },
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button type="submit" disabled={mut.isPending || showLastAdminWarning}>שמירה</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user, open, onOpenChange, onDone,
}: { user: UserRow; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [newPassword, setNewPassword] = useState(() => generateTempPassword());
  const [mustChange, setMustChange] = useState(true);
  const resetFn = useServerFn(resetPassword);
  const emailFn = useServerFn(sendPasswordResetEmail);

  const resetMut = useMutation({
    mutationFn: resetFn,
    onSuccess: () => { toast.success("הסיסמה אופסה"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const emailMut = useMutation({
    mutationFn: emailFn,
    onSuccess: () => { toast.success("נשלח מייל איפוס סיסמה"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
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
