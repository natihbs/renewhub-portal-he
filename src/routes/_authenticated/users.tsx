import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
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
import { InitialsAvatar, MetricCard, SectionHeading } from "@/components/dashboard/Surfaces";
import {
  Users2,
  Plus,
  Search,
  KeyRound,
  Pencil,
  UserCheck,
  UserX,
  Copy,
  Mail,
  ShieldAlert,
  MoreHorizontal,
  Eye,
  UsersRound,
  Link2,
  Unlink,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  LogIn,
  HeartPulse,
  LayoutGrid,
  Rows3,
  Building2,
  Clock,
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
  updateUserEmail,
  resetPassword,
  sendPasswordResetEmail,
  getUserDetails,
  getUserDeleteCheck,
  deleteUser,
} from "@/lib/user-admin.functions";
import {
  CREATE_ROLE_OPTIONS,
  CREATE_ROLE_HELPER_TEXT,
  EDIT_SCOPE_HELPER_TEXT,
} from "@/lib/business-scope";
import { setUserTeam } from "@/lib/team-admin.functions";
import { linkRepresentativeUser, listRepresentatives } from "@/lib/rep-admin.functions";
import { useWorkspace, workspaceTeamId } from "@/lib/workspace-context";
import { isNetworkFailure } from "@/lib/network-error";
import { isSelfActivation } from "@/lib/keyboard-activation";
import {
  auditDetailChips,
  filterAndSortUsers,
  hasAuditDetails,
  hasEverLoggedIn,
  summarizeUsers,
  USERS_SORT_OPTIONS,
  USERS_SUMMARY_SCOPE_LABEL,
  type UsersSortKey,
} from "@/lib/users-overview";

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
  /** Effective business title (מנהל מוקד · <unit> etc.) — display only. */
  business_title?: string;
  auth_last_sign_in_at: string | null;
  representative_link: RepLink;
  health: UserHealth;
};

type Team = { id: string; name: string; manager_id: string | null };

type ActionType = "edit" | "changeTeam" | "link" | "unlink" | "resetPassword" | "toggleActive" | "delete";
type PendingAction = { type: ActionType; user: UserRow } | null;

const roleLabel: Record<AppRole, string> = {
  admin: "מנהל מערכת",
  manager: "מנהל צוות",
  representative: "נציג",
};

const ownedRecordLabel: Record<string, string> = {
  announcements: "הודעות",
  articles: "מאמרים",
  competitions: "תחרויות",
  manager_calls: "שיחות מנהל",
};

const PAGE_SIZE = 25;

/** People layer density — cards by default, the dense list as a second mode. */
type PeopleView = "cards" | "list";

/**
 * Every cache a user-admin mutation (create/update/email/role/link/unlink/
 * delete) can make stale, in one awaited place — exported and unit-tested
 * exactly like invalidateTeamAdminCaches in teams.tsx:
 *   ["admin"]          prefix — the /users list (business_title + health are
 *                      SERVER-derived in listUsers), the details drawer
 *                      (["admin","user-details",id]), delete-checks, audit,
 *                      and the home console counters.
 *   ["representatives"] the store mirror (useCloudTeams/WorkspaceProvider,
 *                      home dashboards) — a rep link/unlink or role change
 *                      alters who appears there.
 *   ["business-scope"]  the caller's own resolved scope (header identity,
 *                      ManagerHome/targets overviews) — a role change can
 *                      change it.
 * Invalidation marks data stale so mounted screens refetch immediately;
 * /users itself additionally refetches on every mount (see usersQ below).
 */
export function invalidateUserAdminCaches(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["admin"] }),
    qc.invalidateQueries({ queryKey: ["representatives"] }),
    qc.invalidateQueries({ queryKey: ["business-scope"] }),
  ]);
}

