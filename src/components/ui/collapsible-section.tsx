import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Progressive-disclosure wrapper for secondary screen sections: a full-width
 * labeled bar that expands in place. Collapsed by default — the point is that
 * the first screen shows only the primary working surface, while everything
 * inside remains one click away (nothing is removed, only folded).
 */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-semibold transition-colors hover:bg-accent/40"
          aria-expanded={open}
        >
          <span>{title}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        <div className="space-y-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
