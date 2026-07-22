import { Link, useRouterState } from "@tanstack/react-router";
import { Home, BarChart3, Trophy, BookOpen, Headphones, Settings, Menu, Search, Star, Upload, MessageSquare, LogOut, UserCircle2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import { useUx } from "@/lib/ux-store";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
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
import { cn } from "@/lib/utils";
import { CommandPalette, useCommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { ModeToggle } from "@/components/ModeToggle";
import { AboutDialog } from "@/components/AboutDialog";
import { WhatsNewDialog } from "@/components/WhatsNewDialog";


type NavItem = { to: string; label: string; icon: typeof Home; roles?: Array<"admin" | "manager" | "representative">; managerOnly?: boolean; adminOnly?: boolean };
const NAV: NavItem[] = [
  { to: "/", label: "דף הבית", icon: Home },
  { to: "/performance", label: "ביצועים", icon: BarChart3 },
  { to: "/competitions", label: "תחרויות", icon: Trophy },
  { to: "/knowledge", label: "מרכז ידע", icon: BookOpen },
  { to: "/feedback", label: "האזנות ומשוב", icon: Headphones },
  { to: "/data-import", label: "ייבוא נתונים", icon: Upload, managerOnly: true, roles: ["admin", "manager"] },
  { to: "/communications", label: "מרכז תקשורת", icon: MessageSquare, managerOnly: true, roles: ["admin", "manager"] },
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
          "flex items-center gap-3 rounded-xl pe-9 ps-3 py-2.5 text-sm font-medium transition-colors",
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
          "absolute end-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-md transition-opacity",
          pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          active ? "text-primary-foreground/80 hover:text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        aria-label={pinned ? "הסרה מהמועדפים" : "הוספה למועדפים"}
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

function UserMenu() {
  const { user, profile, roles, signOut, loading } = useAuth();
  const { isDemo } = useAppMode();
  if (isDemo || !user) return null;
  const label = profile?.full_name || user.email || "משתמש";
  const roleLabel = roles.includes("admin") ? "מנהל מערכת" : roles.includes("manager") ? "מנהל" : roles.includes("representative") ? "נציג" : "ללא תפקיד";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-2" disabled={loading}>
          <UserCircle2 className="h-5 w-5" />
          <span className="hidden md:inline max-w-32 truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{label}</span>
          <span className="text-xs font-normal text-muted-foreground">{roleLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4 me-2" />
          התנתקות
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const cmd = useCommandPalette();

  return (
    <div className="min-h-dvh flex bg-background">
      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground">
        <Brand />
        <NavList />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 sticky top-0 z-30 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 md:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden shrink-0">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="p-0 w-72">
                <SheetTitle className="sr-only">תפריט</SheetTitle>
                <Brand />
                <NavList onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="lg:hidden font-bold truncate">RenewHub</div>
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

          <div className="flex items-center gap-2 shrink-0">
            <ModeToggle />
            <AboutDialog trigger={<Button variant="ghost" size="icon" aria-label="אודות"><span className="text-xs font-mono">i</span></Button>} />
            <NotificationBell />
            <RoleSwitcher />
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 min-w-0">{children}</main>
      </div>

      <CommandPalette open={cmd.open} onOpenChange={cmd.setOpen} />
      <WhatsNewDialog />
    </div>
  );
}

