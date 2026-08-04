import { useEffect, useMemo, useState } from "react";
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
import { downloadCsv } from "@/lib/csv-export";
import { useResolvedRole } from "@/lib/use-resolved-role";
import { useRepresentativeGoals, currentGoalMonth } from "@/lib/goals-hooks";
import { navItemsByGroup, navLabel, quickActionsForRole, quickActionLabel } from "@/lib/navigation-config";
import { Users, Trophy, FileSpreadsheet, FileText, MessageSquare } from "lucide-react";

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

// CommandPalette is fully role-aware: every quick action and every
// navigation shortcut is filtered through the same shared navigation-config
// module AppShell renders from, so a representative can never see (let alone
// click into) an admin/manager-only action here. Unauthorized actions are
// never displayed — the server remains the actual authorization boundary
// (every server function re-checks the caller's role independently), this
// is strictly about not showing what someone isn't meant to reach.
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { state } = useApp();
  const { open: openRepWorkspace } = useRepWorkspace();
  const role = useResolvedRole();

  const go = (to: string) => {
    onOpenChange(false);
    navigate({ to });
  };

  const { primary, management } = navItemsByGroup(role);
  const navGroup = [...primary, ...management];
  const quickActions = quickActionsForRole(role);
  const canExport = role === "admin" || role === "manager";

  // Official monthly target (representative_goals) — never the legacy
  // rep.monthlyTarget column (§19). A rep with no official target this
  // month exports as an honest blank, not a fabricated 0.
  const repIds = useMemo(() => state.reps.map((r) => r.id), [state.reps]);
  const { goalsByRepId } = useRepresentativeGoals(repIds, currentGoalMonth());

  const exportCsv = () => {
    onOpenChange(false);
    const rows = [
      ["שם", "צוות", "יעד אישי", "ביצוע"],
      ...state.reps.map((r) => [r.name, r.teamName, goalsByRepId.get(r.id) ?? "", r.currentResult]),
    ];
    downloadCsv(`pulse-reps-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="חיפוש נציגים, תחרויות, מאמרים, משובים... או פקודה" />
      <CommandList>
        <CommandEmpty>לא נמצאו תוצאות</CommandEmpty>

        {(quickActions.length > 0 || canExport) && (
          <>
            <CommandGroup heading="פעולות מהירות">
              {quickActions.map((a) => {
                const Icon = a.icon;
                return (
                  <CommandItem key={a.id} onSelect={() => go(a.to)}>
                    <Icon className="ms-2 h-4 w-4" />
                    {quickActionLabel(a, role)}
                  </CommandItem>
                );
              })}
              {canExport && (
                <CommandItem onSelect={exportCsv}><FileSpreadsheet className="ms-2 h-4 w-4" />ייצוא לאקסל</CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="ניווט">
          {navGroup.map((n) => {
            const Icon = n.icon;
            return (
              <CommandItem key={n.to} onSelect={() => go(n.to)}>
                <Icon className="ms-2 h-4 w-4" />
                {navLabel(n, role)}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {state.reps.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="נציגים">
              {state.reps.slice(0, 20).map((r) => (
                <CommandItem key={r.id} value={`נציג ${r.name} ${r.teamName}`} onSelect={() => { onOpenChange(false); openRepWorkspace(r.id); }}>
                  <Users className="ms-2 h-4 w-4" />
                  <span>{r.name}</span>
                  <span className="text-xs text-muted-foreground ms-2">· {r.teamName}</span>
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
      </CommandList>
    </CommandDialog>
  );
}
