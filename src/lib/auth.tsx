import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "admin" | "manager" | "representative";

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  representative_id: string | null;
  manager_id: string | null;
  team_id: string | null;
  active: boolean;
};

type AuthCtx = {
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
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

  useEffect(() => {
    let mounted = true;

    async function loadForUser(u: User | null) {
      if (!u) {
        if (mounted) { setProfile(null); setRoles([]); setLoading(false); }
        return;
      }
      const [{ data: prof }, { data: rs }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, representative_id, manager_id, team_id, active").eq("id", u.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", u.id),
      ]);
      if (!mounted) return;
      setProfile((prof as Profile) ?? null);
      setRoles(((rs ?? []) as { role: AppRole }[]).map((r) => r.role));
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      loadForUser(u);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") {
        loadForUser(u);
        if (event === "SIGNED_IN") {
          supabase.rpc("touch_last_login").then(() => {});
        }
      }
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setRoles([]);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthCtx = {
    user,
    profile,
    roles,
    loading,
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
