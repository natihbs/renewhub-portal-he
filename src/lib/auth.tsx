import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "admin" | "manager" | "representative";

// Deliberately does NOT include representative_id: that column is a legacy,
// display-only field (see resolveBusinessIdentifier in team-admin.functions.ts)
// that the real admin linking path (linkRepresentativeToUserCore) never writes,
// so it must never be used to resolve "who is the current representative" —
// see store.tsx's currentRepId resolution for the authoritative source.
type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  manager_id: string | null;
  team_id: string | null;
  active: boolean;
};

export type AuthDataResult =
  | { kind: "ok"; profile: Profile | null; roles: AppRole[] }
  | { kind: "error"; message: string };

/**
 * Interprets the RETURNED Supabase responses. An error in either response is a
 * recoverable load failure — never "this user has no role".
 */
export function resolveAuthData(
  profRes: { data: unknown; error: unknown },
  rolesRes: { data: unknown; error: unknown },
): AuthDataResult {
  if (profRes.error || rolesRes.error) return { kind: "error", message: "טעינת נתוני המשתמש נכשלה" };
  const roles = ((rolesRes.data ?? []) as { role: AppRole }[]).map((r) => r.role);
  return { kind: "ok", profile: (profRes.data as Profile) ?? null, roles };
}

/** A response may be applied only when it is the newest one for the current identity. */
export function isCurrentAuthResponse(args: {
  seq: number; currentSeq: number; userId: string; currentUserId: string | null;
}): boolean {
  return args.seq === args.currentSeq && args.currentUserId === args.userId;
}

type AuthCtx = {
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  /**
   * A RECOVERABLE failure to load profile/roles for a signed-in user.
   * Distinct from "no role": Supabase returns errors in the response body,
   * so a failed read used to look exactly like an empty role list and the app
   * silently degraded the user to the representative shell.
   */
  authDataError: string | null;
  reloadAuthData: () => void;
  hasRole: (r: AppRole) => boolean;
  isAdmin: boolean;
  isManager: boolean;
  isRepresentative: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [authDataError, setAuthDataError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Monotonic request id: a late response from a PREVIOUS user or a superseded
  // load must never overwrite the current identity's state.
  const requestSeq = useRef(0);
  const currentUserId = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadForUser(u: User | null) {
      const seq = ++requestSeq.current;
      currentUserId.current = u?.id ?? null;
      if (!u) {
        if (mounted) { setProfile(null); setRoles([]); setAuthDataError(null); setLoading(false); }
        return;
      }
      // Identity change resets the loading/error guard.
      if (mounted) { setLoading(true); setAuthDataError(null); }
      try {
        const [profRes, rolesRes] = await Promise.all([
          supabase.from("profiles").select("id, full_name, email, manager_id, team_id, active").eq("id", u.id).maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", u.id),
        ]);
        if (!mounted) return;
        if (!isCurrentAuthResponse({ seq, currentSeq: requestSeq.current, userId: u.id, currentUserId: currentUserId.current })) return;
        const outcome = resolveAuthData(profRes, rolesRes);
        if (outcome.kind === "error") {
          console.error("[Pulse] auth data load error", profRes.error ?? rolesRes.error);
          setAuthDataError(outcome.message);
          setProfile(null);
          setRoles([]);
          setLoading(false);
          return;
        }
        setProfile(outcome.profile);
        setRoles(outcome.roles);
        setAuthDataError(null);
        setLoading(false);
      } catch (error) {
        console.error("[Pulse] auth profile load failed", error);
        if (!mounted || seq !== requestSeq.current) return;
        setAuthDataError("טעינת נתוני המשתמש נכשלה");
        setProfile(null);
        setRoles([]);
        setLoading(false);
      }
    }

    supabase.auth.getSession().then(
      ({ data }) => {
        if (!mounted) return;
        const u = data.session?.user ?? null;
        setUser(u);
        loadForUser(u);
      },
      (error) => {
        console.error("[Pulse] auth session load failed", error);
        if (mounted) setLoading(false);
      },
    );

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") {
        loadForUser(u);
        if (event === "SIGNED_IN") {
          supabase.rpc("touch_last_login").then(
            () => {},
            (error) => console.error("[Pulse] touch_last_login failed", error),
          );
        }
      }
      if (event === "SIGNED_OUT") {
        requestSeq.current += 1;
        currentUserId.current = null;
        setProfile(null);
        setRoles([]);
        setAuthDataError(null);
        setLoading(false);
      }
    });


    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [reloadTick]);

  const value: AuthCtx = {
    user,
    profile,
    roles,
    loading,
    authDataError,
    reloadAuthData: () => setReloadTick((t) => t + 1),
    hasRole: (r) => roles.includes(r),
    isAdmin: roles.includes("admin"),
    isManager: roles.includes("manager"),
    isRepresentative: roles.includes("representative"),
    signOut: async () => {
      await supabase.auth.signOut();
      window.location.href = "/auth";
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}


export function useAuth() {
  const c = useContext(Ctx);
  if (!c) {
    return {
      user: null, profile: null, roles: [] as AppRole[], loading: true,
      authDataError: null, reloadAuthData: () => {},
      hasRole: () => false, isAdmin: false, isManager: false, isRepresentative: false,
      signOut: async () => {},
    } satisfies AuthCtx;
  }
  return c;
}

/** Translate common Supabase auth errors to friendly Hebrew. */
export function hebrewAuthError(msg: string | undefined | null): string {
  if (!msg) return "אירעה שגיאה. נסה שוב.";
  const m = msg.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "אימייל או סיסמה שגויים.";
  if (m.includes("email not confirmed")) return "יש לאשר את כתובת המייל לפני התחברות.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "הרשמה עצמית אינה מאפשרת. פנה למנהל המערכת.";
  if (m.includes("rate limit")) return "יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.";
  if (m.includes("password") && m.includes("weak")) return "הסיסמה חלשה מדי. בחר סיסמה חזקה יותר.";
  if (m.includes("user not found")) return "לא נמצא משתמש עם כתובת מייל זו.";
  if (m.includes("network")) return "בעיית תקשורת. בדוק את החיבור לאינטרנט.";
  return "אירעה שגיאה בהתחברות. נסה שוב.";
}