function UsersPage() {
  const list = useServerFn(listUsers);
  const audit = useServerFn(listAuditLog);
  const qc = useQueryClient();
  const { user: me } = useAuth();

  // refetchOnMount "always": every visit to /users re-reads the list from the
  // server, even if a cached copy exists and even if some other screen (with
  // its own staleTime) recently marked it fresh. business_title and health
  // are SERVER-derived from user_business_scopes — a snapshot cached while an
  // admin was mid-way through configuring scopes on /teams showed wrong
  // titles here until a hard refresh. The cached rows still render instantly;
  // this only guarantees the correcting refetch always fires.
  const usersQ = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => list(),
    refetchOnMount: "always",
  });
  const auditQ = useQuery({ queryKey: ["admin", "audit"], queryFn: () => audit() });

  // Memoized so the `?? []` fallback keeps a stable identity and the
  // downstream derivations (filter/sort, summary, name indexes) don't re-run
  // on every render.
  const users = useMemo(() => (usersQ.data?.users ?? []) as UserRow[], [usersQ.data?.users]);
  const teams = useMemo(() => (usersQ.data?.teams ?? []) as Team[], [usersQ.data?.teams]);
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
  const [sortBy, setSortBy] = useState<UsersSortKey>("name");
  const [page, setPage] = useState(1);
  const [peopleView, setPeopleView] = useState<PeopleView>("cards");

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

  // Search / technical role / workspace team scope / status / health / sort —
  // the same six controls, applied by a pure, unit-tested helper
  // (users-overview.ts) instead of an inline predicate. Behavior is unchanged,
  // including the searched fields and every comparator. teamFilter still comes
  // from the shared Workspace Context, never from a page-local control.
  const filtered = useMemo(
    () =>
      filterAndSortUsers(
        users,
        { search, roleFilter, teamFilter, statusFilter, healthFilter, sortBy },
        {
          teamName: (id) => teamNameById.get(id) ?? "",
          managerName: (id) => managerNameById.get(id) ?? "",
        },
      ),
    [
      users,
      search,
      roleFilter,
      teamFilter,
      statusFilter,
      healthFilter,
      sortBy,
      teamNameById,
      managerNameById,
    ],
  );

  // Organization summary over ALL users this admin can see in the current
  // workspace scope — never the filtered subset (the command bar's counter
  // tracks that). Pure and unit-tested in users-overview.ts.
  const scopeUsers = useMemo(
    () => (teamFilter === "all" ? users : users.filter((u) => u.team_id === teamFilter)),
    [users, teamFilter],
  );
  const summary = useMemo(() => summarizeUsers(scopeUsers), [scopeUsers]);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, teamFilter, statusFilter, healthFilter, sortBy]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeAdmins = users.filter((u) => u.active && u.roles.includes("admin"));

  function invalidateAll() {
    return invalidateUserAdminCaches(qc);
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
        icon={Users2}
        description="מרכז ניהול משתמשים, תפקידים, צוותים וקישורי נציגים"
      />

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">משתמשים</TabsTrigger>
          <TabsTrigger value="audit">יומן פעולות</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          {/* People summary — counts only, over every user visible in the
              current workspace scope (NOT the filtered subset below). There is
              no HR metric here to invent: health comes from the server-computed
              UserHealth, everything else is a tally of listUsers rows. */}
          {!usersQ.isLoading && !usersQ.isError && scopeUsers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {USERS_SUMMARY_SCOPE_LABEL}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
                <MetricCard
                  icon={Users2}
                  label="חשבונות משתמש"
                  value={String(summary.total)}
                  sub={`${summary.active} פעילים · ${summary.inactive} מושבתים`}
                  tone="primary"
                />
                <MetricCard
                  icon={HeartPulse}
                  label="חשבונות תקינים"
                  value={String(summary.healthy)}
                  sub={`מתוך ${summary.total} חשבונות`}
                  tone="success"
                />
                <MetricCard
                  icon={ShieldAlert}
                  label="דורשים טיפול"
                  value={String(summary.issue + summary.attention)}
                  sub={
                    summary.issue + summary.attention > 0
                      ? `${summary.issue} בעיית הגדרה · ${summary.attention} דורש תשומת לב`
                      : "אין בעיות הגדרה פתוחות"
                  }
                  tone={
                    summary.issue > 0 ? "warning" : summary.attention > 0 ? "accent" : "success"
                  }
                />
                <MetricCard
                  icon={LogIn}
                  label="טרם התחברו"
                  value={String(summary.neverLoggedIn)}
                  sub={`מתוך ${summary.total} חשבונות`}
                  tone={summary.neverLoggedIn > 0 ? "accent" : "success"}
                />
                <MetricCard
                  icon={ShieldCheck}
                  label="מנהלי מערכת"
                  value={String(summary.byRole.admin)}
                  sub={`${summary.byRole.manager} מנהלים · ${summary.byRole.representative} נציגים`}
                  tone="primary"
                />
                <MetricCard
                  icon={Link2}
                  label="נציגים ללא קישור"
                  value={String(summary.representativesUnlinked)}
                  sub={`מתוך ${summary.representativeAccounts} חשבונות נציג`}
                  tone={summary.representativesUnlinked > 0 ? "warning" : "success"}
                />
              </div>
            </div>
          )}

          {/* Command bar — search, the four list controls, sorting, the live
              result count, the workspace scope this list is showing, the
              density toggle and the create action on one surface. Same state
              and handlers as before. */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש לפי שם, מייל, צוות, מנהל או תפקיד עסקי"
                aria-label="חיפוש משתמשים"
                className="h-9 pe-9"
              />
            </div>
            {/* Filters by the TECHNICAL permission (role=manager covers
                מנהל צוות/מוקד/פעילות/סמנכ"ל alike), hence "מנהל". */}
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9 w-full sm:w-40" aria-label="סינון לפי הרשאת מערכת">
                <SelectValue placeholder="הרשאת מערכת" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל ההרשאות</SelectItem>
                <SelectItem value="admin">מנהל מערכת</SelectItem>
                <SelectItem value="manager">מנהל</SelectItem>
                <SelectItem value="representative">נציג</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full sm:w-32" aria-label="סינון לפי סטטוס">
                <SelectValue placeholder="סטטוס" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="active">פעיל</SelectItem>
                <SelectItem value="inactive">מושבת</SelectItem>
              </SelectContent>
            </Select>
            <Select value={healthFilter} onValueChange={setHealthFilter}>
              <SelectTrigger className="h-9 w-full sm:w-44" aria-label="סינון לפי בריאות">
                <SelectValue placeholder="בריאות" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל רמות הבריאות</SelectItem>
                <SelectItem value="healthy">🟢 תקין</SelectItem>
                <SelectItem value="attention">🟠 דורש תשומת לב</SelectItem>
                <SelectItem value="issue">🔴 בעיית הגדרה</SelectItem>
              </SelectContent>
            </Select>
            {/* The sort control the table's clickable headers used to be — the
                same eight modes, now reachable without a table. */}
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as UsersSortKey)}>
              <SelectTrigger className="h-9 w-full sm:w-48" aria-label="מיון">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USERS_SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Read-only indicator of the shared Workspace scope this list is
                showing — the switcher itself stays in the header. */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle px-3 py-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {workspace.type === "team" ? workspace.teamName : "כלל הארגון"}
            </span>
            <span className="text-xs text-muted-foreground">
              מציג {filtered.length} מתוך {scopeUsers.length}
            </span>
            <div className="ms-auto flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-full bg-surface-subtle p-1">
                <Button
                  size="icon"
                  variant={peopleView === "cards" ? "default" : "ghost"}
                  className="h-7 w-7 rounded-full"
                  aria-label="תצוגת כרטיסים"
                  aria-pressed={peopleView === "cards"}
                  onClick={() => setPeopleView("cards")}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant={peopleView === "list" ? "default" : "ghost"}
                  className="h-7 w-7 rounded-full"
                  aria-label="תצוגת רשימה צפופה"
                  aria-pressed={peopleView === "list"}
                  onClick={() => setPeopleView("list")}
                >
                  <Rows3 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <CreateUserDialog teams={teams} managers={managers} onDone={invalidateAll} />
            </div>
          </div>

          <Card>
            <CardContent className="space-y-4 pt-5">
              {usersQ.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : usersQ.isError ? (
                <div className="p-8 text-center text-sm text-destructive">
                  שגיאה בטעינת משתמשים: {(usersQ.error as Error).message}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={Users2}
                  title="אין משתמשים תואמים"
                  description="נסה לשנות את הסינון"
                  compact
                />
              ) : (
                <>
                  {peopleView === "cards" ? (
                    /* People surfaces — one management card per account at every
                       width. Same click target (the details drawer), same
                       UserActionsMenu, same permission gates. */
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                      {paged.map((u) => (
                        <PersonCard
                          key={u.id}
                          user={u}
                          teamName={u.team_id ? (teamNameById.get(u.team_id) ?? "—") : "—"}
                          managerName={
                            u.manager_id ? (managerNameById.get(u.manager_id) ?? "—") : "—"
                          }
                          activeAdminsCount={activeAdmins.length}
                          isSelf={me?.id === u.id}
                          onOpenDetails={() => setDetailsUserId(u.id)}
                          onAction={(type, user) => setAction({ type, user })}
                        />
                      ))}
                    </div>
                  ) : (
                    /* Dense secondary mode — the same rows, for admins scanning
                       many accounts at once. */
                    <div className="rounded-xl border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">שם מלא</TableHead>
                            <TableHead className="text-right">אימייל</TableHead>
                            <TableHead className="text-right">בריאות</TableHead>
                            <TableHead className="text-right">תפקיד</TableHead>
                            <TableHead className="text-right hidden md:table-cell">
                              צוות (פרופיל)
                            </TableHead>
                            <TableHead className="text-right hidden lg:table-cell">
                              מנהל אחראי
                            </TableHead>
                            <TableHead className="text-right">סטטוס</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">
                              כניסה אחרונה
                            </TableHead>
                            <TableHead className="text-right hidden lg:table-cell">נוצר</TableHead>
                            <TableHead className="text-right">פעולות</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paged.map((u) => (
                            <UserTableRow
                              key={u.id}
                              user={u}
                              teamName={u.team_id ? (teamNameById.get(u.team_id) ?? "—") : "—"}
                              managerName={
                                u.manager_id ? (managerNameById.get(u.manager_id) ?? "—") : "—"
                              }
                              activeAdminsCount={activeAdmins.length}
                              isSelf={me?.id === u.id}
                              onOpenDetails={() => setDetailsUserId(u.id)}
                              onAction={(type, user) => setAction({ type, user })}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {filtered.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        מציג {(page - 1) * PAGE_SIZE + 1}–
                        {Math.min(page * PAGE_SIZE, filtered.length)} מתוך {filtered.length}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="outline"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => p - 1)}
                          aria-label="עמוד קודם"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <div className="text-sm px-2 tabular-nums">
                          {page} / {totalPages}
                        </div>
                        <Button
                          size="icon"
                          variant="outline"
                          disabled={page >= totalPages}
                          onClick={() => setPage((p) => p + 1)}
                          aria-label="עמוד הבא"
                        >
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

        <TabsContent value="audit" className="space-y-4">
          <SectionHeading
            title="יומן פעולות אדמין"
            hint="רישום קבוע לכל פעולת ניהול. הרשומות אינן ניתנות לעריכה או למחיקה מהמסך."
          />
          {auditQ.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (auditQ.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={ShieldAlert}
                  title="אין רישומים"
                  description="פעולות ניהול יופיעו כאן"
                  compact
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {(auditQ.data ?? []).map((r: any) => (
                <AuditEntryRow key={r.id} entry={r} />
              ))}
            </div>
          )}
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
          isLastActiveAdmin={
            action.user.active && action.user.roles.includes("admin") && activeAdmins.length <= 1
          }
          open
          onOpenChange={(o) => !o && closeAction()}
          onDone={onActionDone}
        />
      )}
      {action?.type === "resetPassword" && (
        <ResetPasswordDialog
          user={action.user}
          open
          onOpenChange={(o) => !o && closeAction()}
          onDone={onActionDone}
        />
      )}
      {action?.type === "changeTeam" && (
        <ChangeTeamDialog
          user={action.user}
          teams={teams}
          open
          onOpenChange={(o) => !o && closeAction()}
          onDone={onActionDone}
        />
      )}
      {action?.type === "link" && (
        <LinkRepresentativeDialog
          user={action.user}
          open
          onOpenChange={(o) => !o && closeAction()}
          onDone={onActionDone}
        />
      )}
      {action?.type === "unlink" && action.user.representative_link && (
        <UnlinkRepresentativeDialog
          user={action.user}
          open
          onOpenChange={(o) => !o && closeAction()}
          onDone={onActionDone}
        />
      )}
      {action?.type === "toggleActive" && (
        <ToggleActiveDialog
          user={action.user}
          open
          onOpenChange={(o) => !o && closeAction()}
          onDone={onActionDone}
        />
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
    ? "bg-[color:var(--success)]/15 text-success-foreground hover:bg-[color:var(--success)]/15"
    : health.status === "attention"
    ? "bg-[color:var(--warning)]/15 text-warning-foreground hover:bg-[color:var(--warning)]/15"
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

/**
 * One account as a people-management surface. Everything shown is a value the
 * users list already carries — the business title is the SERVER-derived
 * display title, health is the server-computed UserHealth, and nothing here is
 * an invented HR figure.
 *
 * The whole card opens the existing details drawer. The actions cluster stops
 * click propagation, and the card's keyboard handler only fires for a keypress
 * on the card ITSELF (isSelfActivation) — the dropdown trigger and its
 * portalled menu items keep their own keyboard behavior.
 */
function PersonCard({
  user, teamName, managerName, activeAdminsCount, isSelf, onOpenDetails, onAction,
}: {
  user: UserRow; teamName: string; managerName: string; activeAdminsCount: number; isSelf: boolean;
  onOpenDetails: () => void; onAction: (type: ActionType, user: UserRow) => void;
}) {
  const isLastActiveAdmin = user.active && user.roles.includes("admin") && activeAdminsCount <= 1;
  const lastLogin = user.last_login_at ?? user.auth_last_sign_in_at;
  const needsRepLink = user.roles.includes("representative") && !user.representative_link;
  const edge =
    !user.active
      ? "before:bg-muted-foreground/40"
      : user.health.status === "issue"
        ? "before:bg-destructive"
        : user.health.status === "attention"
          ? "before:bg-[color:var(--warning)]"
          : "before:bg-primary";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(e) => {
        // Nested controls own their own keyboard behavior — see
        // isSelfActivation (keyboard-activation.ts).
        if (!isSelfActivation(e)) return;
        e.preventDefault();
        onOpenDetails();
      }}
      className={cn(
        "surface-tile relative cursor-pointer overflow-hidden p-4",
        "before:absolute before:inset-y-4 before:start-0 before:w-1 before:rounded-e-full",
        edge,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start gap-3">
        <InitialsAvatar name={user.full_name || user.email || "?"} className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base font-bold">{user.full_name || "—"}</div>
          <div dir="ltr" className="truncate text-xs text-muted-foreground text-start">
            {user.email ?? "—"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <UserActionsMenu
            user={user}
            isSelf={isSelf}
            isLastActiveAdmin={isLastActiveAdmin}
            onOpenDetails={onOpenDetails}
            onAction={onAction}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {/* The EFFECTIVE business title (מנהל מוקד · <unit> etc.), derived
            server-side from user_business_scopes — never a stored role. */}
        {user.roles.length === 0 ? (
          <Badge variant="outline">ללא</Badge>
        ) : (
          <Badge variant={user.roles.includes("admin") ? "default" : "secondary"}>
            {user.business_title ?? roleLabel[user.roles[0]]}
          </Badge>
        )}
        <HealthBadge health={user.health} />
        {user.active ? (
          <Badge className="bg-[color:var(--success)]/15 text-success-foreground hover:bg-[color:var(--success)]/15">
            פעיל
          </Badge>
        ) : (
          <Badge variant="outline">מושבת</Badge>
        )}
        {needsRepLink && (
          <Badge variant="outline" className="gap-1 border-[color:var(--warning)]/40 text-warning-foreground">
            <Unlink className="h-3 w-3" />
            ללא נציג מקושר
          </Badge>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-3 text-xs">
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">צוות (פרופיל)</div>
          <div className="truncate font-medium">{teamName}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">מנהל אחראי</div>
          <div className="truncate font-medium">{managerName}</div>
        </div>
        <div className="col-span-2 flex items-center gap-1.5 text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {lastLogin ? `כניסה אחרונה ${formatDateIL(lastLogin)}` : "טרם התחבר"}
          <span aria-hidden>·</span>
          <span>נוצר {formatDateIL(user.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * One audit record as an operational activity row. The record itself is never
 * altered: `details` is rendered as concise key/value chips only when it is a
 * flat object (auditDetailChips), and the RAW JSON stays one click away — an
 * unknown action never gets an invented human sentence.
 */
function AuditEntryRow({ entry }: { entry: any }) {
  const [rawOpen, setRawOpen] = useState(false);
  const chips = auditDetailChips(entry.details);
  const hasRaw = hasAuditDetails(entry.details);
  return (
    <div className="surface-tile p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono text-[11px]">{entry.action}</Badge>
        <span className="text-xs text-muted-foreground">{formatDateIL(entry.created_at)}</span>
        <span className="ms-auto text-xs text-muted-foreground">
          {hasRaw && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              aria-expanded={rawOpen}
              onClick={() => setRawOpen((v) => !v)}
            >
              {rawOpen ? "הסתרת פרטים גולמיים" : "פרטים גולמיים"}
            </Button>
          )}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">מבצע הפעולה</div>
          <div dir="ltr" className="truncate text-start font-medium">{entry.actor_email ?? "—"}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">משתמש מושפע</div>
          <div dir="ltr" className="truncate text-start font-medium">{entry.target_email ?? "—"}</div>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="max-w-full truncate rounded-md bg-surface-subtle px-2 py-0.5 text-[11px] text-muted-foreground"
              dir="ltr"
            >
              {c}
            </span>
          ))}
        </div>
      )}
      {rawOpen && (
        <pre
          dir="ltr"
          className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-subtle p-2 text-[11px] leading-relaxed"
        >
          {JSON.stringify(entry.details, null, 2)}
        </pre>
      )}
    </div>
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
      // Same rule as the card: the row reacts only to a keypress on the row
      // ITSELF. Without the guard, Enter on the actions trigger (or on a menu
      // item, which bubbles through the React tree from its portal) opened the
      // details drawer on top of the action the user actually invoked.
      onKeyDown={(e) => {
        if (!isSelfActivation(e)) return;
        e.preventDefault();
        onOpenDetails();
      }}
    >
      <TableCell className="font-medium">
        <div className="flex items-center gap-2.5">
          <InitialsAvatar name={user.full_name || user.email || "?"} className="h-8 w-8" />
          <span className="truncate">{user.full_name || "—"}</span>
        </div>
      </TableCell>
      <TableCell dir="ltr" className="text-right">
        {user.email}
      </TableCell>
      <TableCell>
        <HealthBadge health={user.health} />
      </TableCell>
      <TableCell>
        <div className="flex gap-1 flex-wrap">
          {/* The EFFECTIVE business title (מנהל מוקד · <unit> etc.), derived
              server-side from user_business_scopes — never a stored role. */}
          {user.roles.length === 0 ? (
            <Badge variant="outline">ללא</Badge>
          ) : (
            <Badge variant={user.roles.includes("admin") ? "default" : "secondary"}>
              {user.business_title ?? roleLabel[user.roles[0]]}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">{teamName}</TableCell>
      <TableCell className="hidden lg:table-cell">{managerName}</TableCell>
      <TableCell>
        {user.active ? (
          <Badge className="bg-[color:var(--success)]/15 text-success-foreground hover:bg-[color:var(--success)]/15">
            פעיל
          </Badge>
        ) : (
          <Badge variant="outline">מושבת</Badge>
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell whitespace-nowrap text-xs">
        {lastLogin ? (
          formatDateIL(lastLogin)
        ) : (
          <span className="text-muted-foreground">טרם התחבר</span>
        )}
      </TableCell>
      <TableCell className="hidden lg:table-cell whitespace-nowrap text-xs">
        {formatDateIL(user.created_at)}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <UserActionsMenu
          user={user}
          isSelf={isSelf}
          isLastActiveAdmin={isLastActiveAdmin}
          onOpenDetails={onOpenDetails}
          onAction={onAction}
        />
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
      <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

/** One titled section of the details drawer — grouping only, no behavior. */
function DrawerSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 border-b pb-1.5">
        <Icon aria-hidden className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      </div>
      {children}
    </section>
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
          <SheetDescription dir="ltr" className="text-right">
            {d?.user.email ?? fallbackUser?.email ?? ""}
          </SheetDescription>
        </SheetHeader>

        {q.isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="p-4 text-sm text-destructive">{(q.error as Error).message}</div>
        ) : d ? (
          <div className="space-y-5 p-4">
            {/* A. Identity */}
            <div className="surface-page-header rounded-2xl p-3.5">
              <div className="flex items-start gap-3">
                <InitialsAvatar
                  name={d.user.full_name || d.user.email || "?"}
                  className="h-11 w-11 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-lg font-extrabold">
                    {d.user.full_name || "—"}
                  </div>
                  <div dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                    {d.user.email ?? "—"}
                  </div>
                </div>
                <Badge variant={d.user.active ? "default" : "secondary"} className="shrink-0">
                  {d.user.active ? "פעיל" : "מושבת"}
                </Badge>
              </div>
              <div className="mt-2.5 space-y-1.5">
                <HealthBadge health={d.health} />
                {d.health.reasons.length > 0 && (
                  <ul className="list-disc space-y-0.5 pr-4 text-xs text-muted-foreground">
                    {d.health.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* B. Access & business identity */}
            <DrawerSection title="הרשאה וזהות עסקית" icon={ShieldCheck}>
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="הרשאת מערכת"
                  value={
                    d.user.roles.length
                      ? d.user.roles.map((r: AppRole) => roleLabel[r]).join(", ")
                      : "ללא"
                  }
                />
                <Stat
                  label="תפקיד עסקי בפועל"
                  value={
                    d.user.business_title ??
                    (d.user.roles.length
                      ? d.user.roles.map((r: AppRole) => roleLabel[r]).join(", ")
                      : "ללא")
                  }
                />
                <Stat label="צוות (שיוך פרופיל)" value={d.user.team_name ?? "—"} />
                <Stat
                  label="כניסה אחרונה"
                  value={
                    (d.user.last_login_at ?? d.user.auth_last_sign_in_at)
                      ? formatDateIL(d.user.last_login_at ?? d.user.auth_last_sign_in_at)
                      : "טרם התחבר"
                  }
                />
                <Stat label="נוצר בתאריך" value={formatDateIL(d.user.created_at)} />
              </div>
              <p className="text-xs text-muted-foreground">
                הרשאת המערכת קובעת מה מותר לעשות; התפקיד העסקי הוא תצוגה בלבד ונגזר מההיררכיה העסקית
                בעמוד הצוותים.
              </p>
            </DrawerSection>

            {/* C. Representative connection */}
            <DrawerSection title="קישור לנציג" icon={Link2}>
              {d.representative_link ? (
                <div className="rounded-xl border p-2.5 text-sm flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.representative_link.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {d.representative_link.team_name ?? "ללא צוות"}
                      {!d.representative_link.active ? " · מושבת" : ""}
                    </div>
                  </div>
                  {fallbackUser && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAction("unlink", fallbackUser)}
                    >
                      ניתוק
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground space-y-2">
                  <div>לא מקושר לנציג</div>
                  {fallbackUser && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAction("link", fallbackUser)}
                    >
                      <Link2 className="ms-1 h-4 w-4" />
                      קישור לנציג
                    </Button>
                  )}
                </div>
              )}
            </DrawerSection>

            {/* D. Management responsibility */}
            <DrawerSection title="אחריות ניהולית" icon={UsersRound}>
              {d.manages_teams.length > 0 ? (
                <div className="space-y-2">
                  <Label>מנהל הצוות של</Label>
                  <div className="text-sm">
                    {d.manages_teams.map((t: { name: string }) => t.name).join(", ")}
                  </div>
                </div>
              ) : d.user.roles?.includes("manager") && !d.user.roles?.includes("admin") ? (
                // The חן עטר state: role says manager, profile may even point at a
                // team, but no teams.manager_id names this user — so every manager
                // scope in the app resolves to nothing for them. Say it, and route
                // the fix through the explicit Teams-page action (never silent).
                <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <div className="text-sm font-semibold text-primary">
                    אינו מוגדר כמנהל של אף צוות
                  </div>
                  <p className="text-xs text-muted-foreground">
                    שיוך צוות בפרופיל אינו הופך משתמש למנהל הצוות. כדי שהמשתמש ינהל צוות בפועל יש
                    לבחור אותו כ"מנהל הצוות" בעריכת הצוות.
                  </p>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/teams">
                      <UsersRound className="ms-1 h-4 w-4" />
                      שיוך כמנהל צוות בעמוד הצוותים
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {d.user.roles?.includes("admin")
                    ? "מנהל מערכת — אחריות ניהולית על צוות אינה נדרשת."
                    : "אין אחריות ניהולית על צוות."}
                </p>
              )}
            </DrawerSection>

            {/* E. System footprint */}
            <DrawerSection title="רשומות בבעלות המשתמש" icon={Building2}>
              <div className="text-xs text-muted-foreground">
                {Object.entries(d.owned_records as Record<string, number>)
                  .filter(([, c]) => c > 0)
                  .map(([k, c]) => `${ownedRecordLabel[k] ?? k}: ${c}`)
                  .join(" · ") || "אין רשומות"}
              </div>
            </DrawerSection>

            {/* F. Actions — unchanged handlers and safeguards. */}
            {fallbackUser && (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button size="sm" variant="outline" onClick={() => onAction("edit", fallbackUser)}>
                  <Pencil className="ms-1 h-4 w-4" />
                  עריכה
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAction("changeTeam", fallbackUser)}
                >
                  <UsersRound className="ms-1 h-4 w-4" />
                  שינוי צוות
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAction("resetPassword", fallbackUser)}
                >
                  <KeyRound className="ms-1 h-4 w-4" />
                  איפוס סיסמה
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSelf}
                  onClick={() => onAction("toggleActive", fallbackUser)}
                >
                  {fallbackUser.active ? (
                    <UserX className="ms-1 h-4 w-4" />
                  ) : (
                    <UserCheck className="ms-1 h-4 w-4" />
                  )}
                  {fallbackUser.active ? "השבתה" : "הפעלה"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSelf}
                  className="text-destructive hover:text-destructive"
                  onClick={() => onAction("delete", fallbackUser)}
                >
                  <Trash2 className="ms-1 h-4 w-4" />
                  מחיקה
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
          {user.roles.includes("manager") && !user.roles.includes("admin") && (
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-2">
              <p className="text-xs">
                למשתמש בתפקיד מנהל צוות, שיוך הצוות כאן הוא <b>שיוך פרופיל בלבד</b> ואינו קובע מי מנהל
                את הצוות. כדי שהמשתמש ינהל צוות בפועל יש לבחור אותו כ"מנהל הצוות" בעריכת הצוות
                בעמוד הצוותים.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to="/teams">מעבר לעמוד הצוותים</Link>
              </Button>
            </div>
          )}
          <div className="space-y-1">
            <Label>
              {user.roles.includes("manager") && !user.roles.includes("admin")
                ? "צוות (שיוך פרופיל בלבד)"
                : "צוות"}
            </Label>
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
                  <div className="rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 p-3 text-sm text-warning-foreground flex items-center justify-between gap-3">
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
  // The visible "תפקיד" is a BUSINESS title; the technical role is derived
  // from it (all managerial titles → manager). The actual center/activity/
  // executive scope is assigned afterwards in the hierarchy card — no fake
  // title is stored, and the role enum is untouched.
  const [roleChoice, setRoleChoice] = useState("representative");
  const roleOption =
    CREATE_ROLE_OPTIONS.find((o) => o.value === roleChoice) ??
    CREATE_ROLE_OPTIONS[CREATE_ROLE_OPTIONS.length - 1];
  const role: AppRole = roleOption.role;
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
      // A managerial business title was chosen — the user exists as a plain
      // manager until the admin assigns the scope in the hierarchy card.
      if (roleOption.postCreateNotice) toast.info(roleOption.postCreateNotice, { duration: 10000 });
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
    setRoleChoice("representative"); setTeamId("none"); setManagerId("none"); setRepId("");
    setMustChange(true); setCreatedInfo(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="ms-1 h-4 w-4" />
          משתמש חדש
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>יצירת משתמש חדש</DialogTitle>
        </DialogHeader>
        {createdInfo ? (
          <CreatedUserPanel
            info={createdInfo}
            onClose={() => {
              setOpen(false);
              reset();
            }}
          />
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormGroupLabel>פרטי החשבון</FormGroupLabel>
              <div className="space-y-1 col-span-2">
                <Label>שם מלא *</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>אימייל *</Label>
                <Input
                  dir="ltr"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>סיסמה זמנית *</Label>
                <div className="flex gap-2">
                  <Input
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPassword(generateTempPassword())}
                  >
                    יצירה
                  </Button>
                </div>
              </div>
              {/* The visible "תפקיד" is a BUSINESS title; only the technical
                  permission it maps to is stored. The center/activity scope
                  itself is never assigned from here. */}
              <FormGroupLabel>הרשאה ותפקיד עסקי</FormGroupLabel>
              <div className="space-y-1">
                <Label>תפקיד *</Label>
                <Select value={roleChoice} onValueChange={setRoleChoice}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATE_ROLE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{CREATE_ROLE_HELPER_TEXT}</p>
              </div>
              <FormGroupLabel>שיוך ארגוני</FormGroupLabel>
              <div className="space-y-1">
                <Label>צוות</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">ללא</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {role === "manager" && (
                  <p className="text-xs text-muted-foreground">
                    שיוך פרופיל בלבד — הגדרת המשתמש כמנהל הצוות בפועל מתבצעת בעמוד הצוותים ("מנהל
                    הצוות").
                  </p>
                )}
              </div>
              {role !== "admin" && (
                <div className="space-y-1 col-span-2">
                  <Label>מנהל אחראי</Label>
                  <Select value={managerId} onValueChange={setManagerId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">ללא</SelectItem>
                      {managers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.full_name || m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {role === "representative" && (
                <div className="space-y-1 col-span-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    קישור לנציג
                  </div>
                  <Label>שיוך לפרופיל נציג *</Label>
                  {availableReps.length === 0 ? (
                    <div className="text-sm text-destructive">
                      לא קיימים פרופילי נציג במערכת. יש ליצור נציגים תחילה.
                    </div>
                  ) : (
                    <Select value={repId} onValueChange={setRepId}>
                      <SelectTrigger>
                        <SelectValue placeholder="בחר נציג" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableReps.map((r: any) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              <div className="col-span-2 flex items-center gap-2 pt-2">
                <Switch id="must-change" checked={mustChange} onCheckedChange={setMustChange} />
                <Label htmlFor="must-change" className="text-sm">
                  חייב להחליף סיסמה בכניסה הבאה
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending ? "יוצר..." : "יצירה"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A group heading inside the create/edit forms — grouping only. It changes no
 * field, no payload and no validation; it exists so the four different things
 * these forms configure (login details, technical permission + business title,
 * organizational assignment, representative link) stop reading as one flat
 * list of selects.
 */
function FormGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-2 mt-1 border-b pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
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
  const [email, setEmail] = useState(user.email ?? "");
  const [role, setRole] = useState<AppRole>(user.roles[0] ?? "representative");
  const [teamId, setTeamId] = useState<string>(user.team_id ?? "none");
  const [managerId, setManagerId] = useState<string>(user.manager_id ?? "none");
  const [repId, setRepId] = useState<string>(user.representative_link?.id ?? user.representative_id ?? "");
  const [mustChange, setMustChange] = useState(user.must_change_password);
  const { state } = useApp();
  const updateFn = useServerFn(updateUser);
  const updateEmailFn = useServerFn(updateUserEmail);

  // For a LINKED representative the responsible manager is DERIVED from the
  // rep's team (teams.manager_id) by the server-side rep-link sync — a manual
  // pick here would be silently overwritten in the same save. Show the derived
  // value read-only instead; changing it is done in /teams.
  const isLinkedRep = role === "representative" && !!user.representative_link;
  const linkedRep = isLinkedRep
    ? (state.reps ?? []).find((r) => r.id === (repId || user.representative_link?.id))
    : undefined;
  const linkedRepTeam = linkedRep?.teamId
    ? teams.find((t) => t.id === linkedRep.teamId)
    : undefined;
  const derivedManager = linkedRepTeam?.manager_id
    ? managers.find((m) => m.id === linkedRepTeam.manager_id)
    : undefined;
  const derivedManagerLabel = derivedManager
    ? derivedManager.full_name || derivedManager.email
    : "לא הוגדר מנהל צוות";

  const mut = useMutation({
    // The email correction runs FIRST (it also rewrites the Supabase Auth
    // login address) — if it is invalid or already taken, the edit fails
    // before any other field changes.
    mutationFn: async (vars: {
      update: Parameters<typeof updateFn>[0];
      newEmail: string | null;
    }) => {
      if (vars.newEmail) await updateEmailFn({ data: { user_id: user.id, email: vars.newEmail } });
      return updateFn(vars.update);
    },
    onSuccess: () => { toast.success("המשתמש עודכן"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (role === "representative" && !repId.trim()) return toast.error("יש לשייך נציג");
    if (!email.trim()) return toast.error("יש להזין כתובת אימייל");
    const emailChanged = email.trim().toLowerCase() !== (user.email ?? "").trim().toLowerCase();
    const roleChanged = role !== (user.roles[0] ?? null);
    mut.mutate({
      newEmail: emailChanged ? email.trim() : null,
      update: {
        data: {
          user_id: user.id,
          full_name: fullName,
          team_id: teamId === "none" ? null : teamId,
          // A linked representative's responsible manager is derived from the
          // rep's team manager (set in /teams) — never send a manual value.
          ...(isLinkedRep ? {} : { manager_id: managerId === "none" ? null : managerId }),
          representative_id: role === "representative" ? repId.trim() : null,
          must_change_password: mustChange,
          ...(roleChanged ? { role } : {}),
        },
      },
    });
  }

  const roleLocked = isSelf && user.roles.includes("admin"); // can't change own admin role
  const showLastAdminWarning = isLastActiveAdmin && role !== "admin";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>עריכת משתמש</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormGroupLabel>פרטי החשבון</FormGroupLabel>
            <div className="space-y-1 col-span-2">
              <Label>שם מלא</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>אימייל</Label>
              <Input
                dir="ltr"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                שינוי האימייל יעדכן גם את כתובת ההתחברות של המשתמש.
              </p>
            </div>
            <FormGroupLabel>הרשאה ותפקיד עסקי</FormGroupLabel>
            <div className="space-y-1">
              {/* The TECHNICAL permission level (admin/manager/representative)
                  — the business title below is a separate, derived concept, so
                  the manager option reads "מנהל", not "מנהל צוות". */}
              <Label>הרשאת מערכת</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as AppRole)}
                disabled={roleLocked}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">מנהל מערכת</SelectItem>
                  <SelectItem value="manager">מנהל</SelectItem>
                  <SelectItem value="representative">נציג</SelectItem>
                </SelectContent>
              </Select>
              {roleLocked && (
                <p className="text-xs text-muted-foreground">
                  לא ניתן לשנות את התפקיד של החשבון שלך.
                </p>
              )}
              {showLastAdminWarning && (
                <p className="text-xs text-destructive">
                  לא ניתן להסיר את התפקיד מהמנהל הפעיל האחרון.
                </p>
              )}
              {/* The EFFECTIVE business title comes from user_business_scopes
                  and is managed in the hierarchy card — never from here. */}
              {user.business_title && (
                <p className="text-xs text-muted-foreground">
                  תפקיד עסקי נוכחי: {user.business_title}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{EDIT_SCOPE_HELPER_TEXT}</p>
            </div>
            <FormGroupLabel>שיוך ארגוני</FormGroupLabel>
            <div className="space-y-1">
              <Label>צוות</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">ללא</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {role === "manager" && (
                <p className="text-xs text-muted-foreground">
                  שיוך פרופיל בלבד — הגדרת המשתמש כמנהל הצוות בפועל מתבצעת בעמוד הצוותים ("מנהל
                  הצוות").
                </p>
              )}
            </div>
            {role !== "admin" && isLinkedRep && (
              <div className="space-y-1 col-span-2">
                <Label>מנהל אחראי נגזר מצוות הנציג</Label>
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  {derivedManagerLabel}
                </div>
                <p className="text-xs text-muted-foreground">
                  לנציג מקושר, המנהל האחראי נקבע לפי מנהל הצוות של הנציג. שינוי מתבצע בעמוד הצוותים.
                </p>
              </div>
            )}
            {role !== "admin" && !isLinkedRep && (
              <div className="space-y-1 col-span-2">
                <Label>מנהל אחראי</Label>
                <Select value={managerId} onValueChange={setManagerId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">ללא</SelectItem>
                    {managers
                      .filter((m) => m.id !== user.id)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.full_name || m.email}
                        </SelectItem>
                      ))}
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
                    <SelectTrigger>
                      <SelectValue placeholder="בחר נציג" />
                    </SelectTrigger>
                    <SelectContent>
                      {(state.reps ?? []).map((r: any) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div className="col-span-2 flex items-center gap-2 pt-2">
              <Switch id="must-change-edit" checked={mustChange} onCheckedChange={setMustChange} />
              <Label htmlFor="must-change-edit" className="text-sm">
                חייב להחליף סיסמה בכניסה הבאה
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
            <Button type="submit" disabled={mut.isPending || showLastAdminWarning}>
              שמירה
            </Button>
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
