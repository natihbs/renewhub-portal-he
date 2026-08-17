import type { LucideIcon } from "lucide-react";
import { isScopedManagerKind } from "@/lib/scope-home";
import {
  Home, BarChart3, Trophy, BookOpen, Headphones, Settings, Upload, MessageSquare,
  Users2, UsersRound, Target, Sparkles, FileText,
} from "lucide-react";

// Single source of truth for role-aware navigation. AppShell (sidebar +
// bottom nav) and CommandPalette both render from this module — neither
// keeps its own copy of "which routes exist / who can see them." AppShell
// is a rendering component, not a source of navigation truth.

export type AppRole = "admin" | "manager" | "representative";

/**
 * Single place that turns the app's actual role signals into one AppRole for
 * navigation/framing purposes. Demo Mode only ever has a local "manager" /
 * "rep" switch with no separate admin concept — preserving the app's
 * existing behavior, a demo "manager" resolves to "admin" here (the
 * superset of nav a demo manager could already reach before this module
 * existed), and demo "rep" resolves to "representative". Live Mode always
 * uses the signed-in user's real Supabase roles, never the demo switcher.
 */
export function resolveAppRole(params: {
  isDemo: boolean;
  demoRole: "manager" | "rep";
  isAdmin: boolean;
  isManager: boolean;
}): AppRole {
  if (params.isDemo) return params.demoRole === "manager" ? "admin" : "representative";
  if (params.isAdmin) return "admin";
  if (params.isManager) return "manager";
  return "representative";
}

export type NavGroup = "primary" | "management";

export type NavItem = {
  /** Stable key, independent of route path or label. */
  id: string;
  to: string;
  icon: LucideIcon;
  /** Roles that see this item at all. */
  roles: AppRole[];
  /** Default label, used unless overridden per role below. */
  label: string;
  /** Per-role label override — e.g. a representative sees "הביצועים שלי" where a manager sees "ביצועים". */
  roleLabel?: Partial<Record<AppRole, string>>;
  /** Rendering hint for sidebar grouping. Representatives never see enough items to need grouping. */
  group: NavGroup;
};

export type QuickAction = {
  id: string;
  to: string;
  icon: LucideIcon;
  roles: AppRole[];
  label: string;
  roleLabel?: Partial<Record<AppRole, string>>;
};

