import { useAppMode } from "@/lib/app-mode";
import { cn } from "@/lib/utils";
import { FlaskConical, ShieldCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Mode indicator. Authenticated production users always see the Live badge.
 * The Demo badge only appears when demo mode was explicitly unlocked (?demo=true, dev/admin).
 */
export function ModeToggle() {
  const { isDemo, exitDemo } = useAppMode();

  if (!isDemo) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              role="status"
              aria-label="מצב פעיל - נתוני ענן"
              className={cn(
                "inline-flex items-center gap-1.5 h-9 rounded-lg border px-2.5 text-xs font-medium",
                "border-success/40 bg-success/10 text-success-foreground cursor-default select-none"
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">מצב פעיל</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">מצב פעיל - הנתונים נטענים מהענן</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const full = "מצב הדגמה (מפתחים) - הנתונים נשמרים רק במחשב זה.";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={exitDemo}
            aria-label={full}
            className={cn(
              "inline-flex items-center gap-1.5 h-9 rounded-lg border px-2.5 text-xs font-medium",
              "border-warning/40 bg-warning/10 text-warning-foreground select-none"
            )}
          >
            <FlaskConical className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">מצב הדגמה</span>
            <span className="hidden lg:inline text-warning-foreground/80 font-normal">· יציאה למצב פעיל</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{full} לחץ ליציאה למצב פעיל.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
