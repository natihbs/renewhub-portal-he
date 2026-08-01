import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Home, BarChart3, Trophy, BookOpen, Headphones, Settings, Menu, Search, Star, Upload, MessageSquare, LogOut, Users2, UsersRound, User as UserIcon, KeyRound, Info } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { useUx } from "@/lib/ux-store";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
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
import { WhatsNewDialog } from "@/components/WhatsNewDialog";
import { APP_NAME, APP_STAGE, APP_VERSION, BUILD_NUMBER, BUILD_DATE } from "@/lib/app-meta";


type NavItem = { to: string; label: string; icon: typeof Home; roles?: Array<"admin" | "manager" | "representative">; managerOnly?: boolean; adminOnly?: boolean };
const NAV: NavItem[] = [
  { to: "/", label: "דף הבית", icon: Home },
  { to: "/performance", label: "ביצועים", icon: BarChart3 },
  { to: "/competitions", label: "תחרויות", icon: Trophy },
  { to: "/knowledge", label: "מרכז ידע", icon: BookOpen },
  { to: "/feedback", label: "האזנות ומשוב", icon: Headphones },
  { to: "/data-import", label: "ייבוא נתונים", icon: Upload, managerOnly: true, roles: ["admin", "manager"] },
  { to: "/communications", label: "מרכז תקשורת", icon: MessageSquare, managerOnly: true, roles: ["admin", "manager"] },
  { to: "/teams", label: "ניהול צוותים", icon: UsersRound, managerOnly: true, roles: ["admin", "manager"] },
  { to: "/representatives", label: "ניהול נציגים", icon: Users2, managerOnly: true, roles: ["admin", "manager"] },
  { to: "/users", label: "ניהול משתמשים", icon: Users2, managerOnly: true, adminOnly: true, roles: ["admin"] },
  { to: "/admin", label: "ניהול המערכת", icon: Settings, managerOnly: true, adminOnly: true, roles: ["admin"] },
];


