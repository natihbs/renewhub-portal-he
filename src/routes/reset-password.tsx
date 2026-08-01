import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hebrewAuthError } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PulseLogo } from "@/components/PulseLogo";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "איפוס סיסמה · Pulse" },
      { name: "description", content: "קביעת סיסמה חדשה" },
      { property: "og:title", content: "איפוס סיסמה · Pulse" },
      { property: "og:description", content: "קביעת סיסמה חדשה" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase auto-consumes the recovery token from the URL hash and emits PASSWORD_RECOVERY
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("הסיסמה חייבת להיות באורך 8 תווים לפחות.");
    if (password !== confirm) return toast.error("הסיסמאות אינן תואמות.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        await supabase.from("profiles").update({ must_change_password: false }).eq("id", u.user.id);
      }
    }
    setLoading(false);
    if (error) return toast.error(hebrewAuthError(error.message));
    toast.success("הסיסמה עודכנה בהצלחה.");
    navigate({ to: "/" });
  }

  return (
    <div dir="rtl" className="min-h-dvh flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <PulseLogo variant="symbol" className="h-10 mx-auto mb-4" />
        <Card>
          <CardHeader className="text-center">
            <CardTitle>איפוס סיסמה</CardTitle>
            <CardDescription>{ready ? "בחר סיסמה חדשה" : "מאמת קישור..."}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="p1">סיסמה חדשה</Label>
                <Input id="p1" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" disabled={!ready} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p2">אימות סיסמה</Label>
                <Input id="p2" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" disabled={!ready} />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !ready}>
                {loading ? "מעדכן..." : "עדכן סיסמה"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
