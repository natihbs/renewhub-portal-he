import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

/**
 * Renders an explicit, recoverable failure state when the signed-in user's
 * profile/roles could not be loaded — BEFORE any role-dependent shell or page
 * renders. Without it, a failed read is indistinguishable from "no role" and
 * the app quietly downgrades the user to the representative experience.
 */
export function AuthDataBoundary({ children }: { children: ReactNode }) {
  const { user, authDataError, reloadAuthData } = useAuth();

  if (user && authDataError) {
    return (
      <div dir="rtl" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
        <h1 className="text-xl font-bold">טעינת נתוני המשתמש נכשלה</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          לא ניתן לטעון את הפרופיל וההרשאות שלך כרגע. ייתכן שמדובר בתקלת תקשורת זמנית.
        </p>
        <Button onClick={reloadAuthData} className="min-h-11">נסה שוב</Button>
      </div>
    );
  }

  return <>{children}</>;
}
