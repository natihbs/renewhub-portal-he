import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Menu, Search, Star, LogOut, User as UserIcon, KeyRound, Info, UsersRound, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { useUx } from "@/lib/ux-store";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import { supabase } from "@/integrations/supabase/client";
import {
  type AppRole, navItemsByGroup, navLabel, type NavItem, NAV_ITEMS,
} from "@/lib/navigation-config";
import { useResolvedRole } from "@/lib/use-resolved-role";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CommandPalette, useCommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { ModeToggle } from "@/components/ModeToggle";
import { AboutDialog } from "@/components/AboutDialog";
import { CloudRepsSync } from "@/components/CloudRepsSync";
import { PulseLogo } from "@/components/PulseLogo";
import { APP_NAME } from "@/lib/app-meta";


function NavRow({ item, label, active, onClick }: { item: NavItem; label: string; active: boolean; onClick?: () => void }) {
  const { isFavorite, toggleFavorite } = useUx();
  const Icon = item.icon;
  const pinned = isFavorite(item.to);
  return (
    <div className="group relative">
      <Link
        to={item.to}
        onClick={onClick}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-xl pe-12 ps-[9px] py-2.5 text-sm font-medium transition-colors sm:pe-9 border-s-[3px]",
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-soft border-s-brand-accent"
            : "border-s-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(item.to); }}
        className={cn(
          "absolute end-1 top-1/2 -translate-y-1/2 grid h-11 w-11 place-items-center rounded-md transition-opacity sm:end-2 sm:h-6 sm:w-6",
          pinned ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
          active
            ? "text-sidebar-primary-foreground/80 hover:text-sidebar-primary-foreground"
            : "text-sidebar-foreground/55 hover:text-sidebar-foreground"
        )}
        aria-label={pinned ? `הסרת ${label} מהמועדפים` : `הוספת ${label} למועדפים`}
      >
        <Star className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
      </button>

    </div>
  );
}

const GROUP_TITLE: Record<AppRole, string> = {
  admin: "ניהול ארגוני",
  manager: "ניהול הצוות",
  representative: "ניווט",
};

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { favorites } = useUx();
  const role = useResolvedRole();
  const { primary, management } = navItemsByGroup(role);
  const all = [...primary, ...management];
  const pinned = all.filter((n) => favorites.includes(n.to));

  return (
    <nav className="flex flex-col gap-1 p-3">
      {pinned.length > 0 && (
        <>
          <div className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/60 flex items-center gap-1.5">
            <Star className="h-3 w-3 fill-current text-brand-accent" />
            מועדפים
          </div>
          {pinned.map((n) => (
            <NavRow key={`fav-${n.to}`} item={n} label={navLabel(n, role)} active={pathname === n.to} onClick={onNavigate} />
          ))}
          <div className="my-2 border-t border-sidebar-border" />
        </>
      )}
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/60">
        {role === "representative" ? GROUP_TITLE.representative : "עבודה יומית"}
      </div>
      {primary.map((n) => (
        <NavRow key={n.to} item={n} label={navLabel(n, role)} active={pathname === n.to} onClick={onNavigate} />
      ))}
      {management.length > 0 && (
        <>
          <div className="mt-2 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/60">
            {GROUP_TITLE[role]}
          </div>
          {management.map((n) => (
            <NavRow key={n.to} item={n} label={navLabel(n, role)} active={pathname === n.to} onClick={onNavigate} />
          ))}
        </>
      )}
    </nav>
  );
}

// A representative is not managing a sales team — "מערכת לניהול צוותי
// מכירות" (a sales-team-management system) misrepresents their own
// experience, so it's shown only to the roles it's actually true for.
const BRAND_SUBTITLE: Partial<Record<AppRole, string>> = {
  admin: "מערכת לניהול צוותי מכירות",
  manager: "מערכת לניהול צוותי מכירות",
};