function NavRow({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  const { isFavorite, toggleFavorite } = useUx();
  const Icon = item.icon;
  const pinned = isFavorite(item.to);
  return (
    <div className="group relative">
      <Link
        to={item.to as string}
        onClick={onClick}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-xl pe-12 ps-3 py-2.5 text-sm font-medium transition-colors sm:pe-9",
          active
            ? "bg-primary text-primary-foreground shadow-soft"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(item.to); }}
        className={cn(
          "absolute end-1 top-1/2 -translate-y-1/2 grid h-11 w-11 place-items-center rounded-md transition-opacity sm:end-2 sm:h-6 sm:w-6",
          pinned ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
          active ? "text-primary-foreground/80 hover:text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        aria-label={pinned ? `הסרת ${item.label} מהמועדפים` : `הוספת ${item.label} למועדפים`}
      >
        <Star className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
      </button>

    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { state } = useApp();
  const { favorites } = useUx();
  const { isDemo } = useAppMode();
  const { roles } = useAuth();
  // Demo mode falls back to the local role state; Live mode uses real roles from the DB.
  const canManage = isDemo ? state.role === "manager" : (roles.includes("admin") || roles.includes("manager"));
  const canAdmin = isDemo ? state.role === "manager" : roles.includes("admin");
  const visible = NAV.filter((n) => {
    if (n.adminOnly) return canAdmin;
    if (n.managerOnly) return canManage;
    return true;
  });
  const pinned = visible.filter((n) => favorites.includes(n.to));

  return (
    <nav className="flex flex-col gap-1 p-3">
      {pinned.length > 0 && (
        <>
          <div className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Star className="h-3 w-3 fill-current text-primary" />
            מועדפים
          </div>
          {pinned.map((n) => (
            <NavRow key={`fav-${n.to}`} item={n} active={pathname === n.to} onClick={onNavigate} />
          ))}
          <div className="my-2 border-t" />
        </>
      )}
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ניווט</div>
      {visible.map((n) => (
        <NavRow key={n.to} item={n} active={pathname === n.to} onClick={onNavigate} />
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-5 py-5 border-b">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground font-bold shadow-soft">
        R
      </div>
      <div className="min-w-0">
        <div className="font-extrabold text-base leading-tight">RenewHub</div>
        <div className="text-xs text-muted-foreground">פורטל חידושים פנימי</div>
      </div>
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
        <SelectTrigger className="h-9 w-28" aria-label="החלפת תפקיד (הדגמה בלבד)">
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

function AboutContentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>אודות {APP_NAME}</DialogTitle>
          <DialogDescription>פורטל חידושים פנימי לצוותי חידושי רכב ודירה.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <span className="text-muted-foreground">שלב</span><span className="font-medium">{APP_STAGE}</span>
          <span className="text-muted-foreground">גרסה</span><span className="font-mono">{APP_VERSION}</span>
          <span className="text-muted-foreground">מספר בילד</span><span className="font-mono">{BUILD_NUMBER}</span>
          <span className="text-muted-foreground">תאריך בילד</span><span className="font-mono">{BUILD_DATE}</span>
        </div>
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
            אודות RenewHub
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
      <AboutContentDialog open={aboutOpen} onOpenChange={setAboutOpen} />
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

const PAGE_TITLES: Record<string, string> = {
  "/": "דף הבית",
  "/performance": "ביצועים",
  "/competitions": "תחרויות",
  "/knowledge": "מרכז ידע",
  "/feedback": "האזנות ומשוב",
  "/data-import": "ייבוא נתונים",
  "/communications": "מרכז תקשורת",
  "/users": "ניהול משתמשים",
  "/admin": "ניהול המערכת",
  "/changelog": "יומן שינויים",
};

/** Bottom navigation shown instead of the sidebar on phones and small tablets. */
function BottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { state } = useApp();
  const { isDemo } = useAppMode();
  const { roles } = useAuth();
  const canManage = isDemo ? state.role === "manager" : (roles.includes("admin") || roles.includes("manager"));
  const canAdmin = isDemo ? state.role === "manager" : roles.includes("admin");
  const visible = NAV.filter((n) => (n.adminOnly ? canAdmin : n.managerOnly ? canManage : true));
  const primary = visible.slice(0, 4);

  return (
    <nav
      aria-label="ניווט ראשי"
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-5">
        {primary.map((n) => {
          const Icon = n.icon;
          const active = pathname === n.to;
          return (
            <li key={n.to}>
              <Link
                to={n.to as string}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0", active && "stroke-[2.4]")} />
                <span className="w-full truncate text-center leading-none">{n.label}</span>
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
  if (BARE_ROUTES.includes(pathname)) {
    return <div className="min-h-dvh bg-background">{children}</div>;
  }

  const pageTitle = PAGE_TITLES[pathname] ?? "RenewHub";

  return (
    <div className="min-h-dvh flex bg-background">
      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground">
        <Brand />
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
              <SheetContent side="right" className="p-0 sm:w-80 sm:max-w-[85vw]">
                <SheetTitle className="sr-only">תפריט ניווט</SheetTitle>
                <Brand />
                <div className="px-3 pt-3 lg:hidden">
                  <ModeToggle />
                </div>
                <NavList onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            {/* Current page title: the only wayfinding cue once the sidebar is gone. */}
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
            <div className="hidden lg:block">
              <ModeToggle />
            </div>
            <div className="hidden md:block">
              <AboutDialog trigger={<Button variant="ghost" size="icon" aria-label="אודות"><span className="text-xs font-mono">i</span></Button>} />
            </div>
            <NotificationBell />
            <RoleSwitcher />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 p-4 pb-24 md:p-6 lg:p-8 lg:pb-8 min-w-0">{children}</main>
      </div>

      <BottomNav onOpenMenu={() => setOpen(true)} />
      <CommandPalette open={cmd.open} onOpenChange={cmd.setOpen} />
      <WhatsNewDialog />
    </div>
  );
}


