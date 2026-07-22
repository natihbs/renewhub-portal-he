import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hebrewAuthError } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "התחברות · RenewHub" },
      { name: "description", content: "התחברות למערכת RenewHub" },
      { property: "og:title", content: "התחברות · RenewHub" },
      { property: "og:description", content: "התחברות למערכת RenewHub" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error(hebrewAuthError(error.message));
      return;
    }
    navigate({ to: "/" });
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
    <div dir="rtl" className="min-h-dvh flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground font-bold shadow-soft">R</div>
          <CardTitle className="mt-3">{mode === "login" ? "התחברות ל-RenewHub" : "איפוס סיסמה"}</CardTitle>
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
  );
}
