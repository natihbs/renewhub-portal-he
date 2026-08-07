import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { requireRole } from "@/lib/require-role";
import { toast } from "sonner";
import { getMyNextWorkItem, recordWorkItemOutcome } from "@/lib/worklist.functions";
import { getMyCoverage } from "@/lib/coverage.functions";
import {
  OUTCOME_CHOICES,
  contextLines,
  remainingSentence,
  scoreboardStats,
  scoreboardSummary,
  outcomeErrorMessage,
  NO_CONTEXT_MESSAGE,
  type ScoreboardInput,
} from "@/lib/worklist-view";
import type { CanonicalOutcomeState } from "@/lib/domain-types";

/**
 * WITHDRAWN FROM THE PRODUCT — admin-only, and not in navigation.
 *
 * Pulse is a sales team management and performance system, not a queue or a
 * call-disposition tool. This screen was built on the opposite premise and no
 * representative should ever see it: it is unreachable from the menu for every
 * role, and the guard below closes the direct URL for everyone but an
 * administrator.
 *
 * Kept rather than deleted so the removal is one reversible decision rather
 * than a rewrite, and so the v2 server functions underneath it stay exercised.
 * Delete this file, its view module and its test when the team is ready to
 * retire the queue work entirely.
 */

export const Route = createFileRoute("/_authenticated/worklist")({
  // Not merely hidden — a hidden route is still a reachable one.
  beforeLoad: () => requireRole(["admin"]),
  head: () => ({
    meta: [
      { title: "רשימת העבודה · Pulse" },
      { name: "description", content: "הלקוח הבא לטיפול, ולמה דווקא הוא" },
      { property: "og:title", content: "רשימת העבודה · Pulse" },
      { property: "og:description", content: "הלקוח הבא לטיפול, ולמה דווקא הוא" },
    ],
  }),
  component: WorklistPage,
});

function WorklistPage() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader title="רשימת העבודה" description="הלקוח הבא לטיפול, ולמה דווקא הוא" />
      <NextCustomerCard />
      <Scoreboard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The next customer
// ---------------------------------------------------------------------------