/**
 * Every route in the app, with who can see it and what it's called for them.
 * Ordering here is the ordering rendered in both the sidebar and the command
 * palette's navigation group.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "home", to: "/", icon: Home, roles: ["admin", "manager", "representative"], label: "דף הבית", group: "primary" },
  {
    // Not offered to admin: this page is business-performance AI (performance,
    // feedback and goal insights), and admin is a system administrator, not a
    // business owner. The route itself has no role guard, so an admin can still
    // reach /ai-insights directly for support/QA — only the nav entry is scoped.
    id: "ai-insights", to: "/ai-insights", icon: Sparkles, roles: ["manager", "representative"],
    label: "תובנות AI", group: "primary",
  },
  {
    id: "performance", to: "/performance", icon: BarChart3, roles: ["manager", "representative"],
    label: "ביצועים", roleLabel: { representative: "הביצועים שלי" }, group: "primary",
  },
  {
    id: "targets", to: "/targets", icon: Target, roles: ["manager", "representative"],
    label: "יעדים", roleLabel: { representative: "היעד שלי" }, group: "primary",
  },
  {
    id: "feedback", to: "/feedback", icon: Headphones, roles: ["manager", "representative"],
    label: "האזנות ומשוב", roleLabel: { representative: "המשוב שלי" }, group: "primary",
  },
  { id: "competitions", to: "/competitions", icon: Trophy, roles: ["manager", "representative"], label: "תחרויות", group: "primary" },
  { id: "knowledge", to: "/knowledge", icon: BookOpen, roles: ["manager", "representative"], label: "מרכז ידע", group: "primary" },

  { id: "representatives", to: "/representatives", icon: Users2, roles: ["admin", "manager"], label: "ניהול נציגים", group: "management" },
  { id: "communications", to: "/communications", icon: MessageSquare, roles: ["manager"], label: "מרכז תקשורת", group: "management" },
  {
    id: "teams", to: "/teams", icon: UsersRound, roles: ["admin", "manager"], label: "ניהול צוותים",
    // A manager only ever sees their own team(s) here (RLS-scoped read on
    // teams; getTeamDetails re-checks per team_id too) and the page itself
    // renders every write control read-only for them (canManage === isAdmin
    // server-side) — so this is a real, safe destination for a manager, not
    // just a label change. "Their own team" per the correction, not the
    // generic admin label.
    roleLabel: { manager: "הצוות שלי" }, group: "management",
  },
  { id: "users", to: "/users", icon: Users2, roles: ["admin"], label: "ניהול משתמשים", group: "management" },
  {
    id: "data-import", to: "/data-import", icon: Upload, roles: ["admin", "manager"], label: "ייבוא נתונים",
    // The route (requireRole(["admin","manager"])) and every server function
    // it calls already allow a manager — hiding the nav entry while still
    // allowing the route was the bug; a manager relying on nav-only
    // discovery must be able to reach a page they're actually authorized to
    // use.
    group: "management",
  },
  { id: "admin", to: "/admin", icon: Settings, roles: ["admin"], label: "ניהול המערכת", group: "management" },
  { id: "changelog", to: "/changelog", icon: FileText, roles: ["admin"], label: "יומן שינויים", group: "management" },
];

/** Nav items visible to this role, in display order. */
export function navItemsForRole(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function navLabel(item: NavItem, role: AppRole): string {
  return item.roleLabel?.[role] ?? item.label;
}

export function navItemsByGroup(role: AppRole): { primary: NavItem[]; management: NavItem[] } {
  const items = navItemsForRole(role);
  return {
    primary: items.filter((i) => i.group === "primary"),
    management: items.filter((i) => i.group === "management"),
  };
}

/**
 * CommandPalette's "quick actions" — deliberately narrower than "every nav
 * item," and deliberately role-scoped: a representative sees none of these
 * (there is nothing here for them to do), a manager sees only actions that
 * make sense for the team(s) they manage, an admin sees everything.
 */
export const QUICK_ACTIONS: QuickAction[] = [
  { id: "add-representative", to: "/representatives", icon: Users2, roles: ["admin", "manager"], label: "הוספת נציג" },
  { id: "manage-targets", to: "/targets", icon: Target, roles: ["manager"], label: "עדכון יעדים" },
  { id: "add-feedback", to: "/feedback", icon: Headphones, roles: ["manager"], label: "הוספת האזנה / משוב" },
  { id: "create-competition", to: "/competitions", icon: Trophy, roles: ["manager"], label: "יצירת תחרות" },
  { id: "open-knowledge", to: "/knowledge", icon: BookOpen, roles: ["manager", "representative"], label: "פתיחת מרכז הידע" },
  { id: "add-announcement", to: "/admin", icon: MessageSquare, roles: ["admin"], label: "הוספת הודעה" },
  { id: "import-data", to: "/data-import", icon: Upload, roles: ["admin", "manager"], label: "ייבוא נתונים" },
];

export function quickActionsForRole(role: AppRole): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => a.roles.includes(role));
}

export function quickActionLabel(action: QuickAction, role: AppRole): string {
  return action.roleLabel?.[role] ?? action.label;
}

// ============================================================================
// Admin business-view switcher — presentation only.
//
// Admin is a system administrator ("מנהל מערכת"). Their default navigation is
// system-only (see the roles arrays above), but for support/QA they can put
// the UI into another role's presentation. This is NOT impersonation: the
// signed-in user, their auth session, their RLS context and every permission
// check stay exactly what they were. Only which navigation/home/labels render
// changes. A non-admin's role is never overridden.
// ============================================================================