function Brand({ onDark = false }: { onDark?: boolean }) {
  const role = useResolvedRole();
  const subtitle = BRAND_SUBTITLE[role];
  return (
    <div className={cn("flex flex-col gap-1.5 px-5 py-5 border-b", onDark ? "border-sidebar-border" : "")}>
      <PulseLogo variant={onDark ? "light" : "dark"} className="h-8" />
      {subtitle && (
        <div className={cn("text-xs", onDark ? "text-sidebar-foreground/65" : "text-muted-foreground")}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function RoleSwitcher() {
  const { state, setRole, setCurrentRep } = useApp();
  const { isDemo } = useAppMode();
  const reps = state.reps;
  // Demo-only. Never render the role switcher in Live Mode.
  if (!isDemo) return null;
  return (
    <div className="flex items-center gap-2">
      <Select value={state.role} onValueChange={(v) => setRole(v as "manager" | "rep")}>
        <SelectTrigger className="h-9 w-28" aria-label="החלפת תפקיד (למפתחים בלבד)">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manager">מנהל</SelectItem>
          <SelectItem value="rep">נציג</SelectItem>
        </SelectContent>
      </Select>
      {state.role === "rep" && (
        <Select value={state.currentRepId} onValueChange={setCurrentRep}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {reps.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/**
 * The single, global scope every workspace-aware page reads instead of
 * maintaining its own local team filter (see useWorkspace). Renders nothing
 * for a representative (no scope concept) and nothing once there's only one
 * possible workspace — a locked single-team manager sees a static label
 * instead of a dropdown with one dead option ("no redundant selectors").
 */
function WorkspaceSwitcher() {
  const { isDemo } = useAppMode();
  const { workspace, options, setWorkspaceTeam, setWorkspaceOrg, ready } = useWorkspace();
  if (isDemo || !ready || options.length === 0) return null;

  if (options.length === 1) {
    const only = options[0];
    return (
      <span
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-2.5 sm:px-3 text-xs font-medium text-muted-foreground"
        title={only.type === "team" && !only.active ? "סביבת העבודה שלך נעולה לצוות זה — הצוות מושבת, הנתונים וההיסטוריה שלו עדיין זמינים" : "סביבת העבודה שלך נעולה לצוות זה"}
      >
        <UsersRound className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-24 truncate sm:max-w-none">{only.label}</span>
        {only.type === "team" && !only.active && <Badge variant="secondary" className="px-1 py-0 text-[10px]">מושבת</Badge>}
      </span>
    );
  }

  const value = workspace.type === "org" ? "org" : workspace.teamId;
  return (
    <Select value={value} onValueChange={(v) => (v === "org" ? setWorkspaceOrg() : setWorkspaceTeam(v))}>
      <SelectTrigger className="h-9 w-40 sm:w-52" aria-label="בחירת סביבת עבודה">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.type === "org" ? "org" : o.teamId} value={o.type === "org" ? "org" : o.teamId}>
            <span className="inline-flex items-center gap-1.5">
              {o.label}
              {o.type === "team" && !o.active && <Badge variant="secondary" className="px-1 py-0 text-[10px]">מושבת</Badge>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user, profile, roles } = useAuth();
  const roleLabel = roles.includes("admin") ? "מנהל מערכת" : roles.includes("manager") ? "מנהל" : roles.includes("representative") ? "נציג" : "ללא תפקיד";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>הפרופיל שלי</DialogTitle>
          <DialogDescription>פרטי החשבון המחובר</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 pb-2">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
              {initialsOf(profile?.full_name, user?.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-semibold truncate">{profile?.full_name || "—"}</div>
            <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm border-t pt-3">
          <span className="text-muted-foreground">תפקיד</span>
          <span className="font-medium">{roleLabel}</span>
          <span className="text-muted-foreground">סטטוס</span>
          <span className="font-medium">{profile?.active === false ? "לא פעיל" : "פעיל"}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>הגדרות</DialogTitle>
          <DialogDescription>מסך ההגדרות האישיות יהיה זמין בקרוב.</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">בגרסה הבאה: העדפות תצוגה, שפה, התראות ואינטגרציות אישיות.</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>סגירה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserMenu() {
  const { user, profile, roles, loading } = useAuth();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  if (!user) return null;
  const name = profile?.full_name || user.email || "משתמש";
  const roleLabel = roles.includes("admin") ? "מנהל מערכת" : roles.includes("manager") ? "מנהל" : roles.includes("representative") ? "נציג" : "ללא תפקיד";
  const initials = initialsOf(profile?.full_name, user.email);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
      toast.success("התנתקת בהצלחה");
      await navigate({ to: "/auth" });
    } catch {
      toast.error("שגיאה בהתנתקות. נסה שוב.");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={loading}
            aria-label="תפריט משתמש"
            className="flex items-center gap-2 min-h-11 rounded-full ps-1 pe-2 md:pe-3 hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:flex flex-col items-end leading-tight min-w-0">
              <span className="text-sm font-medium truncate max-w-32">{name}</span>
              <span className="text-[11px] text-muted-foreground truncate max-w-32">{roleLabel}</span>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex items-center gap-3 py-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0">
              <span className="truncate font-semibold">{name}</span>
              <span className="text-xs font-normal text-muted-foreground truncate">{roleLabel}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserIcon className="h-4 w-4 me-2" />
            הפרופיל שלי
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void navigate({ to: "/reset-password" })}>
            <KeyRound className="h-4 w-4 me-2" />
            החלפת סיסמה
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4 me-2" />
            הגדרות
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAboutOpen(true)}>
            <Info className="h-4 w-4 me-2" />
            אודות {APP_NAME}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void handleSignOut()} className="text-destructive focus:text-destructive">
            <LogOut className="h-4 w-4 me-2" />
            התנתק
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  );
}

function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden md:flex items-center gap-2 h-9 min-w-56 max-w-80 flex-1 rounded-lg border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      aria-label="חיפוש גלובלי"
    >
      <Search className="h-4 w-4" />
      <span>חיפוש נציגים, מאמרים, פקודות...</span>
      <kbd className="ms-auto rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono font-semibold text-muted-foreground">Ctrl K</kbd>
    </button>
  );
}

const BARE_ROUTES = ["/auth", "/reset-password", "/access-denied"];

/** Routes with no entry in navigation-config.ts (not part of any role's nav). */
const EXTRA_PAGE_TITLES: Record<string, string> = {
  "/changelog": "יומן שינויים",
};

/** Bottom navigation shown instead of the sidebar on phones and small tablets. */
function BottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const role = useResolvedRole();
  const { primary, management } = navItemsByGroup(role);
  const visible = [...primary, ...management].slice(0, 4);

  return (
    <nav
      aria-label="ניווט ראשי"
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-5">
        {visible.map((n) => {
          const Icon = n.icon;
          const active = pathname === n.to;
          return (
            <li key={n.to}>
              <Link
                to={n.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0", active && "stroke-[2.4]")} />
                <span className="w-full truncate text-center leading-none">{navLabel(n, role)}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="פתיחת תפריט מלא"
            className="flex w-full min-h-14 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Menu className="h-5 w-5 shrink-0" />
            <span className="leading-none">עוד</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const cmd = useCommandPalette();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const role = useResolvedRole();
  if (BARE_ROUTES.includes(pathname)) {
    return <div className="min-h-dvh bg-background">{children}</div>;
  }

  const navItem = NAV_ITEMS.find((n) => n.to === pathname);
  const pageTitle = navItem ? navLabel(navItem, role) : (EXTRA_PAGE_TITLES[pathname] ?? APP_NAME);

  return (
    <div className="min-h-dvh flex bg-background">
      <CloudRepsSync />
      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground">
        <Brand onDark />
        <NavList />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="min-h-14 lg:h-16 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 sticky top-0 z-30 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 pt-safe sm:gap-3 sm:px-4 md:px-6">
          <div className="flex items-center gap-2 min-w-0">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden shrink-0" aria-label="פתיחת תפריט הניווט">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="p-0 sm:w-80 sm:max-w-[85vw] bg-sidebar text-sidebar-foreground">
                <SheetTitle className="sr-only">תפריט ניווט</SheetTitle>
                <Brand onDark />
                {import.meta.env.DEV && (
                  <div className="px-3 pt-3 lg:hidden">
                    <ModeToggle />
                  </div>
                )}
                <NavList onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            {/* Current page title: the only wayfinding cue once the sidebar is gone. */}
            <PulseLogo variant="symbol" className="h-6 lg:hidden" />
            <h2 className="lg:hidden truncate text-base font-bold">{pageTitle}</h2>
          </div>

          <div className="flex justify-center md:justify-start">
            <SearchTrigger onClick={() => cmd.setOpen(true)} />
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0"
              aria-label="חיפוש"
              onClick={() => cmd.setOpen(true)}
            >
              <Search className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex items-center gap-1 shrink-0 sm:gap-2">
            {import.meta.env.DEV && (
              <div className="hidden lg:block">
                <ModeToggle />
              </div>
            )}
            <div className="hidden md:block">
              <AboutDialog trigger={<Button variant="ghost" size="icon" aria-label="אודות"><span className="text-xs font-mono">i</span></Button>} />
            </div>
            <NotificationBell />
            <WorkspaceSwitcher />
            <RoleSwitcher />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 p-4 pb-24 md:p-6 lg:p-8 lg:pb-8 min-w-0">{children}</main>
      </div>

      <BottomNav onOpenMenu={() => setOpen(true)} />
      <CommandPalette open={cmd.open} onOpenChange={cmd.setOpen} />
    </div>
  );
}


