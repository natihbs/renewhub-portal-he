import { useAppMode } from "@/lib/app-mode";
import { cn } from "@/lib/utils";
import { FlaskConical, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Permanent demo-mode indicator. Always visible in the header so users are
 * reminded that data is local-only. Clicking is a no-op (informational).
 */
export function ModeToggle() {
  const { mode } = useAppMode();
  if (mode !== "demo") return null;

  const label = "מצב הדגמה";
  const full = "מצב הדגמה - הנתונים נשמרים רק במחשב זה.";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="status"
            aria-label={full}
            className={cn(
              "inline-flex items-center gap-1.5 h-9 rounded-lg border px-2.5 text-xs font-medium",
              "border-warning/40 bg-warning/10 text-warning cursor-default select-none"
            )}
          >
            <FlaskConical className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">{label}</span>
            <span className="hidden lg:inline text-warning/80 font-normal">· הנתונים נשמרים רק במחשב זה</span>
            <Info className="h-3 w-3 opacity-70 sm:hidden" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{full}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