/** Presentation mode an admin can select. "admin" is the default (own view). */
export type AdminViewMode = AppRole;

/**
 * The options offered by the switcher, in display order. Future presentation
 * modes (e.g. מנהל מוקד, מנהל פעילות, סמנכ״ל / מנהל ממ״ט) are added here once
 * those roles have their own navigation/home to present.
 */
export const ADMIN_VIEW_OPTIONS: { value: AdminViewMode; label: string }[] = [
  { value: "admin", label: "מנהל מערכת" },
  { value: "manager", label: "מנהל צוות" },
  { value: "representative", label: "נציג" },
];

/** Banner text per non-default view mode — says permissions are unchanged. */
export const ADMIN_VIEW_BANNER: Partial<Record<AdminViewMode, string>> = {
  manager: "מצב צפייה כמנהל צוות · הרשאות מנהל מערכת נשמרות",
  representative: "מצב צפייה כנציג · הרשאות מנהל מערכת נשמרות",
};

/**
 * The single rule that turns a real role + a selected view mode into the role
 * whose PRESENTATION renders. Only a real admin can be overlaid; for everyone
 * else the view mode is inert, whatever it claims to be.
 */
export function applyAdminView(realRole: AppRole, viewMode: AdminViewMode): AppRole {
  if (realRole !== "admin") return realRole;
  return viewMode;
}

/**
 * How the top-bar workspace selector should behave for a given real role,
 * view mode, route and resolved business scope. One pure rule so the
 * switcher and its tests cannot drift apart.
 *
 * - "existing":  render exactly as before this rule existed. This is the
 *   answer for every non-admin except the one case below — a real team
 *   manager's or representative's selector behavior never changes.
 * - "hidden":    the selector is meaningless here, render nothing. Admin's
 *   system console ("/") ignores workspace entirely — a visible selector
 *   would imply the page changes by team when it does not. Representative
 *   view has no scope concept at all (a real representative never has a
 *   selector), so admin-as-representative hides it too. And a business-scope
 *   manager's HOME (center / activity / executive) is the complete resolved
 *   scope — its hero says "כלל הפעילות העסקית" and its boards show every
 *   covered unit, so a selector naming one team would caption a scope-wide
 *   page with a single-team scope. Hidden is presentation only: the
 *   workspace still holds the drill-down selected team, and every
 *   operational route (/performance, /targets, /teams, …) keeps the
 *   selector exactly as it is.
 * - "teams-only": admin-as-manager. A manager inspects one team; "כלל
 *   הארגון" is not a scope any real manager has, and offering it would
 *   render a fake manager view. Only team options are offered.
 *
 * `businessScopeKind` is the SERVER-resolved scope of the REAL account
 * (useBusinessScope), consulted only on the non-admin branch — an admin in a
 * presentation view mode keeps realRole "admin" and never reaches it, so a
 * view mode can never borrow a business scope it does not hold.
 *
 * Admin's OTHER system pages (e.g. /users, /representatives) keep the full
 * selector — those pages genuinely narrow by workspace and that narrowing is
 * a real filter, not an implication.
 */
export type WorkspaceSelectorBehavior = "existing" | "hidden" | "teams-only";

export function workspaceSelectorBehavior(params: {
  realRole: AppRole;
  viewRole: AppRole;
  pathname: string;
  /** Resolved business-scope kind of the real account, when known. */
  businessScopeKind?: string | null;
}): WorkspaceSelectorBehavior {
  const { realRole, viewRole, pathname, businessScopeKind } = params;
  if (realRole !== "admin") {
    return pathname === "/" && isScopedManagerKind(businessScopeKind) ? "hidden" : "existing";
  }
  if (viewRole === "representative") return "hidden";
  if (viewRole === "manager") return "teams-only";
  return pathname === "/" ? "hidden" : "existing";
}
