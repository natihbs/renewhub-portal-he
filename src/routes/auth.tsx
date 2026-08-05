import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
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
  validateSearch: (s: Record<string, unknown>) => ({ next: safeNext(s.next) }),
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


/** Wide, ambient heartbeat trace for the desktop branded panel. Gently animated; respects reduced motion. */
function HeartbeatVisual() {
  return (
    <svg viewBox="0 0 400 80" className="h-16 w-full max-w-sm" aria-hidden="true">
      <path
        d="M 0 40 L 60 40 L 78 12 L 100 68 L 122 24 L 138 40 L 400 40"
        fill="none"
        stroke="var(--brand-accent)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="motion-safe:animate-[pulse-line_2.6s_ease-in-out_infinite]"
      />
    </svg>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
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

  return (
    <div dir="rtl" className="min-h-dvh grid lg:grid-cols-2 bg-background">
      {/* Branded visual panel — desktop only */}
      <div className="hidden lg:flex flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground">
        <PulseLogo variant="light" className="h-9" />
        <div className="max-w-sm">
          <HeartbeatVisual />
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
