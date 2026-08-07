/**
 * "עדכון ביצועים ידני" — the manager's audited fallback for the current-month
 * performance figure when imported (Qlik) data is stale, delayed or wrong.
 *
 * Product boundaries, deliberately narrow:
 *   - updates current_result ONLY. Targets are never touched here — they
 *     live on /targets (test-pinned: this file never sends a target field).
 *   - authorization is the server's: updateRepresentativeMetrics runs
 *     assertCanEdit against the REAL authenticated role (admin: any rep;
 *     manager: only reps readable under their teams.manager_id scope), so an
 *     admin merely VIEWING as manager gains or loses nothing, and a
 *     representative is rejected outright.
 *   - an inactive representative stays blocked by the existing source-aware
 *     policy (source: "manual" is not a historical correction).
 *   - every save is audited with old/new/delta, the selected reason, the
 *     note, the screen it came from and the acting user — and surfaces in the
 *     admin activity feed as "עודכנו נתוני ביצוע".
 */

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PenLine } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useApp } from "@/lib/store";
import { useAppMode } from "@/lib/app-mode";
import { updateRepresentativeMetrics } from "@/lib/rep-admin.functions";
import { MANUAL_UPDATE_REASONS, MANUAL_UPDATE_SUCCESS_MESSAGE } from "@/lib/performance-domain";
import { currentGoalMonth } from "@/lib/goals-hooks";
import { formatMonthIL, formatNum } from "@/lib/format";
import type { Rep } from "@/lib/seed";

export function ManualPerformanceDialog({
  rep,
  sourceScreen,
  trigger,
}: {
  /** Preselected representative (row action). Omit for the picker flow (header action). */
  rep?: Rep;
  /** Recorded verbatim in the audit entry. */
  sourceScreen: string;
  trigger: ReactNode;
}) {
  const { state, updateRep } = useApp();
  const { isDemo } = useAppMode();
  const updateFn = useServerFn(updateRepresentativeMetrics);
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [repId, setRepId] = useState<string>(rep?.id ?? "");
  const [newResult, setNewResult] = useState<string>("");
  const [reason, setReason] = useState<string>(MANUAL_UPDATE_REASONS[0].value);
  const [note, setNote] = useState("");

  const selected = useMemo(
    () => (rep ? rep : state.reps.find((r) => r.id === repId)),
    [rep, repId, state.reps],
  );

  const parsed = Number(newResult);
  const validNumber = newResult.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  const delta = selected && validNumber ? Math.round(parsed) - selected.currentResult : null;

  const reset = () => {
    setRepId(rep?.id ?? "");
    setNewResult("");
    setReason(MANUAL_UPDATE_REASONS[0].value);
    setNote("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("יש לבחור נציג");
      if (!validNumber) throw new Error("יש להזין ביצוע חדש תקין (0 ומעלה)");
      if (isDemo) {
        updateRep(selected.id, { currentResult: Math.round(parsed) });
        return;
      }
      // current_result only — never name/team, and never a target.
      await updateFn({
        data: {
          rep_id: selected.id,
          current_result: Math.round(parsed),
          source: "manual",
          source_screen: sourceScreen,
          manual_reason: reason,
          manual_note: note.trim() || undefined,
        },
      });
      void qc.invalidateQueries({ queryKey: ["representatives"] });
    },
    onSuccess: () => {
      toast.success(MANUAL_UPDATE_SUCCESS_MESSAGE, {
        description: selected
          ? `${selected.name}: ${formatNum(selected.currentResult)} ← ${formatNum(Math.round(parsed))}`
          : undefined,
      });
      setOpen(false);
      reset();
    },
    onError: (e: Error) => toast.error("העדכון נכשל", { description: e.message }),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-4 w-4 text-primary" />
            עדכון ביצועים ידני
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              עדכון הביצוע לחודש{" "}
              <b className="text-foreground">{formatMonthIL(currentGoalMonth())}</b>
            </span>
            <Badge variant="secondary" className="text-xs">
              עדכון ידני — נרשם ביומן הפעילות
            </Badge>
          </div>

          {!rep && (
            <div className="space-y-1">
              <Label>נציג/ה</Label>
              <Select value={repId} onValueChange={setRepId}>
                <SelectTrigger>
                  <SelectValue placeholder="בחרו נציג/ה" />
                </SelectTrigger>
                <SelectContent>
                  {state.reps.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {r.teamName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selected && (
            <div className="grid grid-cols-3 gap-3 rounded-xl border p-3 text-center text-sm">
              <div>
                <div className="text-xs text-muted-foreground">נציג/ה</div>
                <div className="font-semibold truncate">{selected.name}</div>
                <div className="text-xs text-muted-foreground truncate">{selected.teamName}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">ביצוע נוכחי</div>
                <div className="font-bold tabular-nums">{formatNum(selected.currentResult)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">הפרש</div>
                <div
                  className={cn(
                    "font-bold tabular-nums",
                    delta === null
                      ? "text-muted-foreground"
                      : delta > 0
                        ? "text-success-foreground"
                        : delta < 0
                          ? "text-primary"
                          : "text-muted-foreground",
                  )}
                >
                  {delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatNum(delta)}`}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label>ביצוע חדש</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={newResult}
              onChange={(e) => setNewResult(e.target.value)}
              placeholder={selected ? formatNum(selected.currentResult) : "0"}
            />
          </div>

          <div className="space-y-1">
            <Label>סיבת העדכון</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_UPDATE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>הערה (אופציונלי)</Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="הקשר קצר לעדכון — יישמר ביומן הפעילות"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            עדכון זה משנה את נתון הביצוע בלבד. יעדים אישיים וצוותיים מנוהלים בעמוד היעדים ואינם
            מושפעים.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
            ביטול
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !selected || !validNumber}
          >
            {mutation.isPending ? "מעדכן..." : "עדכון הביצוע"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
