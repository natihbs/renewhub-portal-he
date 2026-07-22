import { Link } from "@tanstack/react-router";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUx } from "@/lib/ux-store";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  performance: "ביצועים",
  competition: "תחרות",
  knowledge: "מרכז ידע",
  feedback: "משוב",
};

export function NotificationBell() {
  const { notifications, markNotificationRead, markAllRead } = useUx();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative shrink-0" aria-label="התראות">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -start-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <div className="font-semibold text-sm">התראות</div>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={markAllRead} disabled={unread === 0}>
            <Check className="h-3.5 w-3.5" />
            סמן הכל כנקרא
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">אין התראות חדשות</div>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => {
                const Item = (
                  <div
                    className={cn(
                      "p-3 transition-colors hover:bg-accent/50 cursor-pointer",
                      !n.read && "bg-accent/20"
                    )}
                    onClick={() => markNotificationRead(n.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-sm truncate">{n.title}</div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{KIND_LABEL[n.kind]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{n.body}</p>
                    {!n.read && <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />}
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.href ? <Link to={n.href}>{Item}</Link> : Item}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