function NextCustomerCard() {
  const nextFn = useServerFn(getMyNextWorkItem);
  const recordFn = useServerFn(recordWorkItemOutcome);
  const qc = useQueryClient();
  const [errorText, setErrorText] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["v2", "worklist", "next"],
    queryFn: () => nextFn({ data: { workTypeKey: "renewals", lookAhead: 3 } }),
    // Not refetched on focus: the item on screen is the one being worked, and
    // having it change while someone is mid-call is worse than being a minute
    // behind.
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (vars: { workItemId: string; state: CanonicalOutcomeState }) =>
      recordFn({ data: { workItemId: vars.workItemId, state: vars.state } }),
    onSuccess: async (result) => {
      setErrorText(null);
      const choice = OUTCOME_CHOICES.find((c) => c.state === result.itemState);
      toast.success(choice?.confirmation ?? "התוצאה נרשמה");
      // The figures behind the scoreboard moved; refetch both before showing
      // the next customer, so what is on screen is one consistent picture
      // rather than a new customer beside a stale score.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["v2", "worklist", "next"] }),
        qc.invalidateQueries({ queryKey: ["v2", "worklist", "score"] }),
      ]);
    },
    onError: (error) => {
      // Deliberately does NOT advance. A failed write that moved the list on
      // would lose the customer silently, which is the failure mode this whole
      // program has been removing.
      setErrorText(outcomeErrorMessage(error));
    },
  });

  if (q.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>הלקוח הבא</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (q.isError) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={AlertCircle}
            title="לא הצלחנו לטעון את רשימת העבודה"
            description="אפשר לנסות שוב בעוד רגע."
            action={
              <Button variant="outline" onClick={() => q.refetch()}>
                נסה שוב
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const result = q.data;

  if (!result?.available) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={result?.reason === "queue_empty" ? CheckCircle2 : AlertCircle}
            title={
              result?.reason === "queue_empty" ? "אין לקוחות ממתינים" : "הרשימה אינה זמינה כרגע"
            }
            description={result?.detail ?? "אין כרגע לקוחות לטיפול."}
            action={
              <Button variant="outline" onClick={() => q.refetch()}>
                רענון
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const { item, reason, remaining } = result.next;
  const lines = contextLines(item);
  const busy = mutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>הלקוח הבא</CardTitle>
          <Badge variant="secondary">{remainingSentence(remaining)}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Why this one. The single most important line on the screen: a queue
            that cannot explain itself gets worked around. */}
        <div className="rounded-xl border bg-accent/40 p-4">
          <div className="text-xs font-medium text-muted-foreground">למה דווקא עכשיו</div>
          <div className="mt-1 font-semibold leading-relaxed">{reason}</div>
        </div>

        <div>
          <div className="text-sm font-medium text-muted-foreground mb-2">פרטי הלקוח</div>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{NO_CONTEXT_MESSAGE}</p>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {lines.map((line) => (
                <div
                  key={line.label}
                  className="flex items-baseline justify-between gap-3 border-b py-1.5"
                >
                  <dt className="text-sm text-muted-foreground">{line.label}</dt>
                  <dd className="text-sm font-medium tabular-nums">{line.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {errorText && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{errorText}</span>
          </div>
        )}

        <div>
          <div className="text-sm font-medium text-muted-foreground mb-2">מה קרה בשיחה?</div>
          <div className="flex flex-wrap gap-2">
            {OUTCOME_CHOICES.map((choice) => (
              <Button
                key={choice.state}
                variant={choice.concludes ? "default" : "outline"}
                disabled={busy}
                onClick={() =>
                  mutation.mutate({ workItemId: item.workItemId, state: choice.state })
                }
              >
                {choice.label}
              </Button>
            ))}
          </div>
          {busy && <p className="mt-2 text-xs text-muted-foreground">רושם…</p>}
        </div>

        {result.upcoming.length > 0 && <UpcomingPreview upcoming={result.upcoming} />}
      </CardContent>
    </Card>
  );
}

/**
 * The next few, as reasons only.
 *
 * No names, no values, no buttons — deliberately not a grid. It exists so the
 * shape of the next few minutes is visible, and stops short of anything that
 * would let someone pick out of order.
 */
function UpcomingPreview({ upcoming }: { upcoming: { workItemId: string; reason: string }[] }) {
  return (
    <div className="border-t pt-4">
      <div className="text-xs font-medium text-muted-foreground mb-2">אחריו בתור</div>
      <ol className="space-y-1.5">
        {upcoming.map((u, i) => (
          <li key={u.workItemId} className="flex items-start gap-2 text-sm text-muted-foreground">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium tabular-nums">
              {i + 2}
            </span>
            <span>{u.reason}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

/**
 * Counts and money, nothing else.
 *
 * No percentage: an honest one needs its numerator and denominator beside it,
 * which is four numbers where two will do. No rank and no trend: neither
 * changes what to do next, and this screen only answers that one question.
 *
 * When coverage is unavailable it SAYS so, with the reason. The alternative —
 * rendering zeros — would tell a representative they have done nothing on the
 * morning the feed failed.
 */
function Scoreboard() {
  const coverageFn = useServerFn(getMyCoverage);
  const q = useQuery({
    queryKey: ["v2", "worklist", "score"],
    queryFn: () => coverageFn({ data: { workTypeKey: "renewals" } }),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (q.isPending) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">הסיכום שלי החודש</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const input: ScoreboardInput = (() => {
    if (q.isError) return { available: false, detail: "לא הצלחנו לטעון את הסיכום." };
    const c = q.data;
    if (!c || !c.available) {
      return { available: false, detail: c?.detail ?? "הסיכום אינו זמין כרגע." };
    }
    return {
      available: true,
      engagedCount: c.engagedCount,
      eligibleCount: c.eligibleCount,
      expiredUnworkedCount: c.expiredUnworkedCount,
      pendingCount: c.pendingCount,
      expiredUnworkedValue: c.expiredUnworkedValue,
      pendingValue: c.pendingValue,
    };
  })();

  const stats = scoreboardStats(input);
  const summary = scoreboardSummary(input);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">הסיכום שלי החודש</CardTitle>
      </CardHeader>
      <CardContent>
        {!input.available ? (
          <p className="text-sm text-muted-foreground">{input.detail}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border p-3">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div
                    className={
                      "mt-1 text-lg font-semibold tabular-nums " +
                      (s.tone === "attention" ? "text-destructive" : "")
                    }
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
            {summary && <p className="mt-3 text-sm text-muted-foreground">{summary}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
