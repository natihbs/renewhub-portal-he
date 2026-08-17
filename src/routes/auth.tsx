import { createFileRoute, useNavigate, useHydrated, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hebrewAuthError } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PulseLogo } from "@/components/PulseLogo";
import { APP_DESCRIPTOR, APP_TAGLINE } from "@/lib/app-meta";

/** Only same-origin relative paths are accepted as a post-login redirect. */
function safeNext(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { next?: string } => {
    const next = safeNext(s.next);
    return next ? { next } : {};
  },

  head: () => ({
    meta: [
      { title: "התחברות · Pulse" },
      { name: "description", content: "התחברות למערכת Pulse" },
      { property: "og:title", content: "התחברות · Pulse" },
      { property: "og:description", content: "התחברות למערכת Pulse" },
    ],
  }),
  component: AuthPage,
});


/**
 * Ambient signal waveform for the desktop branded panel — the canonical Pulse
 * trace (see PulseLogo) stretched into a wide, quiet motif, replacing the old
 * vertical rhythm-bars whose silhouette family the brand no longer uses. One
 * smooth asymmetric trace in translucent white with the brand-accent "live"
 * node at its end; the opacity breath reuses the existing pulse-line
 * keyframes and is gated behind motion-safe, so prefers-reduced-motion gets a
 * static trace.
 */
function RhythmVisual() {
  return (
    <svg viewBox="0 0 220 64" className="h-16 w-auto" aria-hidden="true">
      <path
        d="M4 40 H34 L52 18 L76 52 L94 32 H124 L142 22 L164 46 L178 40 H200"
        fill="none"
        stroke="#ffffff"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.35}
        className="motion-safe:animate-[pulse-line_2.6s_ease-in-out_infinite]"
      />
      <circle
        cx={211}
        cy={40}
        r={5}
        fill="var(--brand-accent)"
        className="motion-safe:animate-[pulse-line_2.6s_ease-in-out_infinite]"
        style={{ animationDelay: "0.45s" }}
      />
    </svg>
  );
}


function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  // This route is ssr:false, so the server emits the Suspense fallback (null).
  // Rendering the form on the very first client pass would therefore always be
  // reported as a hydration mismatch; wait one pass so both sides agree.
  const hydrated = useHydrated();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);


  function goAfterAuth() {
    if (next) {
      window.location.href = next;
      return;
    }
    navigate({ to: "/" });
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) goAfterAuth();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, next]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error(hebrewAuthError(error.message));
      return;
    }
    goAfterAuth();
  }


  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(hebrewAuthError(error.message));
      return;
    }
    toast.success("אם קיים חשבון בכתובת זו, נשלח מייל לאיפוס סיסמה.");
    setMode("login");
  }

  if (!hydrated) return null;

  return (

    <div dir="rtl" className="min-h-dvh grid lg:grid-cols-2 bg-background">
      {/* Branded visual panel — desktop only */}
      <div className="hidden lg:flex flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground">
        <PulseLogo variant="light" className="h-9" />
        <div className="max-w-sm">
          <RhythmVisual />
          <p className="mt-8 text-3xl font-extrabold leading-snug text-balance">{APP_TAGLINE}</p>
          <p className="mt-3 text-sidebar-foreground/70">{APP_DESCRIPTOR} · מערכת לניהול צוותי מכירות</p>
        </div>
        <div className="text-xs text-sidebar-foreground/45">© {new Date().getFullYear()} Pulse</div>
      </div>

      {/* Authentication panel */}
      <div className="flex flex-col items-center justify-center px-4 py-10">
        <div className="mb-6 flex flex-col items-center gap-1.5 text-center lg:hidden">
          <PulseLogo variant="compact" className="h-8" />
          <p className="text-xs text-muted-foreground">{APP_TAGLINE}</p>
        </div>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>{mode === "login" ? "התחברות" : "איפוס סיסמה"}</CardTitle>
            <CardDescription>
              {mode === "login"
                ? "כניסה עם חשבון משתמש אישי"
                : "הזן את כתובת המייל שלך ונשלח קישור לאיפוס"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mode === "login" ? (
              <form onSubmit={onLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">אימייל</Label>
                  <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">סיסמה</Label>
                  <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "מתחבר..." : "התחבר"}
                </Button>
                <button type="button" onClick={() => setMode("forgot")} className="block w-full text-center text-sm text-muted-foreground hover:text-foreground">
                  שכחת סיסמה?
                </button>
                <p className="text-xs text-muted-foreground text-center pt-2">
                  אין באפשרותך להירשם עצמאית. פנה למנהל המערכת לקבלת חשבון.
                </p>
              </form>
            ) : (
              <form onSubmit={onForgot} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="fp-email">אימייל</Label>
                  <Input id="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "שולח..." : "שלח קישור איפוס"}
                </Button>
                <button type="button" onClick={() => setMode("login")} className="block w-full text-center text-sm text-muted-foreground hover:text-foreground">
                  חזרה להתחברות
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
