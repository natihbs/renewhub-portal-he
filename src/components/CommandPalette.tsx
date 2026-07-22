import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { useApp } from "@/lib/store";
import { useRepWorkspace } from "@/lib/rep-workspace";
import { TEAM_LABEL } from "@/lib/seed";
import {
  Home, BarChart3, Trophy, BookOpen, Headphones, Settings,
  UserPlus, PlusCircle, FileSpreadsheet, Users, FileText, MessageSquare,
} from "lucide-react";

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { state } = useApp();
  const { open: openRepWorkspace } = useRepWorkspace();

  const go = (to: string) => {
    onOpenChange(false);
    navigate({ to });
  };

  const exportCsv = () => {
    onOpenChange(false);
    const rows = [["שם", "צוות", "יעד", "ביצוע"], ...state.reps.map((r) => [r.name, TEAM_LABEL[r.team], r.monthlyTarget, r.currentResult])];
    const csv = "\uFEFF" + rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "renewhub.csv";
    a.click();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="חיפוש נציגים, תחרויות, מאמרים, משובים... או פקודה" />
      <CommandList>
        <CommandEmpty>לא נמצאו תוצאות</CommandEmpty>

        <CommandGroup heading="פעולות מהירות">
          <CommandItem onSelect={() => go("/admin")}><UserPlus className="ms-2 h-4 w-4" />הוספת נציג</CommandItem>
          <CommandItem onSelect={() => go("/feedback")}><Headphones className="ms-2 h-4 w-4" />הוספת האזנה / משוב</CommandItem>
          <CommandItem onSelect={() => go("/competitions")}><Trophy className="ms-2 h-4 w-4" />יצירת תחרות</CommandItem>
          <CommandItem onSelect={() => go("/knowledge")}><BookOpen className="ms-2 h-4 w-4" />פתיחת מרכז הידע</CommandItem>
          <CommandItem onSelect={exportCsv}><FileSpreadsheet className="ms-2 h-4 w-4" />ייצוא לאקסל</CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="ניווט">
          <CommandItem onSelect={() => go("/")}><Home className="ms-2 h-4 w-4" />דף הבית</CommandItem>
          <CommandItem onSelect={() => go("/performance")}><BarChart3 className="ms-2 h-4 w-4" />ביצועים</CommandItem>
          <CommandItem onSelect={() => go("/competitions")}><Trophy className="ms-2 h-4 w-4" />תחרויות</CommandItem>
          <CommandItem onSelect={() => go("/knowledge")}><BookOpen className="ms-2 h-4 w-4" />מרכז ידע</CommandItem>
          <CommandItem onSelect={() => go("/feedback")}><Headphones className="ms-2 h-4 w-4" />האזנות ומשוב</CommandItem>
          <CommandItem onSelect={() => go("/admin")}><Settings className="ms-2 h-4 w-4" />ניהול המערכת</CommandItem>
        </CommandGroup>

        {state.reps.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="נציגים">
              {state.reps.slice(0, 20).map((r) => (
                <CommandItem key={r.id} value={`נציג ${r.name} ${TEAM_LABEL[r.team]}`} onSelect={() => { onOpenChange(false); openRepWorkspace(r.id); }}>
                  <Users className="ms-2 h-4 w-4" />
                  <span>{r.name}</span>
                  <span className="text-xs text-muted-foreground ms-2">· {TEAM_LABEL[r.team]}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {state.competitions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="תחרויות">
              {state.competitions.map((c) => (
                <CommandItem key={c.id} value={`תחרות ${c.name}`} onSelect={() => go("/competitions")}>
                  <Trophy className="ms-2 h-4 w-4" />
                  <span>{c.name}</span>
                  {c.active && <span className="text-xs text-primary ms-2">· פעילה</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {state.articles.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="מרכז ידע">
              {state.articles.slice(0, 20).map((a) => (
                <CommandItem key={a.id} value={`מאמר ${a.title} ${a.category}`} onSelect={() => go("/knowledge")}>
                  <FileText className="ms-2 h-4 w-4" />
                  <span className="truncate">{a.title}</span>
                  <span className="text-xs text-muted-foreground ms-2">· {a.category}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {state.feedback.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="האזנות ומשוב">
              {state.feedback.slice(0, 20).map((f) => {
                const rep = state.reps.find((r) => r.id === f.repId);
                return (
                  <CommandItem key={f.id} value={`משוב ${rep?.name ?? ""} ${f.callId}`} onSelect={() => go("/feedback")}>
                    <MessageSquare className="ms-2 h-4 w-4" />
                    <span>{rep?.name ?? "נציג"}</span>
                    <span className="text-xs text-muted-foreground ms-2">· ציון {f.score} · {f.date}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="הוספה">
          <CommandItem onSelect={() => go("/admin")}><PlusCircle className="ms-2 h-4 w-4" />הוספת הודעה / נציג</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
