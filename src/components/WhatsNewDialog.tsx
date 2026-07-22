import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { APP_VERSION, CHANGELOG } from "@/lib/app-meta";

const KEY = "renewhub_whats_new_seen_v1";

export function WhatsNewDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(KEY);
      if (seen !== APP_VERSION) {
        // small delay so app has time to hydrate
        const t = setTimeout(() => setOpen(true), 800);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  const close = () => {
    try { localStorage.setItem(KEY, APP_VERSION); } catch {}
    setOpen(false);
  };

  const latest = CHANGELOG[0];
  if (!latest) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <DialogTitle>מה חדש בגרסה {latest.version}</DialogTitle>
          <DialogDescription>{latest.title}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {latest.items.slice(0, 6).map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button asChild variant="outline" onClick={close}>
            <Link to="/changelog">יומן שינויים מלא</Link>
          </Button>
          <Button onClick={close}>הבנתי, תודה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
