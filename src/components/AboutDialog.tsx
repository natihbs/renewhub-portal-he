import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { APP_NAME, APP_STAGE, APP_VERSION, BUILD_NUMBER, BUILD_DATE } from "@/lib/app-meta";
import { Info } from "lucide-react";
import { type ReactNode } from "react";

export function AboutDialog({ trigger }: { trigger?: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="gap-2">
            <Info className="h-4 w-4" />
            אודות
          </Button>
        )}
      </DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>אודות {APP_NAME}</DialogTitle>
          <DialogDescription>פורטל חידושים פנימי לצוותי חידושי רכב ודירה.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <span className="text-muted-foreground">שלב</span>
            <span className="font-medium">{APP_STAGE}</span>
            <span className="text-muted-foreground">גרסה</span>
            <span className="font-mono">{APP_VERSION}</span>
            <span className="text-muted-foreground">מספר בילד</span>
            <span className="font-mono">{BUILD_NUMBER}</span>
            <span className="text-muted-foreground">תאריך בילד</span>
            <span className="font-mono">{BUILD_DATE}</span>
          </div>
          <p className="text-xs text-muted-foreground pt-2 border-t">
            נתוני הדגמה בלבד. אין להזין נתוני לקוחות אמיתיים, מספרי פוליסות או נתונים אישיים.
          </p>
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button asChild variant="outline">
            <Link to="/changelog">יומן שינויים</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
